import { AsyncLocalStorage } from "node:async_hooks";
import { ClaudeError } from "@/core/claude/errors";
import type { Block, ClaudeGateway, ClaudeRequest, ClaudeResponse, ToolDef } from "@/core/claude/types";

/** Host Bridge (plan v2 §5.1): the domain code calls send(); the host model answers through shalav_submit_job. */

export type Content = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

type Job = {
  id: number;
  opId?: number;
  req: ClaudeRequest;
  parentJobId?: number;
  /** Set when the answer must be a call of this tool; otherwise the answer is plain text. */
  tool?: ToolDef;
  state: "queued" | "shown" | "answered";
  /** Created at (ms). */
  at: number;
  resolve(r: ClaudeResponse): void;
  reject(e: unknown): void;
};

/** "build": plan builds, served by the chat that pressed Build ("▶️ Building the plan"); "study": everything else ("▶️ Continue"). Chats share one connection, so the message picks the lane. */
export type Lane = "build" | "study";

type Op = {
  id: number;
  label: string;
  lane: Lane;
  /** What the card cancels it by (e.g. "web:104031"). */
  key?: string;
  ctl: AbortController;
  settled: boolean;
  lastJob?: number;
  result?: unknown;
  error?: unknown;
  summary: (result: unknown) => Content[];
};

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const WAIT_MS = 45_000;
/** Jobs handed out per call: the model answers them with parallel shalav_submit_job calls in one turn. */
const PER_CALL = 3;
const IMAGE_BYTES = 1_500_000; // base64 chars of images per tool result, to stay well inside the host's result size
/** No chat touched the lane for this long while an op waits on queued jobs: nobody will fetch them. */
const IDLE_MS = 5 * 60_000;
/** A shown job is being answered (that can take long); only a lane silent this long means the chat is gone. */
const SHOWN_MS = 30 * 60_000;
/** A shown job of a lane silent this long is handed out again (Nudge after the chat was stopped mid-answer). */
const RESHOW_MS = 2 * 60_000;
/** Error message of a stopped op; the cards translate it. */
export const STOPPED = "job.stopped";

export class BridgeGateway implements ClaudeGateway {
  private jobs = new Map<number, Job>();
  private ops = new Map<number, Op>();
  private seq = 0;
  private opSeq = 0;
  private als = new AsyncLocalStorage<Op>();
  private listeners = new Set<() => void>();
  /** Dedupe (5.2): `${opId}:${text}` already shown -> job number. Per op, not per server: the server outlives a chat. */
  private seen = new Map<string, number>();
  /** Last time a chat asked for or answered a build job. */
  private servedAt = 0;
  /** The answer schema of the lane's last shown job (not repeated right after). Per lane, not per op: a build chat interleaves courses. */
  private lastSchema: Partial<Record<Lane, { text: string; job: number }>> = {};
  /** Last time an op started in the lane or a chat asked for / answered one of its jobs. */
  private lastActive: Record<Lane, number> = { build: 0, study: 0 };

  constructor() {
    setInterval(() => this.sweep(), 30_000).unref?.();
  }

  /** Run a domain operation; every send() made inside it belongs to it and can be cancelled together. */
  run<T>(label: string, fn: (signal: AbortSignal) => Promise<T>, summary?: (r: T) => Content[], lane: Lane = "study", key?: string): { opId: number; done: Promise<T> } {
    this.lastActive[lane] = Date.now();
    const op: Op = {
      id: ++this.opSeq,
      label,
      lane,
      key,
      ctl: new AbortController(),
      settled: false,
      summary: (summary as Op["summary"]) ?? (() => [{ type: "text", text: "Done." }]),
    };
    this.ops.set(op.id, op);
    const done = this.als.run(op, () => fn(op.ctl.signal)).then(
      (r) => {
        op.result = r;
        return r;
      },
      (e) => {
        op.error = e;
        throw e;
      },
    );
    const settle = () => {
      op.settled = true;
      this.changed();
    };
    done.then(settle, settle);
    return { opId: op.id, done };
  }

  cancel(opId: number): void {
    this.ops.get(opId)?.ctl.abort();
  }

  /** The card's Cancel: every op of `key`, settled ones too (their prefetched jobs may still be queued). */
  cancelKey(key: string): void {
    for (const o of this.ops.values()) if (o.key === key) o.ctl.abort();
  }

