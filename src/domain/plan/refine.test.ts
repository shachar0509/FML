import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/claude/fake";
import { EventSchema, FileIndexSchema, PlanJsonSchema, type CourseJson, type FileIndex, type PlanJson } from "@/domain/dataSchemas";
import { writeFileIndex } from "@/domain/ingest/indexStore";
import { writeJsonAtomic } from "@/lib/fs/atomicWrite";
import { setFs } from "@/lib/fs/fs";
import { coursePaths } from "@/lib/fs/paths";
import { stageId, unitId } from "@/lib/ids";
import { setDeviceId } from "@/lib/device";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { applyRevision, newStageIds, refinePlan, remapIndex } from "./refine";
import { validatePlan } from "./plan";

const N = "01040195";
const mkStage = (i: number, u: number) => ({
  id: stageId(i), unitId: unitId(u), order: i, title: `t${i}`, summary: "s", kind: "concept" as const, objectives: ["a", "b"], newConcepts: [],
  theorems: [], techniques: [], prerequisites: i > 1 ? [stageId(i - 1)] : [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
const plan: PlanJson = {
  schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed",
  units: [1, 2, 3].map((u) => ({ id: unitId(u), title: `u${u}`, summary: "s", stageIds: Array.from({ length: 12 }, (_, i) => stageId((u - 1) * 12 + i + 1)) })),
  stages: Array.from({ length: 36 }, (_, i) => mkStage(i + 1, Math.floor(i / 12) + 1)),
};
const course: CourseJson = {
  schema: 1, courseNumber: N, nameHe: "ק", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "", catalogSemester: null,
  courseKind: "mixed", planVersion: 1, createdAt: "t", updatedAt: "t",
};
// Revision: split S002 in two, insert a new stage after S005, rest unchanged (prerequisites by position).
const revision = (extra = true) => {
  let pos = 0;
  const bump = <T,>(x: T) => (pos++, x);
  return { courseKind: "mixed" as const, units: plan.units.map((u) => ({
    title: u.title, summary: "s",
    stages: u.stageIds.flatMap((id) => {
      const mk = (title: string, sourceId: string | null) => bump({ title, kind: "concept" as const, summary: "s", prerequisites: pos > 0 ? [pos] : [], sourceId });
      if (id === "S002") return [mk("t2a", id), mk("t2b", id)];
      if (id === "S005" && extra) return [mk("t5", id), mk("new", null)];
      return [mk(`t${Number(id.slice(1))}`, id)];
    }),
  })) };
};
const details = (req: { messages: { content: unknown }[] }) => {
  const ids = /stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? [];
  return toolCall("submit_unit_details", {
    stages: ids.map((id) => ({ id, objectives: ["x", "y"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 25 })),
  });
};
const rec = (v: number | null): FileIndex => ({
  schema: 1, sha256: "abc", fileName: "f.pdf", relPath: "materials/f.pdf", role: "material", mediaType: "application/pdf", pageCount: 1, addedAt: "t",
  status: "indexed", error: null, indexedAt: "t", indexModel: "m", planVersion: v,
  materialPages: [{ page: 1, stageIds: ["S002", "S003"], summary: "sum", hasFigure: false, text: "" }],
  exercises: [{
    id: "e", label: "l", pages: [1], statementMd: "", figureCrops: [], referenceSolutionMd: null, requiredStageIds: ["S002", "S003"], primaryStageId: "S002",
    difficulty: 1, type: "proof", estimatedMinutes: 5, edgeCaseFocus: [], gist: "",
  }],
});

describe("refine", () => {
  it("applyRevision assigns ids, idMap and fresh set", () => {
    const r = applyRevision(plan, revision());
    expect(r.stages).toHaveLength(38);
    expect(r.stages.slice(1, 3).map((s) => s.id)).toEqual(["S002", "S037"]);
    expect(r.stages.map((s) => s.id)).toContain("S038");
    expect(r.idMap["S002"]).toBe("S037");
    expect(r.idMap["S005"]).toBe("S005");
    expect([...r.fresh].sort()).toEqual(["S002", "S037", "S038"]);
    expect(r.stages[2]?.prerequisites).toEqual(["S002"]);
    expect(r.stages.map((s) => s.order)).toEqual(r.stages.map((_, i) => i + 1));
    expect(r.stages[3]?.prerequisites).toEqual(["S037"]); // S003 now requires the last part
  });

  it("remapIndex remaps older records only", () => {
    const m = remapIndex(rec(1), { S002: "S037" }, 2);
    expect(m.planVersion).toBe(2);
    expect(m.exercises[0]).toMatchObject({ requiredStageIds: ["S037", "S003"], primaryStageId: "S037" });
    expect(m.materialPages[0]?.stageIds).toEqual(["S037", "S003"]);
    expect(remapIndex(rec(2), { S002: "S037" }, 2).materialPages[0]?.stageIds).toEqual(["S002", "S003"]);
  });

  describe("refinePlan", () => {
    let mem: ReturnType<typeof memFs>;
    const p = coursePaths("/r", N);
    beforeEach(async () => {
      mem = memFs();
      setFs(mem);
      setDeviceId("dev1");
      useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
      await writeJsonAtomic(p.planJson, plan);
      await writeJsonAtomic(p.courseJson, course);
      await writeFileIndex(N, rec(1));
    });

    it("splits, inserts, archives, emits plan_replaced and remaps the index", async () => {
      // S002 missing in first reply -> one same-conversation correction
      const bad = revision();
      bad.units[0]?.stages.splice(1, 2);
      const gw = new FakeClaudeGateway([toolCall("submit_plan_revision", bad), toolCall("submit_plan_revision", revision()), details]);
      const out = await refinePlan({ gw, course, lang: "en" });
      expect(gw.calls[1]?.messages).toHaveLength(3);
      expect(gw.calls).toHaveLength(3); // 2 revisions + 1 unit-details call (only unit 1 has fresh stages)
      expect(out.version).toBe(2);
      expect(validatePlan(out, 2)).toEqual([]);
      expect(out.stages[1]).toMatchObject({ id: "S002", title: "t2a", estimatedMinutes: 25 });
      expect(out.stages[3]?.objectives).toEqual(["a", "b"]); // unchanged stage keeps its details
      expect([...newStageIds(plan, out)].sort()).toEqual(["S037", "S038"]);
      expect(PlanJsonSchema.parse(JSON.parse(mem.files.get(p.planJson) as string)).version).toBe(2);
      expect(JSON.parse(mem.files.get(`${p.history}/plan-v1.json`) as string).version).toBe(1);
      expect(mem.files.get(p.planMd)).toContain("S037");
      expect(JSON.parse(mem.files.get(p.courseJson) as string).planVersion).toBe(2);
      const ev = [...mem.files].filter(([k]) => k.startsWith(p.events)).flatMap(([, v]) => v.trim().split("\n").map((l) => EventSchema.parse(JSON.parse(l))));
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ type: "plan_replaced", fromVersion: 1, toVersion: 2 });
      expect((ev[0] as { idMap: Record<string, string> }).idMap["S002"]).toBe("S037");
      const idx = FileIndexSchema.parse(JSON.parse(mem.files.get(p.indexFile("abc")) as string));
      expect(idx.planVersion).toBe(2);
      expect(idx.exercises[0]?.primaryStageId).toBe("S037");
    });

    it("throws after two failed corrections", async () => {
      const bad = revision();
      bad.units[0]?.stages.splice(1, 2);
      const gw = new FakeClaudeGateway([1, 2, 3].map(() => toolCall("submit_plan_revision", bad)));
      await expect(refinePlan({ gw, course, lang: "en" })).rejects.toThrow(/missing sourceIds/);
      expect(mem.files.has(`${p.history}/plan-v1.json`)).toBe(false);
    });
  });
});
