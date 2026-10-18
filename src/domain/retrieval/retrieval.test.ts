import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/claude/fake";
import { buildKnowledgeBoundary } from "@/domain/boundary/boundary";
import type { FileIndex, PlanJson, ProgressJson } from "@/domain/dataSchemas";
import { setFs } from "@/lib/fs/fs";
import { memFs } from "@/test/memfs";
import { rank, tokenize } from "./bm25";
import { consult, getLessonBrief } from "./retrieve";

beforeEach(() => setFs(memFs()));

const stage = (n: number, o = {}) => ({
  id: `S00${n}`, order: n, title: `t${n}`, objectives: [`obj${n}`], newConcepts: [`c${n}`], theorems: [{ name: `th${n}`, statement: "", proofRequired: false }],
  techniques: [`tech${n}`], ...o,
});
const plan = { version: 2, stages: [1, 2, 3].map((n) => stage(n)) } as unknown as PlanJson;
const st = (status: string) => ({ status });
const progress = { stages: { S001: st("completed"), S002: st("in_progress"), S003: st("locked") } } as unknown as ProgressJson;
const course = { courseNumber: "01040195", nameHe: "קורס", prerequisitesRaw: "none" };

const file = (sha: string, text: string, o: Partial<FileIndex["materialPages"][number]> = {}) =>
  ({
    sha256: sha, fileName: `${sha}.pdf`, role: "material", status: "indexed", addedAt: "",
    materialPages: [{ page: 1, stageIds: ["S002"], summary: "", hasFigure: false, text, ...o }],
  }) as unknown as FileIndex;
const ret = (coverage: string, answerMd = "a", sources = ["x p.1"]) => toolCall("submit_retrieval", { answerMd, coverage, sources, quotes: [] });
const base = { course, plan, progress, stageId: "S002", question: "q", purpose: "p", lang: "English" as const };

describe("boundary", () => {
  it("lists completed, current and not-yet stages", () => {
    const t = buildKnowledgeBoundary({ course, plan, progress, currentStageId: "S002" });
    expect(t).toContain("- Learned: S001 t1: c1; th1; tech1");
    expect(t).toContain("- Being learned now: S002 t2: c2; th2; tech2");
    expect(t).toContain("(do not use, mention or preview): S003 t3");
    expect(buildKnowledgeBoundary({ course, plan, progress, currentStageId: null, hasPhysics: true })).not.toContain("Being learned");
  });
});

describe("bm25", () => {
  it("strips niqqud and Hebrew prefixes", () => {
    expect(tokenize("הַפונקציה")).toEqual(["הפונקציה", "פונקציה"]);
    const r = rank([{ id: "a", text: "משפט על גבול" }, { id: "b", text: "פונקציה רציפה" }], "הפונקציה");
    expect(r[0]?.id).toBe("b");
    expect(r[0]?.score).toBeGreaterThan(0);
  });
});

describe("consult", () => {
  const listIndexes = async () => [file("a", "limits")];
  it("full coverage: one call", async () => {
    const gw = new FakeClaudeGateway([ret("full")]);
    const r = await consult({ gw, listIndexes }, { ...base, webSearch: true });
    expect(r.coverage).toBe("full");
    expect(gw.calls).toHaveLength(1);
    expect(gw.calls[0]?.system).toContain("[a.pdf p.1]\nlimits");
  });
  it("partial + web: merges", async () => {
    const gw = new FakeClaudeGateway([ret("partial", "m", ["x p.1"]), ret("full", "w", ["http://u"])]);
    const r = await consult({ gw, listIndexes }, { ...base, webSearch: true });
    expect(gw.calls).toHaveLength(2);
    expect(gw.calls[1]?.tools?.[0]).toMatchObject({ name: "web_search", max_uses: 3 });
    expect(r).toMatchObject({ answerMd: "m\n\nw", coverage: "partial", sources: ["x p.1", "http://u"] });
  });
  it("ignores web failure and webSearch off", async () => {
    const gw = new FakeClaudeGateway([ret("partial")]);
    expect((await consult({ gw, listIndexes }, { ...base, webSearch: true })).answerMd).toBe("a");
    const gw2 = new FakeClaudeGateway([ret("partial")]);
    await consult({ gw: gw2, listIndexes }, { ...base, webSearch: false });
    expect(gw2.calls).toHaveLength(1);
  });
  it("no materials: skips step 3, web only", async () => {
    const gw = new FakeClaudeGateway([ret("full", "w", ["http://u"])]);
    const r = await consult({ gw, listIndexes: async () => [] }, { ...base, webSearch: true });
    expect(gw.calls).toHaveLength(1);
    expect(r).toMatchObject({ answerMd: "w", coverage: "full" });
    const none = await consult({ gw: new FakeClaudeGateway([]), listIndexes: async () => [] }, { ...base, webSearch: false });
    expect(none.coverage).toBe("none");
  });
});

describe("lesson brief", () => {
  const brief = toolCall("submit_lesson_brief", { briefMd: "b", coverage: "full", sources: ["a.pdf p.1"] });
  it("cached on second call, rebuilt when hash changes", async () => {
    const gw = new FakeClaudeGateway([brief, brief]);
    const d = { gw, listIndexes: async () => [file("a", "limits")] };
    const one = await getLessonBrief(d, { course, plan, stageId: "S002", lang: "English" });
    const two = await getLessonBrief(d, { course, plan, stageId: "S002", lang: "English" });
    expect(gw.calls).toHaveLength(1);
    expect(two).toEqual(one);
    const three = await getLessonBrief({ ...d, listIndexes: async () => [file("b", "limits")] }, { course, plan, stageId: "S002", lang: "English" });
    expect(gw.calls).toHaveLength(2);
    expect(three.hash).not.toBe(one.hash);
  });
  it("no materials: no call", async () => {
    const gw = new FakeClaudeGateway([]);
    const b = await getLessonBrief({ gw, listIndexes: async () => [] }, { course, plan, stageId: "S002", lang: "English" });
    expect(b.coverage).toBe("none");
  });
});
