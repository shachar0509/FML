// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { CourseData, LookupResult } from "@/cards/types";
import { PlanJsonSchema } from "@/core/domain/dataSchemas";
import { validatePlan } from "@/core/domain/plan/plan";
import { readJsonFile } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
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
  expect((await call("course_lookup", { number: "104066" })).isError).toBe(true); // no university yet
  await call("shalav_choose_university", { university: "technion" });
  const text = (r: { content?: unknown }) => JSON.stringify(r.content);

  // the course flow is also open to the model (Claude Code has no cards)
  const tools = (await client.listTools()).tools;
  for (const n of ["course_lookup", "course_create_request", "plan_build_request", "course_status"])
    expect(tools.find((t) => t.name === n)?._meta).toMatchObject({ ui: { visibility: ["model", "app"] } });
  expect(tools.find((t) => t.name === "shalav_course")?._meta).toMatchObject({ ui: { resourceUri: "ui://shalav/cards.html" } });

  expect(sc<LookupResult>(await call("course_lookup", { number: "abc" })).status).toBe("invalid");
  expect(sc<LookupResult>(await call("course_lookup", { number: "01040195" })).status).toBe("found");
  expect(sc<LookupResult>(await call("course_lookup", { number: "01040196" })).status).toBe("notfound");

  // adding a course only creates it; the student adds files and builds the plan when ready
  expect((await call("course_create_request", { number: "01040195" })).isError).toBeFalsy();
  expect(sc<{ state: string }>(await call("course_status", { number: "01040195" })).state).toBe("none");
  expect(sc<CourseData>(await call("shalav_course", { number: "01040195" }))).toMatchObject({ hasPlan: false, build: null });
  expect(text(await call("shalav_next_job"))).toContain("No Shalav job");
  expect((await call("plan_build_request", { number: "01040195" })).isError).toBeFalsy();
  expect(sc<{ state: string }>(await call("course_status", { number: "01040195" })).state).toBe("running");
  expect(sc<{ courses: { building?: boolean }[] }>(await call("shalav_home")).courses[0]?.building).toBe(true);

  // the host model answers the jobs ("▶️ Building the plan"): outline, then the unit details, until the final summary
  expect(text(await call("shalav_next_job"))).toContain("No Shalav job"); // "▶️ Continue" never gets build jobs
  let r = await call("shalav_next_job", { build: true });
  let final = "";
  for (let i = 0; i < 20 && !final; i++) {
    const t = text(r);
    const id = Number(/job #(\d+)/.exec(t)?.[1]);
    expect(id).toBeGreaterThan(0);
    const input = t.includes("submit_plan_outline")
      ? { courseKind: "computational", units: [unit(35), unit(35)] }
      : { stages: (/stage ids ([S\d, ]+)\./.exec(t.replaceAll("\\n", "\n"))?.[1] ?? "").split(", ").map((sid) => ({ id: sid, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30 })) };
    r = await client.callTool({ name: "shalav_submit_job", arguments: { jobId: id, input } });
    if (/The study plan for \d+ is built/.test(text(r))) final = text(r);
  }
  expect(final).toContain("the card shows the plan");
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

it("builds at once: one chat works through both, each job belongs to its own course", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  const others = ["01040196", "01040197"].map((courseNumber) => ({ ...entry, courseNumber }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer(undefined, { id: "technion", lookup: async (n) => [entry, ...others].find((e) => e.courseNumber === n) ?? null }).connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const text = (r: { content?: unknown }) => JSON.stringify(r.content);
  await call("shalav_choose_university", { university: "technion" });
  const courses = ["01040195", "01040196", "01040197"]; // three: the index queue runs two courses at a time

  for (const n of courses) {
    await call("course_create_request", { number: n });
    const data = Buffer.from(`Lecture notes of ${n}: limits and sequences.`).toString("base64");
    expect(sc<{ status: string }>(await call("file_upload_chunk", { number: n, role: "material", name: `notes-${n}.txt`, index: 0, total: 1, data })).status).toBe("added");
  }
  const [first, ...rest] = courses as [string, ...string[]];
  expect(sc<{ joined: boolean }>(await call("plan_build_request", { number: first })).joined).toBe(false);

  // chat 1 ("▶️ Building the plan") works through the build lane; the other builds join it and a summary hands off to the next course
  const seen: Record<string, number> = {};
  let handoffs = 0;
  let r = await call("shalav_next_job", { build: true });
  for (const n of rest) expect(sc<{ joined: boolean }>(await call("plan_build_request", { number: n })).joined).toBe(true);
  // chat 2 ("▶️ Continue") meanwhile: no build jobs, and a lesson request is served at once
  expect(text(await call("shalav_next_job"))).toContain("No Shalav job is pending");
  await call("shalav_request", { kind: "learn", stageId: "S001", title: "t" });
  expect(text(await call("shalav_next_job"))).toContain("shalav_start_lesson");
  for (let i = 0; i < 60; i++) {
    const t = text(r);
    if (t.includes("No build work is pending")) break;
    const job = /job #(\d+) \(Building the study plan for (\d+)\)/.exec(t);
    if (!job) {
      expect(t).toMatch(/The study plan for \d+ is built/);
      if (!t.includes("call shalav_next_job with build: true")) break; // the last build: no hand-off
      handoffs++;
      r = await call("shalav_next_job", { build: true });
      continue;
    }
    const n = job[2] as string;
    for (const c of courses) if (c !== n) expect(t.includes(c)).toBe(false); // nothing of another course
    seen[n] = (seen[n] ?? 0) + 1;
    const input = t.includes("submit_plan_outline")
      ? { courseKind: "computational", units: [unit(35), unit(35)] }
      : t.includes("submit_plan_revision") // same plan, nothing added
        ? { courseKind: "computational", units: [0, 35].map((o) => ({ ...unit(35), stages: unit(35).stages.map((st, k) => ({ ...st, prerequisites: [], sourceId: `S${String(o + k + 1).padStart(3, "0")}` })) })) }
        : t.includes("submit_material_pages")
        ? { pages: [{ page: 1, stageIds: ["S001"], summary: "limits", hasFigure: false, hasExercises: false }] }
        : { stages: (/stage ids ([S\d, ]+)\./.exec(t.replaceAll("\\n", "\n"))?.[1] ?? "").split(", ").map((sid) => ({ id: sid, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30 })) };
    r = await call("shalav_submit_job", { jobId: Number(job[1]), input });
  }
  expect(handoffs).toBeGreaterThanOrEqual(1);
  for (const n of courses) {
    expect(sc<{ state: string }>(await call("course_status", { number: n })).state).toBe("done");
    expect(sc<{ materials: { status: string }[] }>(await call("files_list", { number: n })).materials.map((f) => f.status)).toEqual(["indexed"]);
    expect(seen[n]).toBeGreaterThanOrEqual(4); // outline, two units, the notes
  }
}, 60_000);
