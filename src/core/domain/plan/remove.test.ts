import { beforeEach, expect, it } from "vitest";
import { CourseJsonSchema, PlanJsonSchema, ProgressJsonSchema, type CourseJson, type PlanJson } from "@/core/domain/dataSchemas";
import { appendEvent } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { setFs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { setDeviceId } from "@/core/lib/device";
import { stageId, unitId } from "@/core/lib/ids";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { validatePlan } from "./plan";
import { removeFromPlan } from "./remove";

const N = "01040195";
const p = coursePaths("/r", N);
const stage = (i: number, u: number) => ({
  id: stageId(i), unitId: unitId(u), order: i, title: `t${i}`, summary: "s", kind: "concept" as const, objectives: ["a", "b"], newConcepts: [],
  theorems: [], techniques: [], prerequisites: i > 1 ? [stageId(i - 1)] : [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
// U01: S001-S003, U02: S004-S005
const plan: PlanJson = {
  schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed",
  units: [{ id: "U01", title: "u1", summary: "s", stageIds: ["S001", "S002", "S003"] }, { id: "U02", title: "u2", summary: "s", stageIds: ["S004", "S005"] }],
  stages: [1, 2, 3, 4, 5].map((i) => stage(i, i <= 3 ? 1 : 2)),
};
const course: CourseJson = { schema: 1, courseNumber: N, nameHe: "ק", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "", catalogSemester: null, courseKind: "mixed", planVersion: 1, createdAt: "t", updatedAt: "t" };

beforeEach(async () => {
  setFs(memFs());
  setDeviceId("dev1");
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
  await writeJsonAtomic(p.planJson, plan);
  await writeJsonAtomic(p.courseJson, course);
});

it("deletes a stage: renumbers, drops prerequisites on it, archives the old plan, its progress stops counting", async () => {
  await appendEvent(N, { type: "stage_completed", stageId: "S001", by: "user_override", masteryAtCompletion: 0 });
  await appendEvent(N, { type: "stage_started", stageId: "S002" });
  const next = await removeFromPlan(N, ["S002"]);
  expect(next?.stages.map((s) => [s.id, s.order, s.prerequisites])).toEqual([["S001", 1, []], ["S003", 2, []], ["S004", 3, ["S003"]], ["S005", 4, ["S004"]]]);
  expect(next?.units[0]?.stageIds).toEqual(["S001", "S003"]);
  expect(validatePlan(next as PlanJson, { min: 0, max: 99 })).toEqual([]);
  expect((await readJsonFile(p.planJson, PlanJsonSchema))?.version).toBe(2);
  expect((await readJsonFile(`${p.history}/plan-v1.json`, PlanJsonSchema))?.stages).toHaveLength(5);
  expect((await readJsonFile(p.courseJson, CourseJsonSchema))?.planVersion).toBe(2);
  const prog = await readJsonFile(p.progressJson, ProgressJsonSchema);
  expect(prog?.stages["S002"]).toBeUndefined();
  expect(prog?.currentStageId).toBe("S003"); // the deleted current stage hands over to the next one
  expect(prog?.totals.stagesTotal).toBe(4);
});

it("deletes a whole unit; refuses to delete everything or unknown stages", async () => {
  const next = await removeFromPlan(N, ["S004", "S005"]);
  expect(next?.units.map((u) => u.id)).toEqual(["U01"]);
  expect(await removeFromPlan(N, ["S001", "S002", "S003"])).toBeNull();
  expect(await removeFromPlan(N, ["S999"])).toBeNull();
  expect((await readJsonFile(p.planJson, PlanJsonSchema))?.stages).toHaveLength(3);
});
