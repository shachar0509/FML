// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { CourseData, LookupResult } from "@/cards/types";
import { PlanJsonSchema } from "@/domain/dataSchemas";
import { validatePlan } from "@/domain/plan/plan";
import { readJsonFile } from "@/lib/fs/atomicWrite";
import { coursePaths } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const entry = { courseNumber: "01040195", nameHe: "חשבון אינפיניטסימלי 1", credits: 5.5, faculty: "מתמטיקה", syllabusHe: "קדם: ...", prerequisitesRaw: "", semester: "202402" };
const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, (_, i) => ({ title: `t${i}`, kind: "concept", summary: "s", prerequisites: [] })) });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;

it("looks up, creates a course through the bridge with fake jobs, shows the course", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer(undefined, { id: "technion", lookup: async (n) => (n === entry.courseNumber ? entry : null) }).connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const text = (r: { content?: unknown }) => JSON.stringify(r.content);

  // card-only tools are hidden from the model
  const tools = (await client.listTools()).tools;
  for (const n of ["course_lookup", "course_create_request", "plan_retry_request", "course_status"])
    expect(tools.find((t) => t.name === n)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  expect(tools.find((t) => t.name === "shalav_course")?._meta).toMatchObject({ ui: { resourceUri: "ui://shalav/cards.html" } });

  expect(sc<LookupResult>(await call("course_lookup", { number: "abc" })).status).toBe("invalid");
  expect(sc<LookupResult>(await call("course_lookup", { number: "01040195" })).status).toBe("found");
  expect(sc<LookupResult>(await call("course_lookup", { number: "01040196" })).status).toBe("notfound");

  expect((await call("course_create_request", { number: "01040195" })).isError).toBeFalsy();
  expect(sc<{ state: string }>(await call("course_status", { number: "01040195" })).state).toBe("running");

  // the host model answers the jobs: outline, then the unit details, until the final summary
  let r = await call("shalav_next_job");
  let final = "";
  for (let i = 0; i < 20 && !final; i++) {
    const t = text(r);
    const id = Number(/job #(\d+)/.exec(t)?.[1]);
    expect(id).toBeGreaterThan(0);
    const input = t.includes("submit_plan_outline")
      ? { courseKind: "computational", units: [unit(35), unit(35)] }
      : { stages: (/stage ids ([S\d, ]+)\./.exec(t.replaceAll("\\n", "\n"))?.[1] ?? "").split(", ").map((sid) => ({ id: sid, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30 })) };
    r = await client.callTool({ name: "shalav_submit_job", arguments: { jobId: id, input } });
    if (/The plan for \d+ is ready/.test(text(r))) final = text(r);
  }
  expect(final).toContain("shalav_course");
  expect(sc<{ state: string }>(await call("course_status", { number: "01040195" })).state).toBe("done");

  const root = useSettings.getState().settings.dataRoot;
  const plan = await readJsonFile(coursePaths(root, "01040195").planJson, PlanJsonSchema);
  expect(plan?.stages).toHaveLength(70);
  if (!plan) throw new Error("no plan.json");
  expect(validatePlan(plan, 5.5)).toEqual([]);

  const c = sc<CourseData>(await call("shalav_course", { number: "01040195" }));
  expect(c).toMatchObject({ view: "course", hasPlan: true, build: null, stagesTotal: 70, current: "S001" });
  expect(c.units.map((u) => u.stages.length)).toEqual([35, 35]);
  expect(sc<LookupResult>(await call("course_lookup", { number: "01040195" })).status).toBe("exists");
  expect((await call("course_create_request", { number: "01040195" })).isError).toBe(true);
  expect((await call("shalav_course", { number: "99999999" })).isError).toBe(true);
}, 20_000);
