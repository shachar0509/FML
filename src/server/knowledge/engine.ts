import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

/** One engine call: the tool's structured result. Throws on a tool error. `warm` (R8): start the process ahead of the calls. */
export type Engine = { call(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>; warm?(): Promise<void> | undefined };

type Slot = { client: Promise<Client>; queue: Promise<unknown>; idle?: ReturnType<typeof setTimeout>; used: number };

/**
 * One tutor-mcp process per course (`--local --data-dir <course>/.shalav/knowledge`), so each course's graph lives in its folder.
 * Started on first use, closed after `idleMs`, at most `max` at once (the least recently used is closed first).
 * Calls to one course run one at a time: graph revisions are versioned and a second writer would be rejected.
 */
export class EnginePool {
  private slots = new Map<string, Slot>();
  constructor(
    private bin: () => Promise<string>,
    private dataDir: (course: string) => string,
    private opts = { idleMs: 10 * 60_000, max: 2 },
  ) {}

  get(course: string): Engine {
    return {
      call: (name, args) => {
        const s = this.slot(course);
        const run = s.queue.then(async () => {
          const c = await s.client;
          const r = await c.callTool({ name, arguments: args });
          const text = (r.content as { type: string; text?: string }[] | undefined)?.map((x) => x.text ?? "").join("") ?? "";
          if (r.isError) throw new Error(`${name}: ${text}`);
          if (r.structuredContent) return r.structuredContent as Record<string, unknown>;
          try {
            return JSON.parse(text) as Record<string, unknown>;
          } catch {
            return { text };
          }
        });
        s.queue = run.catch(() => undefined);
        return run.finally(() => this.touch(course));
      },
      warm: () => this.warm(course),
    };
  }

  /**
   * R8: start this course's process now, into a free slot only, so a warm never closes another course's engine.
   * No-op when it already runs or the pool is full (then the first call starts it, as before).
   * Resolves once it is up and rejects when the start fails.
   */
  warm(course: string): Promise<void> | undefined {
    if (this.slots.has(course) || this.slots.size >= this.opts.max) return undefined;
    return this.slot(course).client.then(() => this.touch(course)); // a warmed engine nobody calls still idles out
  }

  private slot(course: string): Slot {
    let s = this.slots.get(course);
    if (s) {
      s.used = Date.now();
      return s;
    }
    while (this.slots.size >= this.opts.max) {
      const [oldest] = [...this.slots.entries()].sort((a, b) => a[1].used - b[1].used);
      if (!oldest) break;
      void this.close(oldest[0]);
    }
    const client = (async () => {
      const c = new Client({ name: "shalav", version: "1" });
      await c.connect(new StdioClientTransport({ command: await this.bin(), args: ["--local", "--data-dir", this.dataDir(course)], stderr: "ignore" }));
      return c;
    })();
    s = { client, queue: client.catch(() => undefined), used: Date.now() };
    client.catch(() => this.slots.delete(course)); // a failed start is retried on the next call
    this.slots.set(course, s);
    return s;
  }

  private touch(course: string) {
    const s = this.slots.get(course);
    if (!s) return;
    if (s.idle) clearTimeout(s.idle);
    s.idle = setTimeout(() => void this.close(course), this.opts.idleMs);
    s.idle.unref?.();
  }

  async close(course: string) {
    const s = this.slots.get(course);
    if (!s) return;
    this.slots.delete(course);
    if (s.idle) clearTimeout(s.idle);
    await s.client.then((c) => c.close()).catch(() => undefined);
  }

  async closeAll() {
    await Promise.all([...this.slots.keys()].map((k) => this.close(k)));
  }
}
