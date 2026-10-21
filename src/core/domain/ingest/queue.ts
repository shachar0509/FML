import type { ClaudeGateway } from "@/core/claude/types";
import type { FileIndex, PlanJson } from "@/core/domain/dataSchemas";
import { indexExercises, indexMaterial, pageTokenEstimate } from "./index";
import { listFileIndexes, readFileIndex, writeFileIndex } from "./indexStore";
import { PasswordProtectedError, type OpenSource } from "./types";

export type QueueEvent = { course: string; sha256: string; status: FileIndex["status"]; done?: number; total?: number; error?: string | null };
export type QueueDeps = {
  gw: () => ClaudeGateway;
  open: OpenSource;
  getPlan(course: string): Promise<PlanJson | null>;
  course(course: string): Promise<{ courseNumber: string; nameHe: string } | null>;
  lang: () => "he" | "en";
  confirmLarge?: (rec: FileIndex, estTokens: number) => Promise<boolean>;
  resolve(course: string, rec: FileIndex): string;
  /** Captures the caller's async context so a file runs in the operation that queued it, not the one whose file just finished (server: AsyncLocalStorage.snapshot). */
  bind?: () => <R>(fn: () => R) => R;
};

const MAX_GLOBAL = 2;
const LARGE = 60;

/** 5.3: persistent via the index records; one file at a time per course, two globally. */
export function createIndexQueue(deps: QueueDeps) {
  type Item = { course: string; sha256: string; ctx?: <R>(fn: () => R) => R };
  const queue: Item[] = [];
  const busy = new Set<string>(); // courses with a running file
  const declined = new Set<string>();
  const subs = new Set<(e: QueueEvent) => void>();
  let idleWaiters: { course?: string; resolve: () => void }[] = [];
  const emit = (e: QueueEvent) => subs.forEach((cb) => cb(e));
  const key = (course: string, sha: string) => `${course}/${sha}`;

  async function set(course: string, rec: FileIndex, patch: Partial<FileIndex>): Promise<FileIndex> {
    const next = { ...rec, ...patch };
    await writeFileIndex(course, next);
    emit({ course, sha256: rec.sha256, status: next.status, error: next.error });
    return next;
  }

  async function run(course: string, sha256: string) {
    let rec = await readFileIndex(course, sha256);
    if (!rec || rec.status === "indexed" || declined.has(key(course, sha256))) return;
    try {
      const plan = await deps.getPlan(course);
      const head = await deps.course(course);
      if (!plan || !head) {
        await set(course, rec, { status: "failed", error: plan ? "Course not found" : "No plan yet" });
        return;
      }
      if (rec.pageCount > LARGE && deps.confirmLarge && !(await deps.confirmLarge(rec, pageTokenEstimate(rec.pageCount)))) {
        declined.add(key(course, sha256)); // stays pending; retry() asks again
        return;
      }
      rec = await set(course, rec, { status: "indexing", error: null });
      const source = await deps.open({ path: deps.resolve(course, rec), mediaType: rec.mediaType, sha256 });
      try {
        const index = rec.role === "material" ? indexMaterial : indexExercises;
        const out = await index({
          gw: deps.gw(), source, rec, plan, course: head, lang: deps.lang(),
          onProgress: (done, total) => emit({ course, sha256, status: "indexing", done, total }),
        });
        await set(course, out, {});
      } finally {
        source.close();
      }
    } catch (e) {
      const error = e instanceof PasswordProtectedError ? e.message : (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (rec) await set(course, rec, { status: "failed", error });
    }
  }

  function pump() {
    while (busy.size < MAX_GLOBAL) {
      const i = queue.findIndex((q) => !busy.has(q.course));
      if (i < 0) break;
      const [job] = queue.splice(i, 1) as [Item];
      busy.add(job.course);
      const go = () => run(job.course, job.sha256);
      void (job.ctx ? job.ctx(go) : go()).finally(() => {
        busy.delete(job.course);
        pump();
      });
    }
    idleWaiters = idleWaiters.filter((w) => !(isIdle(w.course) && (w.resolve(), true)));
  }

  const isIdle = (course?: string) => (course ? !busy.has(course) && !queue.some((q) => q.course === course) : !busy.size && !queue.length);

  function enqueue(course: string, sha256: string) {
    if (!queue.some((q) => q.course === course && q.sha256 === sha256)) queue.push({ course, sha256, ctx: deps.bind?.() });
    pump();
  }

  return {
    enqueue,
    async retry(course: string, sha256: string) {
      declined.delete(key(course, sha256));
      const rec = await readFileIndex(course, sha256);
      if (rec && rec.status !== "indexed") await set(course, rec, { status: "pending", error: null });
      enqueue(course, sha256);
    },
    async resume(courses: string[]) {
      for (const c of courses)
        for (const r of await listFileIndexes(c)) if (r.status === "pending" || r.status === "indexing") enqueue(c, r.sha256);
    },
    subscribe(cb: (e: QueueEvent) => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    /** Resolves when nothing is queued or running (for `course` only, when given). */
    idle: (course?: string) => (isIdle(course) ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push({ course, resolve }))),
  };
}
