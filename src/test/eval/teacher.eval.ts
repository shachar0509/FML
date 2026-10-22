import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, it } from "vitest";
import { EventSchema, type FileIndex, type PlanJson } from "@/core/domain/dataSchemas";
import { readFileIndex, writeFileIndex } from "@/core/domain/ingest/indexStore";
import { createIndexQueue } from "@/core/domain/ingest/queue";
import type { PageSource } from "@/core/domain/ingest/types";
import { setDeviceId } from "@/core/lib/device";
import { setFs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { CliGateway } from "./cliGateway";

/**
 * M71 semantic eval (real model): two graded homeworks whose STUDENT answers are wrong and carry canary phrases.
 * The teacher's comments must come out; the student's text must not reach any stored page, quote or rule.
 * The repeated "missing section number" deduction must share one tag, so it becomes one misconception node.
 */
const N = "01140001";
const course = { courseNumber: N, nameHe: "Torts" };
const st = (i: number, title: string, newConcepts: string[]) => ({
  id: `S00${i}`, unitId: "U01", order: i, title, summary: title, kind: "concept" as const, objectives: ["a", "b"], newConcepts,
  theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
const plan: PlanJson = {
  schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed", units: [{ id: "U01", title: "Torts", summary: "s", stageIds: ["S001", "S002", "S003", "S004"] }],
  stages: [st(1, "Negligence", ["duty of care", "foreseeability"]), st(2, "Damages", ["contributory fault"]), st(3, "Contract basics", ["consideration"]), st(4, "Statutory duty", ["breach of statutory duty"])],
};
const CANARIES = ["canary-plum", "velvet-anchor", "marmalade-doctrine", "automatic liability", "can never be at fault"];
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures/teacher", name), "utf8").split("---page---");
const source = (pages: string[]): PageSource => ({
  pageCount: pages.length, text: async (p) => pages[p - 1] ?? "", imageNeeded: async () => false,
  image: async () => { throw new Error("text fixture"); }, crop: async () => { throw new Error("text fixture"); }, close() {},
});
const rec = (sha: string, fileName: string, pageCount: number): FileIndex => ({
  schema: 1, sha256: sha, fileName, relPath: `הערות המרצה/${fileName}`, role: "teacher", mediaType: "text/markdown", pageCount, addedAt: "t",
  status: "pending", error: null, indexedAt: null, indexModel: null, planVersion: null, materialPages: [], exercises: [],
});

const gw = new CliGateway();
const out: FileIndex[] = [];
beforeAll(async () => {
  setFs(memFs());
  setDeviceId("eval");
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
  // through the real queue, both enqueued together as a Build plan does (teacher files of one course run one at a time)
  const files = { "sha-hw2": "hw2-graded.md", "sha-hw3": "hw3-graded.md" } as const;
  for (const [sha, f] of Object.entries(files)) await writeFileIndex(N, rec(sha, f, fixture(f).length));
  const q = createIndexQueue({
    gw: () => gw, open: async (x) => source(fixture(files[x.sha256 as keyof typeof files])), getPlan: async () => plan, course: async () => course, lang: () => "en", resolve: () => "/x",
  });
  for (const sha of Object.keys(files)) q.enqueue(N, sha);
  await q.idle();
  for (const sha of Object.keys(files)) {
    const r = await readFileIndex(N, sha);
    if (r?.status !== "indexed") throw new Error(`${sha}: ${r?.status} ${r?.error}`);
    out.push(r);
  }
  const report = join(process.env.EVAL_DIR ?? tmpdir(), "eval-teacher.json");
  writeFileSync(report, JSON.stringify({ calls: gw.calls, costUsd: gw.costUsd, indexes: out.map((r) => ({ file: r.fileName, pages: r.materialPages, items: r.teacherItems })), events: await readJsonlDir(coursePaths("/r", N).events, EventSchema) }, null, 1));
  console.log(`eval report: ${report} (${gw.calls} calls, $${gw.costUsd.toFixed(2)})`);
});

it("no student text in any stored page, quote, rule or situation", () => {
  for (const r of out) {
    const stored = [...r.materialPages.map((p) => p.text), ...(r.teacherItems ?? []).flatMap((t) => [t.quote, t.rule, t.when])].join("\n").toLowerCase();
    for (const c of CANARIES) expect(stored, `${r.fileName}: ${c}`).not.toContain(c);
    expect(r.exercises).toEqual([]);
    expect(r.patterns).toBeUndefined();
  }
});

it("the teacher's comments and correction are kept", () => {
  const [hw2] = out as [FileIndex];
  expect(hw2.materialPages.map((p) => p.text).join("\n")).toMatch(/result is 5/i);
  expect(hw2.teacherItems?.some((t) => t.type === "deduction" && /section/i.test(t.rule + t.quote))).toBe(true);
  expect(hw2.teacherItems?.some((t) => t.type === "requirement" && /section/i.test(t.rule))).toBe(true);
  expect(hw2.teacherItems?.some((t) => t.type === "praise")).toBe(true);
});

it("the repeated 'missing section number' deduction becomes one misconception node", async () => {
  const ev = await readJsonlDir(coursePaths("/r", N).events, EventSchema);
  const sectionTag = (r: FileIndex) => r.teacherItems?.find((t) => t.type === "deduction" && /section/i.test(t.rule + t.quote))?.mistake?.tag;
  expect(sectionTag(out[1] as FileIndex)).toBe(sectionTag(out[0] as FileIndex));
  const added = ev.filter((e) => e.type === "node_added" && e.kind === "misconception");
  expect(added.length).toBeGreaterThanOrEqual(1);
  expect(added.filter((e) => e.type === "node_added" && /section/i.test(e.label))).toHaveLength(1);
  expect(ev.some((e) => e.type === "node_observed" && e.context === "teacher")).toBe(true);
});
