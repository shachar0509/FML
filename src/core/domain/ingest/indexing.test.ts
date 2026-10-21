import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import type { ClaudeRequest } from "@/core/claude/types";
import type { FileIndex, PlanJson } from "@/core/domain/dataSchemas";
import { setFs } from "@/core/lib/fs/fs";
import { memFs } from "@/test/memfs";
import { indexExercises, indexMaterial, pageTokenEstimate } from "./index";
import { readFileIndex, writeFileIndex } from "./indexStore";
import { createIndexQueue } from "./queue";
import { PasswordProtectedError, type PageSource } from "./types";

let m: ReturnType<typeof memFs>;
beforeEach(() => setFs((m = memFs())));

const course = { courseNumber: "01040195", nameHe: "קורס" };
const plan = { version: 3, stages: [1, 2, 3].map((n) => ({ id: `S00${n}`, order: n, title: `t${n}` })) } as unknown as PlanJson;
const rec = (o: Partial<FileIndex> = {}): FileIndex => ({
  schema: 1, sha256: "abcdef0123456789", fileName: "f.pdf", relPath: "materials/f.pdf", role: "material", mediaType: "application/pdf",
  pageCount: 10, addedAt: "2026-01-01T00:00:00.000Z", status: "pending", error: null, indexedAt: null, indexModel: null, planVersion: null,
  materialPages: [], exercises: [], ...o,
});
const src = (n: number, over: Partial<PageSource> = {}): PageSource => ({
  pageCount: n,
  text: async (p) => `text${p}`.padEnd(9000, "x"),
  imageNeeded: async (p) => p === 1,
  image: async () => ({ base64: "AAA", mediaType: "image/jpeg" }),
  crop: async () => ({ bytes: new Uint8Array([1]), ext: "png" }),
  close() {},
  ...over,
});
const opts = (gw: FakeClaudeGateway, source: PageSource, r: FileIndex) => ({ gw, source, rec: r, plan, course, lang: "en" as const });
const pagesIn = (req: ClaudeRequest) =>
  (req.messages[0]?.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => Number(/^Page (\d+)/.exec(b.text ?? "")?.[1]));
const ex = (label: string, o: object = {}) => ({
  label, pages: [1], statementMd: `stmt ${label}`, figures: [], referenceSolutionMd: null, requiredStageIds: ["S001", "S002"],
  difficulty: 3, type: "proof", estimatedMinutes: 10, edgeCaseFocus: [], gist: "g", ...o,
});

