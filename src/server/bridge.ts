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
  resolve(r: ClaudeResponse): void;
  reject(e: unknown): void;
};

type Op = {
  id: number;
  label: string;
  ctl: AbortController;
  settled: boolean;
  lastJob?: number;
  /** The answer schema the op's last shown job carried (it is not repeated right after). */
  lastSchema?: { text: string; job: number };
  result?: unknown;
  error?: unknown;
  summary: (result: unknown) => Content[];
};

const NO_USAGE = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
const WAIT_MS = 45_000;

export class BridgeGateway implements ClaudeGateway {
  private jobs = new Map<number, Job>();
  private ops = new Map<number, Op>();
  private seq = 0;
  private opSeq = 0;
  private als = new AsyncLocalStorage<Op>();
  private listeners = new Set<() => void>();
  /** Dedupe (5.2): `${opId}:${text}` already shown -> job number. Per op, not per server: the server outlives a chat. */
  private seen = new Map<string, number>();

  /** Run a domain operation; every send() made inside it belongs to it and can be cancelled together. */
  run<T>(label: string, fn: (signal: AbortSignal) => Promise<T>, summary?: (r: T) => Content[]): { opId: number; done: Promise<T> } {
    const op: Op = {
      id: ++this.opSeq,
      label,
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

  send(req: ClaudeRequest): Promise<ClaudeResponse> {
    const op = this.als.getStore();
    const signals = [req.signal, op?.ctl.signal].filter((s): s is AbortSignal => !!s);
    if (signals.some((s) => s.aborted)) return Promise.reject(new ClaudeError("aborted", "aborted"));

    const tools = (req.tools ?? []).filter((t): t is ToolDef => "input_schema" in t); // server tools are dropped
    const tool = req.toolChoice?.type === "tool" ? tools.find((t) => t.name === (req.toolChoice as { name: string }).name) : tools.length === 1 ? tools[0] : undefined;
    const last = req.messages.at(-1);
    const isFix = Array.isArray(last?.content) && last.content.some((b) => b.type === "tool_result" && b.is_error);
    const parentJobId = isFix ? op?.lastJob : undefined;

    return new Promise<ClaudeResponse>((resolve, reject) => {
      const job: Job = { id: ++this.seq, opId: op?.id, req, parentJobId, tool, state: "queued", resolve, reject };
      const abort = () => {
        if (job.state === "answered") return;
        this.jobs.delete(job.id);
        reject(new ClaudeError("aborted", "aborted"));
        this.changed();
      };
      for (const s of signals) s.addEventListener("abort", abort, { once: true });
      if (op) op.lastJob = job.id;
      this.jobs.set(job.id, job);
      this.changed();
    });
  }

  /** No AI job queued or waiting for an answer. */
  idle(): boolean {
    return this.jobs.size === 0;
  }

  pending(): number {
    return [...this.jobs.values()].filter((j) => j.state === "queued").length;
  }

  /** shalav_next_job */
  next(): Content[] {
    const job = [...this.jobs.values()].find((j) => j.state === "queued");
    if (!job) return [{ type: "text", text: "No Shalav job is pending." }];
    job.state = "shown";
    return this.render(job);
  }

  /** shalav_next_job: like next(), but if an operation is still running (its first request not parked yet) wait for it, up to 20 s. */
  async nextWait(): Promise<Content[]> {
    const deadline = Date.now() + 20_000;
    while (this.pending() === 0 && [...this.ops.values()].some((o) => !o.settled) && Date.now() < deadline) {
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, deadline - Date.now());
        this.listeners.add(() => (clearTimeout(t), resolve()));
      });
    }
    return this.next();
  }

  /** shalav_submit_job: resolve the parked promise, then wait for the next job / the final result / an error. */
  async submit(a: { jobId: number; input?: unknown; text?: string }): Promise<{ content: Content[]; isError?: boolean }> {
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
    return this.wait(op);
  }

  private async wait(op: Op): Promise<{ content: Content[]; isError?: boolean }> {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      await new Promise((r) => setImmediate(r)); // let the domain code run up to its next send()
      if (op.settled) {
        if (op.error) return err(`${op.label} failed: ${op.error instanceof Error ? op.error.message : String(op.error)}\nTell the student; they can press Try again in the card.`);
        return { content: op.summary(op.result) };
      }
      const nextJob = [...this.jobs.values()].find((j) => j.state === "queued" && j.opId === op.id);
      if (nextJob) {
        nextJob.state = "shown";
        return { content: [{ type: "text", text: "Next job is ready.\n\n" }, ...this.render(nextJob)] };
      }
      const open = [...this.jobs.values()].filter((j) => j.state === "shown" && j.opId === op.id);
      if (open.length) return { content: [{ type: "text", text: `Answer the other open job(s) of ${op.label} too: ${open.map((j) => "#" + j.id).join(", ")}.` }] };
      const left = deadline - Date.now();
      if (left <= 0) return { content: [{ type: "text", text: `${op.label} is still working. Call shalav_next_job in a moment.` }] };
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

    // The schema is skipped only when the job shown just before in this op had it: one message back, never lost to a compacted chat.
    const op = job.opId === undefined ? undefined : this.ops.get(job.opId);
    const schema = job.tool ? JSON.stringify(job.tool.input_schema) : "";
    const prev = op?.lastSchema?.text === schema ? op.lastSchema.job : undefined;
    if (op) op.lastSchema = schema ? { text: schema, job: job.id } : undefined;
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

const err = (message: string) => ({ content: [{ type: "text" as const, text: message }], isError: true });
