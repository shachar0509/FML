// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as z from "zod";
import type { CourseJson, Event, PlanJson } from "@/core/domain/dataSchemas";
import { nodeId, planGraph } from "@/core/domain/knowledge/graph";
import { appendEvent } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "../platform";
import { EnginePool, type Engine } from "./engine";
import { ENGINE_VERSION, engineAsset } from "./install";
import { createKnowledge, digest, hotStages, interactions, knowledgeDir, shownLevel, studyFocus, watchList } from "./knowledge";

const stage = (id: string, order: number, x: Partial<PlanJson["stages"][number]> = {}) => ({
  id, unitId: "U01", order, title: `t${id}`, summary: "s", kind: "concept" as const, objectives: [], newConcepts: [], theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30, ...x,
});
const N = "Ckg1";
const plan: PlanJson = {
  schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed",
  units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002"] }],
  stages: [stage("S001", 1, { newConcepts: ["סדרה", "גבול"] }), stage("S002", 2, { newConcepts: ["טור"], prerequisites: ["S001"] })],
};
const course: CourseJson = { schema: 1, courseNumber: N, nameHe: "קורס", credits: 0, faculty: "", syllabusHe: "s", prerequisitesRaw: "", catalogSemester: null, courseKind: "mixed", planVersion: 1, createdAt: "t", updatedAt: "t", type: "customCourse", level: 2 };
const seq = nodeId("S001", "concept", "סדרה");

