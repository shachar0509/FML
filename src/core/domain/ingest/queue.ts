import type { ClaudeGateway } from "@/core/claude/types";
import type { FileIndex, PlanJson } from "@/core/domain/dataSchemas";
import { indexExercises, indexMaterial, pageTokenEstimate } from "./index";
import { listFileIndexes, readFileIndex, writeFileIndex } from "./indexStore";
import { PasswordProtectedError, type OpenSource } from "./types";

export type QueueEvent = { course: string; sha256: string; status: FileIndex["status"] | "removed"; done?: number; total?: number; error?: string | null };
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

const MAX_GLOBAL = 3;
const PER_COURSE = 2; // files of one course only read the plan and write their own records
const LARGE = 60;

/** 5.3: persistent via the index records; two files at a time per course, three globally. */
export function createIndexQueue(deps: QueueDeps) {
  type Item = { course: string; sha256: string; ctx?: <R>(fn: () => R) => R };
  const queue: Item[] = [];
  const busy = new Map<string, number>(); // running files per course
  let running = 0;
  const declined = new Set<string>();
  const runningFiles = new Map<string, AbortController>(); // key -> the running file's abort (file removed: stop spending the student's model work)
  const subs = new Set<(e: QueueEvent) => void>();
  let idleWaiters: { course?: string; resolve: () => void }[] = [];
  const emit = (e: QueueEvent) => subs.forEach((cb) => cb(e));
  const key = (course: string, sha: string) => `${course}/${sha}`;

  class Removed extends Error {}
  /** Writes the record unless the student removed the file meanwhile (no ghost index for a trashed file). */
  async function set(course: string, rec: FileIndex, patch: Partial<FileIndex>): Promise<FileIndex> {
    const cur = await readFileIndex(course, rec.sha256);
    if (!cur) throw new Removed();
    const next = { ...rec, ...patch, relPath: cur.relPath, fileName: cur.fileName, stamp: cur.stamp }; // renamed in the folder meanwhile: the name as it is now
    await writeFileIndex(course, next);
    emit({ course, sha256: rec.sha256, status: next.status, error: next.error });
    return next;
  }

  async function run(course: string, sha256: string) {
    let rec = await readFileIndex(course, sha256);
    if (!rec) return emit({ course, sha256, status: "removed" }); // removed while queued
    if (rec.status === "indexed" || declined.has(key(course, sha256))) return;
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
      const ctl = new AbortController();
      runningFiles.set(key(course, sha256), ctl);
      rec = await set(course, rec, { status: "indexing", error: null });
      const source = await deps.open({ path: deps.resolve(course, rec), mediaType: rec.mediaType, sha256 });
      try {
        const index = rec.role === "material" ? indexMaterial : indexExercises;
        const out = await index({
          gw: deps.gw(), source, rec, plan, course: head, lang: deps.lang(), signal: ctl.signal,
          onProgress: (done, total) => emit({ course, sha256, status: "indexing", done, total }),
        });
        await set(course, out, {});
      } finally {
        source.close();
      }
    } catch (e) {
      if (e instanceof Removed || runningFiles.get(key(course, sha256))?.signal.aborted) return emit({ course, sha256, status: "removed" });
      const error = e instanceof PasswordProtectedError ? e.message : (e instanceof Error ? e.message : String(e)).slice(0, 200);
      if (rec) await set(course, rec, { status: "failed", error }).catch(() => emit({ course, sha256, status: "removed" }));
    } finally {
      runningFiles.delete(key(course, sha256));
    }
  }

  function pump() {
    while (running < MAX_GLOBAL) {
      const i = queue.findIndex((q) => (busy.get(q.course) ?? 0) < PER_COURSE);
      if (i < 0) break;
      const [job] = queue.splice(i, 1) as [Item];
      busy.set(job.course, (busy.get(job.course) ?? 0) + 1);
      running++;
      const go = () => run(job.course, job.sha256);
      void (job.ctx ? job.ctx(go) : go()).finally(() => {
        running--;
        const n = (busy.get(job.course) ?? 1) - 1;
        if (n) busy.set(job.course, n);
        else busy.delete(job.course);
        pump();
      });
    }
    idleWaiters = idleWaiters.filter((w) => !(isIdle(w.course) && (w.resolve(), true)));
  }

  const isIdle = (course?: string) => (course ? !busy.has(course) && !queue.some((q) => q.course === course) : !running && !queue.length);

  function enqueue(course: string, sha256: string) {
    if (!queue.some((q) => q.course === course && q.sha256 === sha256)) queue.push({ course, sha256, ctx: deps.bind?.() });
    pump();
  }

  return {
    enqueue,
    async retry(course: string, sha256: string) {
      declined.delete(key(course, sha256));
      const rec = await readFileIndex(course, sha256);
      if (rec && rec.status !== "indexed") {
        try {
          await set(course, rec, { status: "pending", error: null });
        } catch {
          return emit({ course, sha256, status: "removed" }); // removed meanwhile: nothing to read
        }
      }
      enqueue(course, sha256);
    },
    async resume(courses: string[]) {
      for (const c of courses)
        for (const r of await listFileIndexes(c)) if (r.status === "pending" || r.status === "indexing") enqueue(c, r.sha256);
    },
    /** The student removes the file: drop it from the queue and stop reading it (its pending AI jobs are withdrawn). */
    cancel(course: string, sha256: string) {
      const i = queue.findIndex((q) => q.course === course && q.sha256 === sha256);
      if (i >= 0) {
        queue.splice(i, 1);
        emit({ course, sha256, status: "removed" });
        pump();
      }
      runningFiles.get(key(course, sha256))?.abort();
    },
    subscribe(cb: (e: QueueEvent) => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
    /** Resolves when nothing is queued or running (for `course` only, when given). */
    idle: (course?: string) => (isIdle(course) ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push({ course, resolve }))),
  };
}