  /** Ends ops nobody will serve, so their cards stop showing a spinner. Never one whose job a chat is answering. */
  sweep(now = Date.now()): void {
    for (const lane of ["build", "study"] as const) {
      const idle = now - this.lastActive[lane];
      const jobs = [...this.jobs.values()].filter((j) => this.laneOf(j) === lane);
      const waited = [...this.ops.values()].some((o) => o.lane === lane && !o.settled);
      const dead = jobs.some((j) => j.state === "shown") ? idle > SHOWN_MS : waited && idle > IDLE_MS;
      if (!dead) continue;
      for (const j of jobs) {
        if (j.opId !== undefined) this.cancel(j.opId);
        else {
          this.jobs.delete(j.id);
          j.reject(new ClaudeError("aborted", STOPPED));
        }
      }
      this.changed();
    }
  }

  send(req: ClaudeRequest): Promise<ClaudeResponse> {
    const op = this.als.getStore();
    const signals = [req.signal, op?.ctl.signal].filter((s): s is AbortSignal => !!s);
    const stopped = () => new ClaudeError("aborted", op?.ctl.signal.aborted ? STOPPED : "aborted");
    if (signals.some((s) => s.aborted)) return Promise.reject(stopped());

    const tools = (req.tools ?? []).filter((t): t is ToolDef => "input_schema" in t); // server tools are dropped
    const tool = req.toolChoice?.type === "tool" ? tools.find((t) => t.name === (req.toolChoice as { name: string }).name) : tools.length === 1 ? tools[0] : undefined;
    const last = req.messages.at(-1);
    const isFix = Array.isArray(last?.content) && last.content.some((b) => b.type === "tool_result" && b.is_error);
    const parentJobId = isFix ? op?.lastJob : undefined;

    return new Promise<ClaudeResponse>((resolve, reject) => {
      const job: Job = { id: ++this.seq, opId: op?.id, req, parentJobId, tool, state: "queued", at: Date.now(), resolve, reject };
      const abort = () => {
        if (job.state === "answered") return;
        this.jobs.delete(job.id);
        reject(stopped());
        this.changed();
      };
      for (const s of signals) s.addEventListener("abort", abort, { once: true });
      if (op) op.lastJob = job.id;
      this.jobs.set(job.id, job);
      this.changed();
    });
  }

  private laneOf(j: Job): Lane {
    return (j.opId !== undefined && this.ops.get(j.opId)?.lane) || "study";
  }

  pending(lane?: Lane): number {
    return [...this.jobs.values()].filter((j) => j.state === "queued" && (!lane || this.laneOf(j) === lane)).length;
  }

  jobLane(jobId: number): Lane | undefined {
    const j = this.jobs.get(jobId);
    return j && this.laneOf(j);
  }

  /** A chat is working through build jobs right now: a new build joins it instead of asking for another "▶️ Building the plan". */
  buildChatActive(): boolean {
    return Date.now() - this.servedAt < 3 * 60_000 && [...this.ops.values()].some((o) => o.lane === "build" && !o.settled);
  }

  /** Jobs of the lane a chat may take: queued ones, and shown ones of a lane silent for RESHOW_MS (their chat stopped). */
  private servable(lane: Lane, reshow: boolean): Job[] {
    return [...this.jobs.values()].filter((j) => (j.state === "queued" || (reshow && j.state === "shown")) && this.laneOf(j) === lane);
  }

  private touch(lane: Lane): boolean {
    const now = Date.now();
    const silent = now - this.lastActive[lane] > RESHOW_MS;
    this.lastActive[lane] = now;
    if (lane === "build") this.servedAt = now;
    return silent;
  }

  /** shalav_next_job */
  next(lane: Lane = "study", reshow = this.touch(lane)): Content[] {
    const jobs = this.servable(lane, reshow);
    if (!jobs.length) {
      if (lane === "study") return [{ type: "text", text: "No Shalav job is pending." }];
      const running = [...this.ops.values()].some((o) => o.lane === "build" && !o.settled);
      return [{ type: "text", text: running ? "Build work is still running (reading files): call shalav_next_job with build: true again." : "No build work is pending." }];
    }
    return this.show(jobs);
  }