async function setup(c: CourseJson = course, pl: PlanJson = plan) {
  const d = await mkdtemp(join(tmpdir(), "shalav-kg-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  await initNode();
  const p = coursePaths(useSettings.getState().settings.dataRoot, N);
  await writeJsonAtomic(p.courseJson, c);
  await writeJsonAtomic(p.planJson, pl);
  return p;
}
const answer = (id: string, score: number) => appendEvent(N, { type: "check_answered", stageId: "S001", checkId: Math.random().toString(), kind: "open", context: "practice", correct: score >= 0.7, score: score * 100, mistakeTags: [], nodes: [{ id, score }] });

describe("evidence → engine calls", () => {
  it("one call per tested node; partial credit sets success and confidence; legacy answers cover their stage", () => {
    const g = planGraph(plan);
    const names = Object.fromEntries(g.nodes.map((n) => [n.id, n.label]));
    const base = { id: "e", ts: "t", deviceId: "d", courseNumber: N };
    const graded = { ...base, type: "attempt_graded", attemptId: "a", exercise: { source: "generated", id: "x" }, stageIds: ["S001"], context: "practice", verdict: "partially_correct", score: 60, mistakes: [{ tag: "sign-flip", severity: "major", note: "flipped" }], missingForFullCredit: 1, edgeCasesMissed: [], attachmentHashes: [], difficulty: 3, hasEdgeCaseFocus: false, hintsUsed: 1, solutionRevealedBefore: false, nodes: [{ id: seq, score: 0.9 }, { id: "unknown", score: 1 }] } as unknown as Event;
    expect(interactions(graded, g, names)).toEqual([expect.objectContaining({ concept: "סדרה", activity_type: "PRACTICE", success: true, confidence: 0.8, hints_requested: 1 })]);
    const legacy = { ...base, type: "check_answered", stageId: "S001", checkId: "c", kind: "mcq", context: "learn", correct: false, score: 0, mistakeTags: [] } as Event;
    expect(interactions(legacy, g, names).map((x) => [x.concept, x.activity_type, x.success])).toEqual([["סדרה", "RECALL_EXERCISE", false], ["גבול", "RECALL_EXERCISE", false]]);
  });

  it("M77: a check's mistake tag is a misconception, a missed edge case fails its edge node, the tutor's gaps are knowledge gaps", () => {
    const pl = { ...plan, stages: [stage("S001", 1, { newConcepts: ["סדרה", "גבול"], edgeCases: ["Empty domain"] }), plan.stages[1] as PlanJson["stages"][number]] };
    const g = planGraph(pl);
    const names = Object.fromEntries(g.nodes.map((n) => [n.id, n.label]));
    const base = { id: "e", ts: "t", deviceId: "d", courseNumber: N };
    const check = { ...base, type: "check_answered", stageId: "S001", checkId: "c", kind: "open", context: "learn", correct: false, score: 30, mistakeTags: ["sign-flip"], nodes: [{ id: seq, score: 0.3 }] } as Event;
    expect(interactions(check, g, names)).toEqual([expect.objectContaining({ concept: "סדרה", success: false, error_type: "LOGIC_ERROR", misconception_type: "sign-flip" })]);
    const graded = { ...base, type: "attempt_graded", attemptId: "a", exercise: { source: "generated", id: "x" }, stageIds: ["S001"], context: "practice", verdict: "partially_correct", score: 80, mistakes: [], missingForFullCredit: 0, edgeCasesMissed: ["the empty domain  "], attachmentHashes: [], difficulty: 3, hasEdgeCaseFocus: true, hintsUsed: 0, solutionRevealedBefore: false, nodes: [{ id: seq, score: 0.9 }] } as unknown as Event;
    expect(interactions(graded, g, names).map((x) => [x.concept, x.success])).toEqual([["סדרה", true], ["Empty domain", false]]);
    const assess = { ...base, type: "assessment_updated", stageId: "S001", mastery: 0.6, coveredObjectives: [], gaps: ["מתבלבל בהגדרת גבול", "something else"], reviewTopics: [], readyToAdvance: false, rationale: "" } as Event;
    expect(interactions(assess, g, names).map((x) => [x.concept, x.success, x.error_type, x.misconception_type])).toEqual([["גבול", false, "KNOWLEDGE_GAP", undefined], ["סדרה", false, "KNOWLEDGE_GAP", undefined]]);
  });
});

describe("knowledge service", () => {
  it("works from the log alone (no engine): a custom course starts at its level, good answers raise it", async () => {
    await setup();
    const k = createKnowledge(null);
    const s0 = await k.summary(N);
    expect(s0.engine).toBe(false);
    expect(s0.stars).toBe(1); // level 2 → prior 0.25 → 1.25★ shown as 1
    expect(shownLevel(s0, course)).toBe(2); // M65: the student sees their self-rated level until the graph says more
    for (let i = 0; i < 12; i++) await answer(seq, 1);
    k.invalidate(N);
    expect((await k.summary(N)).k.control.get(seq)).toBeGreaterThan(0.8);
    k.dispose();
  });

  it("M77: the tutor's repeated gaps reach the engine once; a new gap is sent; one miss per node per assessment", async () => {
    await setup();
    const sent: Record<string, unknown>[] = [];
    const fake: Engine = {
      call: async (name, args) => {
        if (name === "record_interaction") sent.push(args);
        return name === "init_domain" ? { domain_id: "D1" } : name === "get_curriculum_snapshot" ? { snapshot: { version: 1 } } : {};
      },
    };
    const assess = (gaps: string[]) => appendEvent(N, { type: "assessment_updated", stageId: "S001", mastery: 0.5, coveredObjectives: [], gaps, reviewTopics: [], readyToAdvance: false, rationale: "" });
    const k = createKnowledge(() => fake);
    const run = async () => {
      await new Promise((r) => setTimeout(r, 50));
      k.invalidate(N);
      await k.summary(N);
      return sent.splice(0).map((x) => [x.concept, x.notes]);
    };
    await assess(["גבול של סדרה", "Gap X", "Gap Y"]); // the last two fall back to the stage's first node: one miss
    expect(await run()).toEqual([["סדרה", "גבול של סדרה"]]);
    await assess(["גבול של סדרה ", "Gap X", "Gap Y"]);
    expect(await run()).toEqual([]);
    await assess(["גבול של סדרה", "Gap X", "Gap Y", "טעות בגבול"]);
    expect(await run()).toEqual([["גבול", "טעות בגבול"]]);
    k.dispose();
  });

  it("with an engine: concepts and answers go to it once; retention lowers the stars; an engine failure falls back", async () => {
    await setup();
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let fail = false;
    const fake: Engine = {
      call: async (name, args) => {
        if (fail) throw new Error("down");
        calls.push({ name, args });
        if (name === "init_domain") return { domain_id: "D1" };
        if (name === "get_curriculum_snapshot") return { snapshot: { version: 1 } };
        if (name === "get_olm_snapshot") return { mastery_stages: { "סדרה": { retention_estimate: 0.5 } }, focus_concept: "גבול" };
        if (name === "get_misconceptions") return { misconceptions: [{ concept: "סדרה", misconception_type: "sign-flip", last_error_detail: "flips", count: 2, status: "active" }] };
        return {};
      },
    };
    await answer(seq, 1);
    const k = createKnowledge(() => fake);
    const s = await k.summary(N);
    expect(s.engine).toBe(true);
    expect(calls.filter((c) => c.name === "init_domain")).toHaveLength(1);
    expect(calls.filter((c) => c.name === "record_interaction")).toHaveLength(1);
    expect(calls.some((c) => c.name === "mark_domain_high_stakes")).toBe(false); // a custom course has no exam
    expect(s.retention.get(seq)).toBe(0.5);
    expect(s.focus).toBe(nodeId("S001", "concept", "גבול"));
    expect(s.misconceptions).toEqual([expect.objectContaining({ id: seq, type: "sign-flip" })]);
    // M64: practice ranks the stages the engine points at; the tutor gets the digest
    expect(hotStages(s)).toEqual(["S001"]);
    const d = digest(s, { custom: true, stageIds: ["S001"], target: 3 });
    expect(d).toMatch(/now at \d(\.5)?★ of 5/);
    expect(d).toContain("סדרה: sign-flip — flips (×2)");
    expect(d).toContain("Suggested focus: גבול");
    expect(d).toContain("difficulty 3/5");
    expect(d).not.toContain("טור"); // S002 is not learned
    // M77: web gathering favors the engine's focus, then weak nodes the student answered on (nothing unanswered, nothing before any answer)
    expect(studyFocus(s)).toEqual(["גבול", "סדרה"]);
    expect(studyFocus(null)).toEqual([]);
    // M67: the course card watches the engine's active misconceptions, labelled like the course's mistake tags
    const tag = { tag: "sign-flip", labelHe: "היפוך סימן", labelEn: "Sign flip", description: "", count: 5, weight: 5, lastSeenAt: "t", stageIds: ["S002"], resolved: false, recentExamples: [] };
    expect(watchList(s, [tag], "he")).toEqual([{ label: "היפוך סימן", count: 2, stageIds: ["S001"] }]);
    expect(watchList(s, [], "en")).toEqual([{ label: "sign-flip", count: 2, stageIds: ["S001"] }]);

    // the tutor adds a skill: it reaches the engine as a new concept; the old answer is not sent again
    await appendEvent(N, { type: "node_added", nodeId: nodeId(null, "skill", "Cites the section"), kind: "skill", label: "Cites the section", why: "w", stageIds: [], requires: [], origin: "grader", refId: "a" });
    await new Promise((r) => setTimeout(r, 50));
    k.invalidate(N);
    await k.summary(N);
    expect(calls.find((c) => c.name === "add_concepts")?.args).toMatchObject({ domain_id: "D1", expected_version: 1, concepts: ["Cites the section"] });
    expect(calls.filter((c) => c.name === "record_interaction")).toHaveLength(1);

    fail = true;
    k.invalidate(N);
    const off = await k.summary(N);
    expect(off.engine).toBe(false);
    expect(watchList(off, [], "en")).toBeNull(); // the card keeps the progress mistakes
    expect(off.stars).toBeGreaterThanOrEqual(0);
    k.dispose();
  });

  it("M76: an academic course is marked high-stakes once; a renumbered stage keeps its concepts; an unknown domain or a new engine release re-seeds from the log once", async () => {
    const p = await setup({ ...course, type: "academic" });
    const calls: string[] = [];
    let known = new Set<string>();
    let ids = 0;
    const added: unknown[] = [];
    let relevance: Record<string, number> = {};
    const fake: Engine = {
      call: async (name, args) => {
        calls.push(name);
        if (name === "add_concepts") added.push(...(args.concepts as unknown[]));
        if (name === "set_goal_relevance") relevance = args.relevance as Record<string, number>;
        if (name === "init_domain") return known.add(`D${++ids}`), { domain_id: `D${ids}` };
        if (!known.has(String(args.domain_id))) throw new Error(`${name}: domain not found`);
        if (name === "get_curriculum_snapshot") return { snapshot: { version: 1 } };
        if (name === "get_olm_snapshot") return { mastery_stages: { "גבול": { retention_estimate: 0.4 }, "gone": { retention_estimate: 0.1 } }, focus_concept: "gone" };
        if (name === "get_misconceptions") return { misconceptions: [{ concept: "gone", misconception_type: "x", count: 1, status: "active" }] };
        return {};
      },
    };
    await answer(seq, 1);
    const k = createKnowledge(() => fake);
    const count = (n: string) => calls.filter((c) => c === n).length;
    const s = await k.summary(N);
    expect(s.engine).toBe(true);
    expect(count("mark_domain_high_stakes")).toBe(1);
    // a concept the plan no longer has (still in the engine) never surfaces
    expect([...s.retention.keys()]).toEqual([nodeId("S001", "concept", "גבול")]);
    expect(s.focus).toBeNull();
    expect(s.misconceptions).toEqual([]);
    k.invalidate(N);
    await k.summary(N);
    expect(count("mark_domain_high_stakes")).toBe(1);

    // Update plan renumbers S001 → S002, S002 → S003 and adds a new S001: the moved nodes keep their names (also a label that
    // repeats in two stages), only the new one is added
    const moved = { ...plan, version: 2, stages: [stage("S001", 1, { newConcepts: ["חדש"] }), stage("S002", 2, { newConcepts: ["סדרה", "גבול"] }), stage("S003", 3, { newConcepts: ["טור", "גבול"], prerequisites: ["S002"] })], units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002", "S003"] }] };
    const twice = { ...plan, stages: [plan.stages[0] as PlanJson["stages"][number], stage("S002", 2, { newConcepts: ["טור", "גבול"], prerequisites: ["S001"] })] };
    await writeJsonAtomic(p.planJson, twice); // first "גבול" also in S002 (named "גבול · tS002")
    k.invalidate(N);
    await k.summary(N);
    calls.length = 0;
    await writeJsonAtomic(p.planJson, moved);
    await appendEvent(N, { type: "plan_replaced", fromVersion: 1, toVersion: 2, idMap: { S001: "S002", S002: "S003" } });
    await new Promise((r) => setTimeout(r, 50));
    k.invalidate(N);
    const s2 = await k.summary(N);
    expect(s2.retention.get(nodeId("S002", "concept", "גבול"))).toBe(0.4);
    expect(s2.retention.has(nodeId("S003", "concept", "גבול"))).toBe(false); // keeps "גבול · tS002", not S001's history
    expect(added.slice(-1)).toEqual(["חדש"]);
    expect(count("record_interaction")).toBe(0);

    // the engine DB was wiped: one fresh domain, every answer sent again, marked again
    known = new Set();
    calls.length = 0;
    k.invalidate(N);
    expect((await k.summary(N)).engine).toBe(true);
    expect([count("init_domain"), count("record_interaction"), count("mark_domain_high_stakes"), count("set_goal_relevance")]).toEqual([1, 1, 1, 1]);
    expect(Object.keys(relevance)).toHaveLength(s2.graph.nodes.length); // every concept of the new domain

    // a new engine release: the old domain is retired and the log replayed into a new one
    const mp = join(knowledgeDir(N), "map.json");
    await writeJsonAtomic(mp, { ...(await readJsonFile(mp, z.any())), engine: "v0.0.1" });
    calls.length = 0;
    k.invalidate(N);
    expect((await k.summary(N)).engine).toBe(true);
    expect([count("delete_domain"), count("init_domain"), count("record_interaction")]).toEqual([1, 1, 1]);
    expect((await readJsonFile(mp, z.any())).engine).toBe(ENGINE_VERSION);
    k.dispose();
  });

  // The real engine (tutor-mcp): run with TUTOR_MCP_BIN=/path/to/tutor-mcp
  it.skipIf(!process.env.TUTOR_MCP_BIN || !engineAsset())("real tutor-mcp: a per-course graph, answers, a tutor-written skill, retention, high-stakes, a wiped DB re-seeded", async () => {
    await setup({ ...course, type: "academic" });
    const root = useSettings.getState().settings.dataRoot;
    const dir = (n: string) => join(coursePaths(root, n).shalav, "knowledge", "engine-test");
    const pool = new EnginePool(async () => process.env.TUTOR_MCP_BIN as string, dir);
    const k = createKnowledge((n) => pool.get(n));
    for (let i = 0; i < 8; i++) await answer(seq, 1);
    await appendEvent(N, { type: "node_added", nodeId: nodeId(null, "skill", "Cites the section"), kind: "skill", label: "Cites the section", why: "w", stageIds: [], requires: [seq], origin: "grader", refId: "a" });
    await new Promise((r) => setTimeout(r, 200));
    k.invalidate(N);
    const s = await k.summary(N);
    expect(s.engine).toBe(true);
    expect(s.graph.nodes.some((n) => n.kind === "skill")).toBe(true);
    expect(s.retention.size).toBeGreaterThan(0);
    expect((await readJsonFile(join(knowledgeDir(N), "map.json"), z.any())).highStakes).toBe(true);
    // M76: the engine DB is wiped (the domain id in map.json is now unknown to it): one re-seed from the log
    await pool.closeAll();
    await rm(dir(N), { recursive: true, force: true });
    k.invalidate(N);
    const again = await k.summary(N);
    expect(again.engine).toBe(true);
    expect(again.retention.size).toBeGreaterThan(0);
    k.dispose();
    await pool.closeAll();
  }, 60_000);

  // M77: the plan's integration checks (archive/KNOWLEDGE_GRAPH_PLAN.md, Verification)
  it.skipIf(!process.env.TUTOR_MCP_BIN || !engineAsset())("real tutor-mcp: misses after a good run, sustained misses, a review comes due, the focus is a frontier concept", async () => {
    await setup({ ...course, type: "academic" });
    const root = useSettings.getState().settings.dataRoot;
    const dir = (n: string) => join(coursePaths(root, n).shalav, "knowledge", "engine-test");
    const pool = new EnginePool(async () => process.env.TUTOR_MCP_BIN as string, dir);
    const k = createKnowledge((n) => pool.get(n));
    const lim = nodeId("S001", "concept", "גבול");
    const now = async () => {
      await new Promise((r) => setTimeout(r, 100));
      k.invalidate(N);
      return k.summary(N);
    };
    for (let i = 0; i < 8; i++) await answer(seq, 1);
    const s0 = await now();
    expect(s0.engine).toBe(true);
    expect(s0.k.control.get(seq)).toBeGreaterThan(0.8);
    expect(s0.focus).toBe(lim); // the frontier: S001's other concept, never S002's "טור" (it needs S001)
    for (let i = 0; i < 2; i++) await answer(seq, 0);
    const s1 = await now();
    expect(s1.k.control.get(seq)).toBeGreaterThan(0.6); // 2 misses after 8 good: still high (the engine's own BKT falls to ~0.3)
    expect(s1.stars).toBeGreaterThanOrEqual(s0.stars);
    for (let i = 0; i < 8; i++) await answer(seq, 0);
    expect((await now()).k.control.get(seq)).toBeLessThan(0.3); // sustained misses: it drops
    // FSRS: one good answer on גבול, then 90 days pass (the engine has no clock to set: its review dates are moved back)
    await answer(lim, 1);
    expect((await now()).retention.get(lim)).toBeGreaterThan(0.95);
    await pool.closeAll();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(dir(N), "runtime.db"));
    const ago = new Date(Date.now() - 90 * 86400_000).toISOString();
    const go = `${ago.slice(0, 10)} ${ago.slice(11, 23)}000 +0000 UTC`; // Go's time.String()
    db.prepare("update concept_states set last_review = ?, next_review = ? where concept = ?").run(go, go, "גבול");
    db.close();
    expect((await now()).retention.get(lim)).toBeLessThan(0.7); // retention falls below the review line (dueNodes also needs control ≥ 0.6)
    k.dispose();
    await pool.closeAll();
  }, 60_000);
});