describe("indexing", () => {
  it("pageTokenEstimate", () => expect(pageTokenEstimate(70)).toBe(154000));

  it("material: batches of 8, drops unknown stages, truncates, chains exercise extraction", async () => {
    // batches run in parallel, so replies go by the pages asked, not by call order
    const reply = (r: ClaudeRequest) =>
      r.tools?.[0]?.name === "submit_exercises"
        ? toolCall("submit_exercises", { exercises: [ex("q1", { figures: [{ page: 3, bbox: [0, 0.1, 2, 0.5] }], edgeCaseFocus: ["x = 2 is outside the domain"], keyPoints: ["divide by the leading term"] })] })
        : toolCall("submit_material_pages", {
            pages: pagesIn(r).map((p) => (p <= 8 ? { page: p, stageIds: ["S002", "S999"], summary: "s", hasFigure: false, hasExercises: p === 3, ...(p === 3 ? { notes: ["check the domain"] } : p < 9 ? { notes: [] } : {}) } : { page: p, stageIds: [], summary: "s", hasFigure: true, hasExercises: false })),
          });
    const gw = new FakeClaudeGateway([reply, reply, reply]);
    const out = await indexMaterial(opts(gw, src(10), rec()));
    expect(gw.calls.map((c) => pagesIn(c).length).sort()).toEqual([1, 2, 8]);
    expect(gw.calls.at(-1)?.tools?.[0]?.name).toBe("submit_exercises"); // after every material batch
    const first = gw.calls.find((c) => pagesIn(c)[0] === 1) as ClaudeRequest;
    expect(first.task).toBe("index");
    expect((first.messages[0]?.content as { type: string }[]).filter((b) => b.type === "image")).toHaveLength(1);
    expect((first.messages[0]?.content as { text?: string }[])[0]?.text?.length).toBeLessThan(6020);
    expect(out.materialPages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(out.materialPages[2]?.notes).toEqual(["check the domain"]);
    expect(out.materialPages[9]?.notes).toEqual([]); // a model may leave it out: defaults to none
    expect(out.exercises[0]).toMatchObject({ edgeCaseFocus: ["x = 2 is outside the domain"], keyPoints: ["divide by the leading term"] });
    expect(out.status).toBe("indexed");
    expect(out.planVersion).toBe(3);
    expect(out.materialPages).toHaveLength(10);
    expect(out.materialPages[0]?.stageIds).toEqual(["S002"]);
    expect(out.materialPages[0]?.text).toHaveLength(8000);
    expect(out.exercises[0]?.id).toBe("abcdef01-1");
    expect(out.exercises[0]?.figureCrops[0]).toMatchObject({ bbox: [0, 0.1, 1, 0.5], file: ".shalav/index/crops/abcdef01-1-1.png" });
    expect(m.bytes.size).toBe(1);
  });

  it("exercises: 6-page windows with 1-page overlap, dedupe, ids, stage fallback, crop failure tolerated", async () => {
    // the second window answers first: ids and the overlap dedupe still follow page order
    let inFlight = 0;
    let most = 0;
    const gw = {
      calls: [] as ClaudeRequest[],
      async send(r: ClaudeRequest) {
        gw.calls.push(r);
        most = Math.max(most, ++inFlight);
        const firstWindow = pagesIn(r)[0] === 1;
        await new Promise((ok) => setTimeout(ok, firstWindow ? 20 : 1));
        inFlight--;
        return { usage: {} as never, model: "m", ...(firstWindow
          ? toolCall("submit_exercises", { exercises: [ex("a"), ex("b", { requiredStageIds: ["S001", "S003"], figures: [{ page: 1, bbox: [0, 0, 1, 1] }] })] })
          : toolCall("submit_exercises", { exercises: [ex("b", { requiredStageIds: ["S001", "S003"] }), ex("c", { requiredStageIds: ["S404"] })] })) } as never;
      },
    };
    const source = src(11, { crop: async () => { throw new Error("boom"); } });
    const out = await indexExercises({ ...opts(gw as never, source, rec({ role: "exercises" })) });
    expect(gw.calls.map((c) => pagesIn(c)).sort()).toEqual([[1, 2, 3, 4, 5, 6], [6, 7, 8, 9, 10, 11]]);
    expect(most).toBe(2); // both windows at once
    expect(out.exercises.map((e) => e.id)).toEqual(["abcdef01-1", "abcdef01-2", "abcdef01-3"]);
    expect(out.exercises[1]?.primaryStageId).toBe("S003");
    expect(out.exercises[1]?.figureCrops).toEqual([]);
    expect(out.exercises[2]?.requiredStageIds).toEqual(["S003"]);
    expect(out.exercises[2]?.primaryStageId).toBe("S003");
  });
});

describe("queue", () => {
  const mk = (over: object = {}) => {
    let active = 0;
    let maxActive = 0;
    const gw = {
      async send(req: ClaudeRequest) {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return { ...toolCall("submit_material_pages", { pages: pagesIn(req).map((page) => ({ page, stageIds: [], summary: "", hasFigure: false, hasExercises: false })) }), usage: {} as never, model: "m" } as never;
      },
    };
    const q = createIndexQueue({
      gw: () => gw, open: async () => src(2), getPlan: async () => plan, course: async () => course, lang: () => "en",
      resolve: (c, r) => `/${c}/${r.relPath}`, ...over,
    });
    const events: string[] = [];
    q.subscribe((e) => events.push(`${e.course}:${e.sha256}:${e.status}`));
    return { q, events, max: () => maxActive };
  };
  const seed = async (c: string, sha: string, o: Partial<FileIndex> = {}) => writeFileIndex(c, rec({ sha256: sha, ...o }));

  it("two files per course, three globally, skips indexed, resumes pending/indexing", async () => {
    await seed("A", "a1", { status: "pending" });
    await seed("A", "a2", { status: "indexing" });
    await seed("A", "a3");
    await seed("B", "b1");
    await seed("C", "c1");
    await seed("C", "c2", { status: "indexed" });
    const { q, events, max } = mk();
    await q.resume(["A", "B", "C"]);
    await q.idle();
    expect((await readFileIndex("A", "a2"))?.status).toBe("indexed");
    expect((await readFileIndex("C", "c1"))?.status).toBe("indexed");
    expect(new Set(events.filter((e) => e.endsWith(":indexing"))).size).toBe(5);
    expect(events.some((e) => e.startsWith("C:c2"))).toBe(false);
    expect(max()).toBe(3);
    // two A files at once (a1, a2), never three: a3 starts after one of them is indexed
    expect(events.indexOf("A:a2:indexing")).toBeLessThan(events.indexOf("A:a1:indexed"));
    expect(events.indexOf("A:a3:indexing")).toBeGreaterThan(Math.min(events.indexOf("A:a1:indexed"), events.indexOf("A:a2:indexed")));
  });

  it("fails without a plan, on password-protected PDFs, and retries", async () => {
    await seed("A", "a1");
    await seed("A", "a2");
    const noPlan = mk({ getPlan: async () => null });
    noPlan.q.enqueue("A", "a1");
    await noPlan.q.idle();
    expect(await readFileIndex("A", "a1")).toMatchObject({ status: "failed", error: "No plan yet" });

    const pw = mk({ open: async () => { throw new PasswordProtectedError(); } });
    pw.q.enqueue("A", "a2");
    await pw.q.idle();
    expect(await readFileIndex("A", "a2")).toMatchObject({ status: "failed", error: "Password-protected PDF" });

    const ok = mk();
    await ok.q.retry("A", "a1");
    await ok.q.idle();
    expect(await readFileIndex("A", "a1")).toMatchObject({ status: "indexed", error: null });
  });

  it("large files need confirmation; declined stays pending without looping", async () => {
    await seed("A", "a1", { pageCount: 61 });
    let asked = 0;
    const { q, events } = mk({ confirmLarge: async () => (asked++, false) });
    q.enqueue("A", "a1");
    await q.idle();
    expect(asked).toBe(1);
    expect((await readFileIndex("A", "a1"))?.status).toBe("pending");
    expect(events).toEqual([]);
  });

  it("a file removed while it is indexed or queued leaves no record, and idle still resolves", async () => {
    for (const k of [1, 2, 3]) await seed("A", `a${k}`);
    const drop = (sha: string) => [...m.files.keys()].filter((k) => k.endsWith(`/files/${sha}.json`)).forEach((k) => m.files.delete(k));
    // a1 is removed while its pages are being read; a3 (third of one course: waits for a slot) while still queued
    const { q, events } = mk({ open: async (o: { sha256: string }) => (o.sha256 === "a1" && (drop("a1"), drop("a3")), src(2)) });
    for (const k of [1, 2, 3]) q.enqueue("A", `a${k}`);
    await q.idle("A");
    expect(await readFileIndex("A", "a1")).toBeNull();
    expect(await readFileIndex("A", "a3")).toBeNull();
    expect((await readFileIndex("A", "a2"))?.status).toBe("indexed");
    expect(events).toContain("A:a1:removed");
    expect(events).toContain("A:a3:removed");
  });

  it("cancel (file removed) stops a running file's AI work and drops a queued one", async () => {
    for (const k of [1, 2, 3]) await seed("A", `a${k}`);
    const aborted: string[] = [];
    const { q, events } = mk({
      gw: () => ({
        send: (req: ClaudeRequest) =>
          new Promise((_, reject) => req.signal?.addEventListener("abort", () => (aborted.push(String(pagesIn(req))), reject(new Error("aborted"))))),
      }),
    });
    for (const k of [1, 2, 3]) q.enqueue("A", `a${k}`);
    await new Promise((r) => setTimeout(r, 5));
    q.cancel("A", "a3"); // queued
    for (const k of [1, 2]) q.cancel("A", `a${k}`); // running, waiting on the model
    await q.idle("A");
    expect(aborted).toHaveLength(2);
    for (const k of [1, 2, 3]) expect(events).toContain(`A:a${k}:removed`);
    expect(events.filter((e) => e.endsWith(":failed"))).toEqual([]);
  });

  it("cancel (file removed) stops only that file: its AI work is withdrawn, the other file still indexes", async () => {
    for (const k of [1, 2, 3]) await seed("A", `a${k}`);
    const aborted: string[] = [];
    const { q, events } = mk({
      open: async (o: { sha256: string }) => src(2, { text: async (p) => `${o.sha256} page ${p}` }),
      gw: () => ({
        send: (req: ClaudeRequest) =>
          JSON.stringify(req.messages).includes("a1 page")
            ? new Promise((_, reject) => req.signal?.addEventListener("abort", () => (aborted.push("a1"), reject(new Error("aborted")))))
            : Promise.resolve({ ...toolCall("submit_material_pages", { pages: [1, 2].map((page) => ({ page, stageIds: [], summary: "", hasFigure: false, hasExercises: false })) }), usage: {} as never, model: "m" }),
      }),
    });
    q.enqueue("A", "a1"); // waits on the model until cancelled
    q.enqueue("A", "a3");
    q.enqueue("A", "a2"); // third of one course: queued
    q.cancel("A", "a2"); // queued: dropped
    await new Promise((r) => setTimeout(r, 5));
    q.cancel("A", "a1"); // running: aborted
    await q.idle("A");
    expect(aborted).toEqual(["a1"]);
    expect(events).toContain("A:a1:removed");
    expect(events).toContain("A:a2:removed");
    expect(events.filter((e) => e.endsWith(":failed"))).toEqual([]);
    expect((await readFileIndex("A", "a3"))?.status).toBe("indexed"); // the rest of the build goes on
    expect((await readFileIndex("A", "a2"))?.status).toBe("pending"); // never read (Remove then deletes its record)
  });

  it("each file runs in the context of the build that queued it; idle(course) waits for that course only", async () => {
    const als = new AsyncLocalStorage<string>();
    const seen: [string | undefined, string][] = [];
    for (const c of ["A", "B", "C"]) for (const k of [1, 2]) await seed(c, `${c.toLowerCase()}${k}`);
    const { q } = mk({
      course: async (c: string) => ({ courseNumber: c, nameHe: "x" }),
      bind: () => AsyncLocalStorage.snapshot(),
      gw: () => ({
        async send(req: ClaudeRequest) {
          seen.push([als.getStore(), /course ([ABC]) "/.exec(req.system ?? "")?.[1] ?? "?"]);
          await new Promise((r) => setTimeout(r, 5));
          return { ...toolCall("submit_material_pages", { pages: pagesIn(req).map((page) => ({ page, stageIds: [], summary: "", hasFigure: false, hasExercises: false })) }), usage: {} as never, model: "m" } as never;
        },
      }),
    });
    // three builds, each queues its own files in its own context (two courses run at a time, so C waits for A or B to finish a file)
    const done: string[] = [];
    await Promise.all(
      ["A", "B", "C"].map((c) =>
        als.run(c, async () => {
          for (const k of [1, 2]) await q.retry(c, `${c.toLowerCase()}${k}`);
          await q.idle(c);
          done.push(c);
          for (const k of [1, 2]) expect((await readFileIndex(c, `${c.toLowerCase()}${k}`))?.status).toBe("indexed");
        }),
      ),
    );
    expect(seen.length).toBeGreaterThanOrEqual(6);
    for (const [ctx, c] of seen) expect(ctx).toBe(c);
    expect(done.at(-1)).toBe("C"); // A and B did not wait for C
  });
});
