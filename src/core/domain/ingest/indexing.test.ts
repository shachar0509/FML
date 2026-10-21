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
    const gw = new FakeClaudeGateway([
      (r) => toolCall("submit_material_pages", {
        pages: pagesIn(r).map((p) => ({ page: p, stageIds: ["S002", "S999"], summary: "s", hasFigure: false, hasExercises: p === 3 })),
      }),
      (r) => toolCall("submit_material_pages", { pages: pagesIn(r).map((p) => ({ page: p, stageIds: [], summary: "s", hasFigure: true, hasExercises: false })) }),
      toolCall("submit_exercises", { exercises: [ex("q1", { figures: [{ page: 3, bbox: [0, 0.1, 2, 0.5] }] })] }),
    ]);
    const out = await indexMaterial(opts(gw, src(10), rec()));
    expect(gw.calls.map((c) => pagesIn(c).length)).toEqual([8, 2, 1]);
    expect(gw.calls[0]?.task).toBe("index");
    expect((gw.calls[0]?.messages[0]?.content as { type: string }[]).filter((b) => b.type === "image")).toHaveLength(1);
    expect((gw.calls[0]?.messages[0]?.content as { text?: string }[])[0]?.text?.length).toBeLessThan(6020);
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
    const gw = new FakeClaudeGateway([
      toolCall("submit_exercises", { exercises: [ex("a"), ex("b", { requiredStageIds: ["S001", "S003"], figures: [{ page: 1, bbox: [0, 0, 1, 1] }] })] }),
      toolCall("submit_exercises", { exercises: [ex("b", { requiredStageIds: ["S001", "S003"] }), ex("c", { requiredStageIds: ["S404"] })] }),
    ]);
    const source = src(11, { crop: async () => { throw new Error("boom"); } });
    const out = await indexExercises(opts(gw, source, rec({ role: "exercises" })));
    expect(gw.calls.map((c) => pagesIn(c))).toEqual([[1, 2, 3, 4, 5, 6], [6, 7, 8, 9, 10, 11]]);
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

  it("one file per course, two globally, skips indexed, resumes pending/indexing", async () => {
    await seed("A", "a1", { status: "pending" });
    await seed("A", "a2", { status: "indexing" });
    await seed("B", "b1");
    await seed("C", "c1");
    await seed("C", "c2", { status: "indexed" });
    const { q, events, max } = mk();
    await q.resume(["A", "B", "C"]);
    await q.idle();
    expect((await readFileIndex("A", "a2"))?.status).toBe("indexed");
    expect((await readFileIndex("C", "c1"))?.status).toBe("indexed");
    expect(new Set(events.filter((e) => e.endsWith(":indexing"))).size).toBe(4);
    expect(events.some((e) => e.startsWith("C:c2"))).toBe(false);
    expect(max()).toBe(2);
    // never two A files at once: a2 starts after a1 is indexed
    expect(events.indexOf("A:a2:indexing")).toBeGreaterThan(events.indexOf("A:a1:indexed"));
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
});
