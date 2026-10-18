import { classify, ClaudeError } from "./errors";
import { resolveModel, TASKS, pickAvailable } from "./models";
import { applyCaching, stripTtl } from "./cache";
import type { Settings } from "@/domain/schemas";
import type { ClaudeGateway, ClaudeRequest, ClaudeResponse, Message, ServerToolDef, ToolDef, Usage } from "./types";

/** Fully-built API call. The SDK adapter (sdk.ts) is the only code that turns this into an HTTP request. */
export type WireParams = {
  model: string;
  max_tokens: number;
  system: unknown;
  messages: Message[];
  tools?: (ToolDef | ServerToolDef)[];
  tool_choice?: unknown;
  thinking?: { type: "enabled"; budget_tokens: number };
};
export type Transport = (
  p: WireParams,
  o: { signal: AbortSignal; onText?: (d: string) => void; onActivity: () => void },
) => Promise<ClaudeResponse>;

export type UsageEntry = Usage & { ts: string; task: string; model: string; courseNumber: string | null };

export type GatewayDeps = {
  transport: Transport;
  settings: () => Pick<Settings, "models">;
  /** Newest-first model ids (models.list, cached); [] = trust configured ids. */
  availableModels?: () => Promise<string[]>;
  onUsage?: (e: UsageEntry) => void | Promise<void>;
  /** Monthly-cap gate; throw ClaudeError("cap_stopped") to refuse. Called before each request. */
  beforeRequest?: (req: ClaudeRequest) => Promise<void>;
  onAuthError?: () => void;
  /** 413 handling for image-bearing requests: return the messages re-encoded at 1200 px. */
  shrinkImages?: (m: Message[]) => Promise<Message[]>;
  onModelSubstituted?: (from: string, to: string) => void;
  concurrency?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  idleMs?: number;
};

const BACKOFF_MS = [1000, 2000, 4000, 8000];
const HARD_CAP_MS = (task: string) => (task === "plan" ? 10 : 4) * 60_000;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function createGateway(d: GatewayDeps): ClaudeGateway {
  const sleep = d.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = d.random ?? Math.random;
  const limit = d.concurrency ?? 3;
  const idleMs = d.idleMs ?? 60_000;

  // Session memory of API quirks (9.4, 9.5).
  const noThinking = new Set<string>();
  let noTtl = false;

  // FIFO queue with a fast lane for the tutor.
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (priority: boolean) =>
    active < limit
      ? (active++, Promise.resolve())
      : new Promise<void>((r) => (priority ? waiting.unshift(r) : waiting.push(r)));
  const release = () => {
    const next = waiting.shift();
    if (next) next(); // slot handed over, active unchanged
    else active--;
  };

  async function attempt(req: ClaudeRequest, model: string, messages: Message[]): Promise<ClaudeResponse> {
    const { maxTokens } = TASKS[req.task];
    const budget = req.thinkingBudget && !noThinking.has(model) ? req.thinkingBudget : undefined;
    const cached = applyCaching(
      { system: req.system, tools: req.tools, messages },
      { conversation: !!req.cacheConversation, ttl1h: req.task === "tutor" },
    );
    let params: WireParams = {
      model,
      max_tokens: (req.maxTokens ?? maxTokens) + (budget ?? 0),
      system: cached.system,
      messages: cached.messages,
      ...(cached.tools && { tools: cached.tools }),
      ...(req.toolChoice && !budget && { tool_choice: req.toolChoice }),
      ...(budget && { thinking: { type: "enabled" as const, budget_tokens: budget } }),
    };
    if (noTtl) params = stripTtl(params);

    const ctl = new AbortController();
    const onAbort = () => ctl.abort(new ClaudeError("aborted", "aborted"));
    if (req.signal?.aborted) throw new ClaudeError("aborted", "aborted");
    req.signal?.addEventListener("abort", onAbort);
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(new ClaudeError("timeout", "no stream event for 60 s")), idleMs);
    };
    const hard = setTimeout(() => ctl.abort(new ClaudeError("timeout", "hard time cap")), HARD_CAP_MS(req.task));
    arm();
    try {
      return await d.transport(params, { signal: ctl.signal, onText: req.onText, onActivity: arm });
    } catch (e) {
      if (e instanceof ClaudeError) throw e;
      if (ctl.signal.aborted) throw ctl.signal.reason instanceof ClaudeError ? ctl.signal.reason : new ClaudeError("aborted", msg(e));
      const x = e as { status?: number; headers?: { get?: (k: string) => string | null } };
      const ra = Number(x.headers?.get?.("retry-after"));
      throw classify(x.status, msg(e), ra > 0 ? ra * 1000 : undefined);
    } finally {
      clearTimeout(idle);
      clearTimeout(hard);
      req.signal?.removeEventListener("abort", onAbort);
    }
  }

  async function run(req: ClaudeRequest): Promise<ClaudeResponse> {
    await d.beforeRequest?.(req);
    let model = resolveModel(req.task, d.settings());
    const avail = await d.availableModels?.().catch(() => []);
    if (avail) {
      const p = pickAvailable(model, avail);
      if (p.substituted) d.onModelSubstituted?.(model, p.model);
      model = p.model;
    }
    let messages = req.messages;
    let retries = 0;
    let shrunk = false;
    for (;;) {
      try {
        const res = await attempt(req, model, messages);
        const e: UsageEntry = {
          ts: new Date().toISOString(),
          task: req.task,
          model: res.model || model,
          courseNumber: req.courseNumber ?? null,
          ...res.usage,
        };
        void Promise.resolve(d.onUsage?.(e)).catch(console.error);
        if (import.meta.env.DEV) console.debug("[claude]", req.task, e.model, res.usage);
        return res;
      } catch (e) {
        if (!(e instanceof ClaudeError)) throw e;
        if (e.kind === "auth") d.onAuthError?.();
        const text = e.message.toLowerCase();
        if (e.kind === "bad_request" && text.includes("thinking") && req.thinkingBudget && !noThinking.has(model)) {
          noThinking.add(model);
          continue;
        }
        if (e.kind === "bad_request" && text.includes("ttl") && !noTtl) {
          noTtl = true;
          continue;
        }
        if (e.kind === "too_large" && d.shrinkImages && !shrunk) {
          shrunk = true;
          messages = await d.shrinkImages(messages);
          continue;
        }
        // timeouts retry like network errors
        if ((e.kind !== "retryable" && e.kind !== "timeout") || retries >= BACKOFF_MS.length) throw e;
        const wait = e.retryAfterMs ?? BACKOFF_MS[retries] ?? 8000;
        retries++;
        await sleep(wait + Math.floor(random() * 500));
        if (req.signal?.aborted) throw new ClaudeError("aborted", "aborted");
      }
    }
  }

  return {
    async send(req) {
      await acquire(!!req.priority || req.task === "tutor");
      try {
        return await run(req);
      } finally {
        release();
      }
    },
  };
}