  /** Claims up to PER_CALL of `jobs` (the first always; more while their images fit) and renders them as one result. */
  private show(jobs: Job[]): Content[] {
    const picked: Job[] = [];
    let bytes = 0;
    for (const j of jobs) {
      const size = j.req.messages.flatMap((m) => (typeof m.content === "string" ? [] : m.content)).reduce((n, b) => n + (b.type === "image" ? String((b.source as { data?: string }).data ?? "").length : 0), 0);
      if (picked.length && (picked.length >= PER_CALL || bytes + size > IMAGE_BYTES)) break;
      picked.push(j);
      bytes += size;
    }
    for (const j of picked) j.state = "shown";
    if (picked.length === 1) return this.render(picked[0] as Job);
    return [
      { type: "text", text: `${picked.length} jobs are ready: ${picked.map((j) => "#" + j.id).join(", ")}. Answer each with its own shalav_submit_job; calling them in parallel is fine.\n\n` },
      ...picked.flatMap((j) => this.render(j)),
    ];
  }

  /** shalav_next_job: like next(), but if an operation of the lane is still running (its first request not parked yet) wait for it, up to 20 s. */
  async nextWait(lane: Lane = "study", signal?: AbortSignal): Promise<Content[]> {
    const reshow = this.touch(lane);
    const deadline = Date.now() + 20_000;
    // The host cancelled this call (Stop): the ops it waited for will not be served.
    const off = onAbort(signal, () => [...this.ops.values()].filter((o) => o.lane === lane && !o.settled).forEach((o) => this.cancel(o.id)));
    try {
      while (this.servable(lane, reshow).length === 0 && [...this.ops.values()].some((o) => o.lane === lane && !o.settled) && Date.now() < deadline && !signal?.aborted) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, deadline - Date.now());
          this.listeners.add(() => (clearTimeout(t), resolve()));
        });
      }
    } finally {
      off();
    }
    return this.next(lane, reshow);
  }

  /** shalav_submit_job: resolve the parked promise, then wait for the next job / the final result / an error. */
  async submit(a: { jobId: number; input?: unknown; text?: string }, signal?: AbortSignal): Promise<{ content: Content[]; isError?: boolean }> {
    const job = this.jobs.get(a.jobId);
    if (!job || job.state !== "shown") return err(`Job #${a.jobId} is not waiting for an answer.`);
    let block: Block;
    if (job.tool) {
      if (a.input === undefined || typeof a.input !== "object" || a.input === null) {
        return err(`Job #${job.id} needs "input" matching the schema of ${job.tool.name}.`);
      }
      block = { type: "tool_use", id: `job-${job.id}`, name: job.tool.name, input: a.input };
    } else {
      if (typeof a.text !== "string") return err(`Job #${job.id} needs "text".`);
      block = { type: "text", text: a.text };
    }
    job.state = "answered";
    this.jobs.delete(job.id);
    job.resolve({ content: [block], stopReason: job.tool ? "tool_use" : "end_turn", usage: NO_USAGE, model: "host" });

    const op = job.opId === undefined ? undefined : this.ops.get(job.opId);
    if (!op) return { content: [{ type: "text", text: "Answer received." }] };
    this.touch(op.lane);
    // The host cancelled this call while it waited for the op's next step: nobody will answer it.
    const off = onAbort(signal, () => this.cancel(op.id));
    try {
      return await this.wait(op);
    } finally {
      off();
    }
  }

  private async wait(op: Op): Promise<{ content: Content[]; isError?: boolean }> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      await new Promise((r) => setImmediate(r)); // let the domain code run up to its next send()
      if (op.settled) {
        // Hand-off: another build pressed meanwhile continues in this chat.
        const more = op.lane === "build" && [...this.ops.values()].some((o) => o.lane === "build" && !o.settled)
          ? [{ type: "text" as const, text: "\n\nMore Shalav build work is pending (another course): call shalav_next_job with build: true now and keep going until it says no build work is pending." }]
          : [];
        if (op.error) {
          const e = err(`${op.label} failed: ${op.error instanceof Error ? op.error.message : String(op.error)}\nTell the student; they can press Try again in the card.`);
          return { ...e, content: [...e.content, ...more] };
        }
        return { content: [...op.summary(op.result), ...more] };
      }
      // A build chat takes any course's queued build job while its own op waits (e.g. for an index queue slot held by another course).
      const queued = [...this.jobs.values()].filter((j) => j.state === "queued");
      const own = queued.filter((j) => j.opId === op.id);
      const ready = op.lane === "build" ? [...own, ...queued.filter((j) => j.opId !== op.id && this.laneOf(j) === "build")] : own;
      if (ready.length) return { content: [{ type: "text", text: "Next job is ready.\n\n" }, ...this.show(ready)] };
      const open = [...this.jobs.values()].filter((j) => j.state === "shown" && j.opId === op.id);
      if (open.length) return { content: [{ type: "text", text: `Answer the other open job(s) of ${op.label} too: ${open.map((j) => "#" + j.id).join(", ")}.` }] };
      const left = deadline - Date.now();
      if (left <= 0) return { content: [{ type: "text", text: `${op.label} is still working. Call shalav_next_job${op.lane === "build" ? " with build: true" : ""} in a moment.` }] };
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, left);
        this.listeners.add(() => {
          clearTimeout(t);
          resolve();
        });
      });
    }
  }

  private changed() {
    for (const l of [...this.listeners]) l();
    this.listeners.clear();
  }

  private render(job: Job): Content[] {
    const { req } = job;
    const out: Content[] = [];
    const text: string[] = [`# Shalav job #${job.id}${job.opId ? ` (${this.ops.get(job.opId)?.label})` : ""} — ${req.task}`];
    const dup = (key: string, label: string): string | undefined => {
      key = `${job.opId ?? "-"}:${key}`;
      const n = this.seen.get(key);
      if (n !== undefined && n !== job.id) return `Same ${label} as job #${n}.`;
      this.seen.set(key, job.id);
      return undefined;
    };

    if (job.parentJobId) {
      text.push(`This continues job #${job.parentJobId}; only the new message is shown.`);
    } else {
      text.push("## Instructions", dup(`sys:${req.system}`, "instructions") ?? req.system);
    }
    const msgs = job.parentJobId ? req.messages.slice(-1) : req.messages;
    msgs.forEach((m, i) => {
      const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      const first = !job.parentJobId && i === 0 && m.role === "user";
      if (first && dup(`msg:${JSON.stringify(m.content)}`, "first message")) {
        text.push(`## ${m.role === "user" ? "Request" : "You"}`, `Same first message as an earlier job (see above).`);
        return;
      }
      for (const b of blocks) {
        if (b.type === "text") text.push(`## ${m.role === "user" ? "Request" : "You said"}`, String(b.text));
        else if (b.type === "tool_use") text.push("## You answered", JSON.stringify(b.input));
        else if (b.type === "tool_result") {
          text.push(b.is_error ? "## Fix these problems" : "## Result", String(b.content));
        } else if (b.type === "image") {
          const src = b.source as { data: string; media_type: string };
          out.push({ type: "text", text: text.splice(0).join("\n\n") }, { type: "image", data: src.data, mimeType: src.media_type });
        }
      }
    });

    // The schema is skipped only when the job shown just before in this lane had it: one message back, never lost to a compacted chat.
    const lane = this.laneOf(job);
    const schema = job.tool ? JSON.stringify(job.tool.input_schema) : "";
    const prev = this.lastSchema[lane]?.text === schema ? this.lastSchema[lane]?.job : undefined;
    this.lastSchema[lane] = schema ? { text: schema, job: job.id } : undefined;
    text.push(
      "## How to answer",
      !job.tool
        ? `Call shalav_submit_job with jobId ${job.id} and "text".`
        : prev !== undefined
          ? `Call shalav_submit_job with jobId ${job.id} and "input" matching the same JSON schema as job #${prev} (tool ${job.tool.name}).`
          : `Call shalav_submit_job with jobId ${job.id} and "input" matching this JSON schema (tool ${job.tool.name}):\n${schema}`,
    );
    // Prompts written for the v1 forced tool say "Call <tool>"; here the answer goes through shalav_submit_job.
    const body = job.tool ? text.join("\n\n").replaceAll(`Call ${job.tool.name}`, "Answer (see How to answer)") : text.join("\n\n");
    out.push({ type: "text", text: body });
    return out.filter((c) => c.type !== "text" || c.text);
  }
}

const onAbort = (s: AbortSignal | undefined, f: () => void): (() => void) => {
  if (!s) return () => undefined;
  if (s.aborted) return f(), () => undefined;
  s.addEventListener("abort", f, { once: true });
  return () => s.removeEventListener("abort", f);
};

const err = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
