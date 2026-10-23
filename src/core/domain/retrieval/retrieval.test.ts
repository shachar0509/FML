import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { buildKnowledgeBoundary } from "@/core/domain/boundary/boundary";
import type { FileIndex, PlanJson, ProgressJson } from "@/core/domain/dataSchemas";
import { setFs } from "@/core/lib/fs/fs";
import { memFs } from "@/test/memfs";
import { rank, TOKEN_CACHE_MAX, tokenCache, tokenize } from "./bm25";
import { consult, getLessonBrief, materialsLang, pagesFor } from "./retrieve";

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

describe("materialsLang (M49)", () => {
  const gw = new FakeClaudeGateway([]);
  it("is the language most material text is in; null without materials", async () => {
    const he = file("a", "הגדרה: סדרה $a_n$ מתכנסת לגבול $L$ אם לכל אפסילון קיים N");
    const en = file("b", "A sequence converges if for every epsilon there is an N");
    expect(await materialsLang({ gw, listIndexes: async () => [he] }, course)).toBe("Hebrew");
    expect(await materialsLang({ gw, listIndexes: async () => [en] }, course)).toBe("English");
    expect(await materialsLang({ gw, listIndexes: async () => [he, he, en] }, course)).toBe("Hebrew");
    expect(await materialsLang({ gw, listIndexes: async () => [] }, course)).toBeNull();
  });
});

describe("materialsLang (M49)", () => {
  const gw = new FakeClaudeGateway([]);
  it("goes by the pages' text, not the file name; null without materials", async () => {
    const he = { ...file("a", "הגדרה: סדרה $a_n$ מתכנסת לגבול $L$ אם לכל אפסילון קיים N"), fileName: "lecture-1-limits.pdf" };
    const en = { ...file("b", "A sequence converges if for every epsilon there is an N"), fileName: "הרצאה 1.pdf" };
    expect(await materialsLang({ gw, listIndexes: async () => [he] }, course)).toBe("Hebrew");
    expect(await materialsLang({ gw, listIndexes: async () => [en] }, course)).toBe("English");
    expect(await materialsLang({ gw, listIndexes: async () => [he, he, en] }, course)).toBe("Hebrew");
    expect(await materialsLang({ gw, listIndexes: async () => [] }, course)).toBeNull();
  });
});

describe("bm25 token cache (R3)", () => {
  beforeEach(() => tokenCache.clear());
  const cold = (docs: { id: string; text: string }[], q: string) => { tokenCache.clear(); return rank(docs, q); };
  const docs = [
    { id: "a:1", text: "הַגבול של סדרה מתכנסת $a_n \\to L$ סיכום: גבולות" },
    { id: "a:2", text: "פונקציה רציפה בקטע סגור מקבלת מקסימום ומינימום" },
    { id: "b:1", text: "The limit of a sequence: for every ε there is N" },
    { id: "b:2", text: "ΣΑΣ σ derivative הנגזרת" },
  ];

  // (b) rank identical with and without the cache, and the warm call really reuses tokens
  it("warm rank equals cold rank bit for bit and reuses the cached tokens", () => {
    for (const q of ["גבול", "limit sequence", "הפונקציה רציפה", "σας", "nothing"]) {
      const c = cold(docs, q);
      const kept = tokenCache.get("a:1")?.toks;
      expect(rank(docs, q)).toStrictEqual(c);
      expect(tokenCache.get("a:1")?.toks).toBe(kept);
    }
  });

  // (c) a re-scanned summary (same sha:page, new text) changes the ranking exactly as before
  it("a re-scanned summary changes pagesFor's order exactly as without the cache", async () => {
    const gw = new FakeClaudeGateway([]);
    const idx = (sumB: string) => async () => [file("a", "גבול של סדרה", { summary: "סדרות" }), file("b", "נגזרת", { summary: sumB })];
    const order = async (sumB: string) => (await pagesFor({ gw, listIndexes: idx(sumB) }, course, ["S002"], "גבול")).map((p) => p.sha256);
    expect(await order("")).toEqual(["a", "b"]);
    const warm = await order("גבול חד צדדי גבול");
    tokenCache.clear();
    expect(await order("גבול חד צדדי גבול")).toEqual(warm);
    expect(warm).toEqual(["b", "a"]);
  });

  // (a) property: random Hebrew/English/math docs, re-scans included, warm == cold
  it("200 random docs: warm and cold rank are identical, also after summary edits", () => {
    let s = 42;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647); // Park-Miller, deterministic
    // Hebrew letters (prefix letters included), niqqud + shin dots + maqaf, Latin, Greek sigmas, math, spaces, zero-width marks, geresh
    const chars = "אבגדהוזחטיכלמנסעפצקרשתךםןףץ" + "ְֱִֵּׁׂ־" + "abcXYZΣσςΑ" + "0123456789$\\^_{}()+=-.,:'\"" + "  \n" + "​‏׳";
    const str = (n: number) => Array.from({ length: n }, () => chars[Math.floor(rnd() * chars.length)]).join("");
    for (let round = 0; round < 20; round++) {
      const ds = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, text: `${str(80)} ${str(20)}` }));
      const q = str(15);
      const c = cold(ds, q);
      expect(rank(ds, q)).toStrictEqual(c);
      const j = Math.floor(rnd() * ds.length);
      const edited = ds.map((d, i) => (i === j ? { ...d, text: `${d.text.slice(0, 80)} ${str(20)}` } : d));
      const warm = rank(edited, q);
      expect(warm).toStrictEqual(cold(edited, q));
      expect(tokenCache.get(`r${j}`)?.toks).toEqual(tokenize((edited[j] as { text: string }).text));
    }
  });

  // (d) bound eviction, least recently used first
  it("keeps at most TOKEN_CACHE_MAX entries, evicting the least recently used", () => {
    const many = Array.from({ length: TOKEN_CACHE_MAX + 1 }, (_, i) => ({ id: `d${i}`, text: `w${i}` }));
    rank(many, "w");
    expect(tokenCache.size).toBe(TOKEN_CACHE_MAX);
    expect(tokenCache.has("d0")).toBe(false);
    expect(tokenCache.has(`d${TOKEN_CACHE_MAX}`)).toBe(true);
    rank([{ id: "d1", text: "w1" }], "w"); // touch d1
    rank([{ id: "new", text: "x" }], "w");
    expect(tokenCache.has("d1")).toBe(true);
    expect(tokenCache.has("d2")).toBe(false);
  });
});
