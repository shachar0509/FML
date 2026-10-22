// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CourseJson, Event, PlanJson } from "@/core/domain/dataSchemas";
import { nodeId, planGraph } from "@/core/domain/knowledge/graph";
import { appendEvent } from "@/core/domain/progress/store";
import { writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "../platform";
import { EnginePool, type Engine } from "./engine";
import { engineAsset } from "./install";
import { createKnowledge, digest, hotStages, interactions } from "./knowledge";

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

async function setup() {
  const d = await mkdtemp(join(tmpdir(), "shalav-kg-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  await initNode();
  const p = coursePaths(useSettings.getState().settings.dataRoot, N);
  await writeJsonAtomic(p.courseJson, course);
  await writeJsonAtomic(p.planJson, plan);
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
});

describe("knowledge service", () => {
  it("works from the log alone (no engine): a custom course starts at its level, good answers raise it", async () => {
    await setup();
    const k = createKnowledge(null);
    const s0 = await k.summary(N);
    expect(s0.engine).toBe(false);
    expect(s0.stars).toBe(1); // level 2 → prior 0.25 → 1.25★ shown as 1
    for (let i = 0; i < 12; i++) await answer(seq, 1);
    k.invalidate(N);
    expect((await k.summary(N)).k.control.get(seq)).toBeGreaterThan(0.8);
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
    expect(off.stars).toBeGreaterThanOrEqual(0);
    k.dispose();
  });

  // The real engine (tutor-mcp): run with TUTOR_MCP_BIN=/path/to/tutor-mcp
  it.skipIf(!process.env.TUTOR_MCP_BIN || !engineAsset())("real tutor-mcp: a per-course graph, answers, a tutor-written skill, retention", async () => {
    await setup();
    const root = useSettings.getState().settings.dataRoot;
    const pool = new EnginePool(async () => process.env.TUTOR_MCP_BIN as string, (n) => join(coursePaths(root, n).shalav, "knowledge", "engine-test"));
    const k = createKnowledge((n) => pool.get(n));
    for (let i = 0; i < 8; i++) await answer(seq, 1);
    await appendEvent(N, { type: "node_added", nodeId: nodeId(null, "skill", "Cites the section"), kind: "skill", label: "Cites the section", why: "w", stageIds: [], requires: [seq], origin: "grader", refId: "a" });
    await new Promise((r) => setTimeout(r, 200));
    k.invalidate(N);
    const s = await k.summary(N);
    expect(s.engine).toBe(true);
    expect(s.graph.nodes.some((n) => n.kind === "skill")).toBe(true);
    expect(s.retention.size).toBeGreaterThan(0);
    k.dispose();
    await pool.closeAll();
  }, 60_000);
});
