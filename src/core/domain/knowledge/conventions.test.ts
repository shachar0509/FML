import { describe, expect, it } from "vitest";
import type { Convention, Event, FileIndex, PlanJson } from "@/core/domain/dataSchemas";
import { type Candidates, type Draft, candidatesOf, conventionId, judgeUseCase, ordered, pruneSources, separable, shouldRetire } from "./conventions";
import { knowledgeOf, meanControl, rawStars } from "./control";
import { graphOf, nodeId } from "./graph";
import { mapEvents, reduceProgress } from "@/core/domain/progress/reduce";

const stage = (id: string, order: number) => ({
  id, unitId: "U01", order, title: id, summary: "s", kind: "concept" as const, objectives: [], newConcepts: [`c${id}`], theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
const plan: PlanJson = { schema: 1, courseNumber: "C1", version: 1, generatedAt: "t", model: "m", courseKind: "mixed", units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001"] }], stages: [stage("S001", 1)] };
const rec = (sha: string, o: Partial<FileIndex> = {}): FileIndex => ({
  schema: 1, sha256: sha, fileName: `${sha}.pdf`, relPath: `${sha}.pdf`, role: "exercises", mediaType: "application/pdf", pageCount: 1, addedAt: "t", status: "indexed", error: null, indexedAt: "t",
  indexModel: "m", planVersion: 1, materialPages: [], exercises: [], ...o,
});
const occ = (id: string, label = "1") => ({ id, label, useCase: "u", practice: `p ${id}` });
const draft = (o: Partial<Draft> = {}): Draft => ({
  sameAs: null, rule: "cite the section", trigger: "relies on a statute", on: "answer", notWhen: ["only mentioned"], examples: [], verify: "section follows the statute", level: "any", stageIds: [],
  answerForms: [], questionTypes: [], followed: [], teacher: [], explained: [], unexplained: [], ...o,
});
const cand = (o: Partial<Candidates> = {}): Candidates => ({
  occurrences: ["aaaaaaaa-o1", "aaaaaaaa-o2", "bbbbbbbb-o1", "bbbbbbbb-o2"].map((id) => ({ ...occ(id), sha: id.slice(0, 8), fileName: "f", stageIds: [] })),
  absences: ["aaaaaaaa-a1", "bbbbbbbb-a1", "bbbbbbbb-a2"].map((id) => ({ ...occ(id), sha: id.slice(0, 8), fileName: "f", stageIds: [] })),
  teacher: [{ id: "cccccccc-t1", sha: "cccccccc", fileName: "t", kind: "rubric", item: { quote: "cite it" } as never }], shas: new Set(), ...o,
});
const ids = (c: Candidates) => new Set([...c.occurrences, ...c.absences, ...c.teacher].map((x) => x.id));
const judge = (d: Partial<Draft>, c = cand()) => judgeUseCase([draft(d)], ids(c), c)[0] as ReturnType<typeof judgeUseCase>[number];
const why = (j: ReturnType<typeof judge>) => (j.ok ? "ok" : j.why);

describe("candidatesOf", () => {
  it("ignores web files, ids absences, reads teacher kind and stages, keeps a pending sha", () => {
    const ex = { label: "1", requiredStageIds: ["S001"] } as never;
    const out = candidatesOf([
      rec("aaaaaaaa11", { patterns: { occurrences: [occ("aaaaaaaa-o1")], absences: [{ label: "1", useCase: "u", practice: "p" }, { label: "9", useCase: "u", practice: "p" }] }, exercises: [ex] }),
      rec("webwebwe11", { origin: "web", patterns: { occurrences: [occ("webwebwe-o1")], absences: [] } }),
      rec("tttttttt11", { role: "teacher", materialPages: [{ page: 3, kind: "graded_work" } as never], teacherItems: [{ id: "tttttttt-t1", page: 3 } as never, { id: "tttttttt-t2", page: 4 } as never] }),
      rec("pppppppp11", { status: "pending", patterns: { occurrences: [occ("pppppppp-o1")], absences: [] } }),
    ]);
    expect(out.occurrences.map((o) => o.id)).toEqual(["aaaaaaaa-o1"]);
    expect(out.occurrences[0]?.stageIds).toEqual(["S001"]);
    expect(out.absences.map((a) => [a.id, a.stageIds])).toEqual([["aaaaaaaa-a1", ["S001"]], ["aaaaaaaa-a2", []]]);
    expect(out.teacher.map((t) => [t.id, t.kind])).toEqual([["tttttttt-t1", "graded"], ["tttttttt-t2", "remark"]]);
    expect([...out.shas].sort()).toEqual(["aaaaaaaa11", "pppppppp11", "tttttttt11", "webwebwe11"]);
  });
});

describe("judgeUseCase", () => {
  it("needs 3 occurrences in 2 files; a teacher id suffices", () => {
    expect(why(judge({ followed: ["aaaaaaaa-o1", "aaaaaaaa-o2"] }))).toBe("seen 2 times in 1 files");
    const one = cand({ occurrences: cand().occurrences.map((o) => ({ ...o, sha: "aaaaaaaa" })) });
    expect(why(judge({ followed: ["aaaaaaaa-o1", "aaaaaaaa-o2", "bbbbbbbb-o1"] }, one))).toMatch(/in 1 files/);
    const ok = judge({ followed: ["aaaaaaaa-o1", "aaaaaaaa-o2", "bbbbbbbb-o1"], unexplained: [], explained: [{ id: "bbbbbbbb-a1", notWhen: 1 }, { id: "bbbbbbbb-a2", notWhen: 1 }, { id: "aaaaaaaa-a1", notWhen: 1 }] });
    expect(ok.ok && ok.source).toBe("solutions");
    expect(ok.ok && ok.sources.map((s) => [s.sha, s.refs, s.kind])).toEqual([["aaaaaaaa", ["aaaaaaaa-o1", "aaaaaaaa-o2"], "solution"], ["bbbbbbbb", ["bbbbbbbb-o1"], "solution"]]);
    const t = judge({ teacher: ["cccccccc-t1"], followed: ["aaaaaaaa-o1"] });
    expect(t.ok && [t.source, t.sources.map((s) => s.kind), t.sources[0]?.quote]).toEqual(["teacher", ["rubric", "solution"], "cite it"]);
  });
  it("ignores ids outside the use case or of the wrong kind; rejects empty fields", () => {
    const c = cand();
    const sub = new Set(["aaaaaaaa-o1", "aaaaaaaa-o2", "bbbbbbbb-o1", "cccccccc-t1"]);
    const j = judgeUseCase([draft({ followed: ["aaaaaaaa-o1", "aaaaaaaa-o2", "bbbbbbbb-o2", "cccccccc-t1", "zzzzzzzz-o1"] })], sub, c)[0];
    expect(why(j as never)).toBe("seen 2 times in 1 files"); // o2 of b is outside; the teacher id is not an occurrence
    const t = judgeUseCase([draft({ teacher: ["aaaaaaaa-o1", "bbbbbbbb-t9"], followed: [] })], sub, c)[0];
    expect(t?.ok).toBe(false);
    expect(why(judge({ rule: " " }))).toBe("empty rule, trigger or verify");
  });
  it("tolerates at most 1 unexplained absence in 4", () => {
    const f = { followed: ["aaaaaaaa-o1", "aaaaaaaa-o2", "bbbbbbbb-o1", "bbbbbbbb-o2"] };
    const c = cand();
    const x = (id: string) => ({ id, notWhen: 1 });
    expect(judge({ ...f, unexplained: ["aaaaaaaa-a1"], explained: [x("bbbbbbbb-a1"), x("bbbbbbbb-a2")] }, c).ok).toBe(true);
    // exactly 1 in 4 (3 followed + 1 unexplained) passes
    expect(judge({ followed: f.followed.slice(0, 3), unexplained: ["aaaaaaaa-a1"], explained: [x("bbbbbbbb-a1"), x("bbbbbbbb-a2")] }, c).ok).toBe(true);
    // a teacher convention is not judged by absences
    expect(judge({ teacher: ["cccccccc-t1"], unexplained: ["aaaaaaaa-a1", "bbbbbbbb-a1", "bbbbbbbb-a2"] }, c).ok).toBe(true);
    expect(why(judge({ ...f, unexplained: ["aaaaaaaa-a1", "bbbbbbbb-a1"], explained: [x("bbbbbbbb-a2")] }, c))).toBe("inconsistent: 2 of 6 not followed");
    // unclaimed absences count: 1 unexplained + 2 omitted = 3
    expect(why(judge({ ...f, unexplained: ["aaaaaaaa-a1"] }, c))).toMatch(/^inconsistent: 3 of 7/);
    // explained with notWhen out of range counts as unexplained
    expect(why(judge({ ...f, explained: [x("aaaaaaaa-a1"), { id: "bbbbbbbb-a1", notWhen: 2 }, { id: "bbbbbbbb-a2", notWhen: 3 }] }, c))).toBe("inconsistent: 2 of 6 not followed");
    // an absence another draft claims is not charged to this one
    const [a, b] = judgeUseCase([draft({ ...f, explained: [x("aaaaaaaa-a1")] }), draft({ rule: "other", unexplained: ["bbbbbbbb-a1", "bbbbbbbb-a2"] })], ids(c), c);
    expect(a?.ok).toBe(true);
    expect(b?.ok).toBe(false);
  });
});

const conv = (o: Partial<Convention> = {}): Convention => ({
  id: "x", rule: "r", source: "solutions", useCase: { trigger: "t", on: "answer", notWhen: [], examples: [], verify: "v", distinguishes: [], level: "any", stageIds: [], hints: { answerForms: [], questionTypes: [] } },
  sources: [], status: "active", conflicts: [], addedAt: "2026-01-01", updatedAt: "2026-01-01", ...o,
});
const src = (sha: string) => ({ sha, fileName: "f", kind: "solution" as const, refs: [], quote: "" });

describe("removal", () => {
  it("retires only when files are gone and a repeating contradictor exists", () => {
    const reg = { schema: 1 as const, conventions: [conv({ sources: [src("a")] })], hashes: {}, inconsistent: [], updatedAt: "t" };
    const gone = pruneSources(reg, new Set());
    const x = gone.conventions[0] as Convention;
    expect(x.sources).toEqual([]);
    expect(x.status).toBe("active"); // no contradictor: stays
    const y = conv({ id: "y" });
    expect(shouldRetire(x, y, false)).toBe(false);
    expect(shouldRetire(pruneSources(reg, new Set(["a"])).conventions[0] as Convention, y, true)).toBe(false); // a file remains
    expect(shouldRetire(x, y, true)).toBe(true);
  });
  it("a teacher convention is retired only by a newer teacher one", () => {
    const x = conv({ source: "teacher", addedAt: "2026-01-01" });
    expect(shouldRetire(x, conv({ source: "teacher", addedAt: "2026-02-01" }), true)).toBe(true);
    expect(shouldRetire(x, conv({ source: "teacher", addedAt: "2025-12-01" }), true)).toBe(false);
    expect(shouldRetire(x, conv({ source: "solutions", addedAt: "2026-02-01" }), true)).toBe(false);
    expect(shouldRetire(x, conv({ source: "teacher", addedAt: "2026-02-01", status: "retired" }), true)).toBe(false);
  });
});

it("separable, conventionId, ordered", () => {
  const l = (a: boolean, b: boolean) => [{ id: "1", a, b }, { id: "2", a: true, b: false }];
  expect(separable(l(false, true), "solutions", "solutions")).toBe("ok");
  expect(separable(l(true, true), "teacher", "solutions")).toBe("teacher-wins");
  expect(separable(l(true, true), "solutions", "teacher")).toBe("teacher-wins");
  expect(separable(l(true, true), "solutions", "solutions")).toBe("overlap");
  expect(separable(l(true, true), "teacher", "teacher")).toBe("overlap");
  const a = conventionId("rule", ["S001"], "t1", new Set());
  expect(a).toBe(nodeId("S001", "convention", "rule"));
  expect(conventionId("rule", ["S001"], "t2", new Set([a]))).not.toBe(a);
  expect(conventionId("rule", [], "t", new Set())).toBe(nodeId(null, "convention", "rule"));
  const cs = [conv({ id: "s1" }), conv({ id: "t1", source: "teacher" }), conv({ id: "r", status: "retired" }), conv({ id: "t2", source: "teacher" })];
  expect(ordered(cs).map((x) => x.id)).toEqual(["t1", "t2", "s1"]);
});

describe("graph and stars", () => {
  const base = { ts: "2026-01-01T00:00:00Z", deviceId: "d", courseNumber: "C1", context: "practice" as const };
  const ev = (x: object) => ({ ...base, id: Math.random().toString(), ...x }) as Event;
  const cid = nodeId(null, "convention", "cite");
  const add = (id = cid, kind = "convention", origin = "index") => ev({ type: "node_added", nodeId: id, kind, label: "cite", why: "w", stageIds: [], requires: [], origin, refId: "r" });
  const retire = (id = cid) => ev({ type: "node_retired", nodeId: id, why: "w" });
  it("node_retired drops a convention (and its edges), ignores other kinds, and a later node_added restores it", () => {
    const concept = nodeId("S001", "concept", "cS001");
    const link = ev({ type: "node_linked", from: concept, to: cid, rel: "requires" });
    const has = (evs: Event[], id: string) => graphOf(plan, evs).nodes.some((n) => n.id === id);
    expect(has([add(), retire()], cid)).toBe(false);
    expect(graphOf(plan, [add(), link, retire()]).requires[concept] ?? []).not.toContain(cid);
    expect(has([retire(concept)], concept)).toBe(true);
    const skill = nodeId(null, "skill", "s");
    expect(has([add(skill, "skill", "tutor"), retire(skill)], skill)).toBe(true);
    expect(has([add(), retire(), add()], cid)).toBe(true);
    // a stage's convention retired before a plan_replaced stays retired under its new stage id
    const sc = nodeId("S001", "convention", "cite");
    const moved = ev({ type: "plan_replaced", fromVersion: 1, toVersion: 2, idMap: { S001: "S002" } });
    const plan2: PlanJson = { ...plan, units: [{ ...(plan.units[0] as PlanJson["units"][number]), stageIds: ["S002"] }], stages: [stage("S002", 1)] };
    const g2 = graphOf(plan2, mapEvents([{ ...add(sc), stageIds: ["S001"] } as Event, retire(sc), moved]));
    expect(g2.nodes.some((n) => n.kind === "convention")).toBe(false);
  });
  it("a dormant index convention changes nothing until its first answer; tutor nodes are never dormant", () => {
    const g0 = graphOf(plan, []);
    const g1 = graphOf(plan, [add()]);
    const k0 = knowledgeOf(g0, [], 0.1);
    const k1 = knowledgeOf(g1, [], 0.1);
    expect(k1.dormant.has(cid)).toBe(true);
    expect(rawStars(g1, k1)).toBe(rawStars(g0, k0));
    const sid = g1.nodes[0]?.id as string;
    expect(meanControl(k1, [cid], 0.3)).toBe(0.3);
    expect(meanControl(k1, [cid, sid], 0.3)).toBe(meanControl(k0, [sid], 0.3));
    const tutor = nodeId(null, "convention", "t");
    expect(knowledgeOf(graphOf(plan, [add(tutor, "convention", "tutor")]), [], 0.1).dormant.size).toBe(0);
    const obs = ev({ type: "node_observed", nodeId: cid, score: 1, why: "w", context: "practice" });
    const k2 = knowledgeOf(g1, [obs], 0.1);
    expect(k2.dormant.has(cid)).toBe(false);
    expect(rawStars(g1, k2)).toBeGreaterThan(rawStars(g0, k0));
  });
  it("a stage-wide answer or assessment never wakes a stage's learned convention, and stage mastery ignores it", () => {
    const sc = nodeId("S001", "convention", "cite");
    const a = { ...add(sc), stageIds: ["S001"] } as Event;
    const assess = ev({ type: "assessment_updated", stageId: "S001", mastery: 0.9, coveredObjectives: [], gaps: [], reviewTopics: [] });
    const g = graphOf(plan, [a]);
    expect(knowledgeOf(g, [assess], 0.1).dormant.has(sc)).toBe(true);
    const obs = ev({ type: "node_observed", nodeId: nodeId("S001", "concept", "cS001"), score: 1, why: "w", context: "practice" });
    const m = (evs: Event[]) => reduceProgress(plan, evs, "2026-01-02T00:00:00Z").stages.S001?.mastery;
    expect(m([obs, a])).toBe(m([obs]));
  });
});
