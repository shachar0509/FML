import { beforeEach, expect, it } from "vitest";
import type { ClaudeGateway } from "@/core/claude/types";
import type { CourseJson, FileIndex, PlanJson } from "@/core/domain/dataSchemas";
import { setFs } from "@/core/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { writeFileIndex } from "./indexStore";
import { gatherWeb, shares } from "./web";

const N = "Cabc";
const stage = (id: string, unitId: string, order: number) => ({
  id, unitId, order, title: `t${id}`, summary: "s", kind: "concept" as const, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
const plan: PlanJson = {
  schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed",
  units: [{ id: "U01", title: "a", summary: "s", stageIds: ["S001"] }, { id: "U02", title: "b", summary: "s", stageIds: ["S002"] }, { id: "U03", title: "c", summary: "s", stageIds: ["S003"] }],
  stages: [stage("S001", "U01", 1), stage("S002", "U02", 2), stage("S003", "U03", 3)],
};
const rec = (sha: string, pages: string[][]): FileIndex => ({
  schema: 1, sha256: sha, fileName: `${sha}.md`, relPath: `m/${sha}.md`, role: "material", mediaType: "text/markdown", pageCount: pages.length, addedAt: "t",
  status: "indexed", error: null, indexedAt: "t", indexModel: "m", planVersion: 1, exercises: [],
  materialPages: pages.map((stageIds, i) => ({ page: i + 1, stageIds, summary: "s", hasFigure: false, text: "" })),
});

beforeEach(() => {
  setFs(memFs());
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
});

it("gives the new documents to the units with the least material, an average file at a time", async () => {
  // U01: 6 pages, U02: 2, U03: none; 2 files, so a new document weighs 4
  await writeFileIndex(N, rec("f1", [["S001"], ["S001"], ["S001"], ["S001"]]));
  await writeFileIndex(N, rec("f2", [["S001"], ["S001"], ["S002"], ["S002"]]));
  expect((await shares(N, plan, 3)).map((u) => [u.id, u.have, u.docs])).toEqual([["U02", 2, 1], ["U03", 0, 2]]);
  expect((await shares(N, plan, 9)).map((u) => u.docs)).toEqual([2, 3, 4]); // many documents: every unit gets some
  expect(await shares(N, null, 3)).toEqual([]); // no plan: the request is about the whole subject
});

it("asks for full, elaborated solutions, not summaries (the student learns to write complete answers)", async () => {
  let ask = "";
  const gw: ClaudeGateway = {
    send: async (r) => {
      const c = r.messages[0]?.content;
      ask = typeof c === "string" ? c : "";
      throw new Error("stop");
    },
  };
  const course: CourseJson = { schema: 1, courseNumber: N, nameHe: "ק", credits: 0, faculty: "", syllabusHe: "s", prerequisitesRaw: "", catalogSemester: null, courseKind: "mixed", planVersion: 1, createdAt: "t", updatedAt: "t" };
  await expect(gatherWeb(gw, course, "he", 3)).rejects.toThrow("stop");
  expect(ask).toMatch(/Solutions are never summarized/);
  expect(ask).toMatch(/Every step is shown and justified/);
  // M65: at the student's level now and the next one
  expect(ask).toMatch(/Current level: 1\/5/);
  await expect(gatherWeb(gw, { ...course, type: "customCourse", level: 1 }, "he", 3, undefined, 2.5)).rejects.toThrow("stop");
  expect(ask).toMatch(/Current level: 3\/5[^]*other half one level up, 4\/5/);
  await expect(gatherWeb(gw, course, "he", 3, undefined, 5)).rejects.toThrow("stop");
  expect(ask).toMatch(/Current level: 5\/5[^]*top level/);
});
