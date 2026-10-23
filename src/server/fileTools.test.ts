// @vitest-environment node
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import type { FilesData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const opened: string[] = [];
vi.mock("./native", async (orig) => ({ ...(await orig<typeof import("./native")>()), openFolder: async (p: string) => void opened.push(p) }));
vi.mock("@/core/domain/ingest/pageSource", async (orig) => {
  const m = await orig<typeof import("@/core/domain/ingest/pageSource")>();
  const { PasswordProtectedError } = await import("@/core/domain/ingest/types");
  return { ...m, openSource: (async (s) => { if (/locked/.test(s.path)) throw new PasswordProtectedError(); return m.openSource(s); }) as typeof m.openSource };
});

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const b64 = (s: string) => Buffer.from(s).toString("base64");

const TOOLS = ["submit_plan_revision", "submit_stage_additions", "submit_material_pages"] as const;
const sid = (k: number) => `S${String(k).padStart(3, "0")}`;
const revUnit = (from: number) => ({ title: "u", summary: "s", stages: Array.from({ length: 18 }, (_, i) => ({ title: "t", kind: "concept", summary: "s", prerequisites: [], sourceId: sid(from + i) })) });
const answers = {
  submit_material_pages: { pages: [{ page: 1, stageIds: ["S001"], summary: "s", hasFigure: false, hasExercises: false }] },
  submit_plan_revision: { courseKind: "mixed", units: [revUnit(1), revUnit(19)] }, // same 36 stages: nothing added
  submit_stage_additions: { stages: [{ id: "S001", techniques: [], edgeCases: [], theorems: [] }] }, // S001 is the only kept stage with file lines (as L85)
};
/** Answers every build job (several per result are answered in parallel) until the build's summary; returns it and the job kinds seen. */
async function drive(call: (n: string, a?: Record<string, unknown>) => Promise<{ content?: unknown }>) {
  const seen = new Set<string>();
  let r = await call("shalav_next_job", { build: true });
  for (let i = 0; i < 30; i++) {
    const t = JSON.stringify(r.content);
    const sum = /The study plan for \d+ is [^"]*/.exec(t)?.[0];
    if (sum) return { sum, seen };
    const jobs = t.split("# Shalav job #").slice(1).map((x) => ({ id: Number(/^\d+/.exec(x)?.[0]), tool: TOOLS.find((k) => x.includes(k)) }));
    if (!jobs.length) { r = await call("shalav_next_job", { build: true }); continue; } // "still running (reading files)"
    const rs = await Promise.all(jobs.map(({ id, tool }) => (tool && seen.add(tool), call("shalav_submit_job", { jobId: id, input: tool ? answers[tool] : {} }))));
    r = { content: rs.flatMap((x) => x.content as unknown[]) };
  }
  throw new Error("the build did not end");
}

async function boot() {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(18), unit(18)] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { call, client, num: "01040195" };
}

it("uploads in chunks, lists, indexes through the bridge, removes", async () => {
  const { call, client, num } = await boot();
  const up = (index: number, data: string, name = "notes.txt") => call("file_upload_chunk", { number: num, role: "material", name, index, total: 2, data: b64(data) });

  expect((await client.listTools()).tools.find((t) => t.name === "file_upload_chunk")?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  for (const n of ["files_list", "plan_build_request"])
    expect((await client.listTools()).tools.find((t) => t.name === n)?._meta).toMatchObject({ ui: { visibility: ["model", "app"] } });

  let f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f).toMatchObject({ materials: [], exercises: [] });

  expect((await up(1, "x")).isError).toBe(true); // out of order
  expect(sc<{ done: boolean }>(await up(0, "limits of ")).done).toBe(false);
  expect(sc<{ status: string }>(await up(1, "sequences")).status).toBe("added");
  await up(0, "limits of ", "again.txt");
  expect(sc<{ status: string }>(await up(1, "sequences", "again.txt")).status).toBe("duplicate"); // same bytes

  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials).toMatchObject([{ name: "notes.txt", status: "pending", pages: 1 }]);

  // Update plan (a plan exists): index the new file, then check every topic is covered — one bridge operation
  expect((await call("plan_build_request", { number: num })).isError).toBeFalsy();
  const job = JSON.stringify((await call("shalav_next_job", { build: true })).content);
  const id = Number(/job #(\d+)/.exec(job)?.[1]);
  expect(job).toContain("limits of sequences");
  // the build counts its files by state (not "file 1 of 1" as soon as they are queued)
  expect(sc<{ step: string; files: unknown }>(await call("course_status", { number: num }))).toMatchObject({ step: "index", files: { scanned: 0, scanning: 1, notScanned: 0, total: 1 } });
  const done = await call("shalav_submit_job", { jobId: id, input: { pages: [{ page: 1, stageIds: ["S001"], summary: "s", hasFigure: false, hasExercises: false }] } });
  // the same run then refines the plan for coverage
  const rev = JSON.stringify(done.content);
  expect(rev).toContain("submit_plan_revision");
  expect(rev).toContain("- notes.txt p1: s"); // the file's lines sit under the stage they cover
  const fin = await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(rev)?.[1]), input: { courseKind: "mixed", units: [revUnit(1), revUnit(19)] } });
  // kept stage S001 has a file line: one enrich job asks what it is missing
  const ask = JSON.stringify(fin.content);
  expect(ask).toContain("submit_stage_additions");
  const end = await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(ask)?.[1]), input: { stages: [{ id: "S001", techniques: ["epsilon-N"], edgeCases: [], theorems: [] }] } });
  expect(JSON.stringify(end.content)).toMatch(/updated from 1 newly read course file\(s\); it already covered every topic/);

  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials[0]?.status).toBe("indexed");

  // the file menu: Open (the system opens it), Read again (waits for the next Update plan)
  expect((await call("file_open", { number: num, sha: f.materials[0]?.sha })).isError).toBeFalsy();
  expect(opened.at(-1)).toMatch(/\/notes\.txt$/);
  expect((await call("file_reindex", { number: num, sha: f.materials[0]?.sha })).isError).toBeFalsy();
  expect(sc<FilesData>(await call("files_list", { number: num })).materials[0]?.status).toBe("pending");
  expect((await call("file_reindex", { number: num, sha: "nope" })).isError).toBe(true);

  await call("file_remove", { number: num, sha: f.materials[0]?.sha });
  expect(sc<FilesData>(await call("files_list", { number: num })).materials).toEqual([]);
});

it("follows the folders mid-build: an added file waits for the next build, a renamed one stays in it, an edited one is cancelled and waits", async () => {
  const { call, num } = await boot();
  const dir = coursePaths(useSettings.getState().settings.dataRoot, num).materials;
  await writeFile(join(dir, "a.txt"), "limits of sequences"); // put there outside the app
  expect(sc<FilesData>(await call("files_list", { number: num })).materials).toMatchObject([{ name: "a.txt", status: "pending" }]);

  await call("plan_build_request", { number: num });
  expect(JSON.stringify((await call("shalav_next_job", { build: true })).content)).toContain("limits of sequences"); // a.txt is being read
  await writeFile(join(dir, "late.txt"), "continuity");
  let f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials.map((m) => [m.name, m.status, !!m.inBuild])).toEqual([["a.txt", "indexing", true], ["late.txt", "pending", false]]);
  expect(sc<{ files: unknown }>(await call("course_status", { number: num })).files).toMatchObject({ total: 1 }); // late.txt is not in this build

  await rename(join(dir, "a.txt"), join(dir, "b.txt")); // renamed outside the app while it is read: same file, the build goes on
  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials.map((m) => [m.name, m.status, !!m.inBuild])).toEqual([["b.txt", "indexing", true], ["late.txt", "pending", false]]);

  await writeFile(join(dir, "b.txt"), "limits of sequences, edited"); // edited while it is read: the old version is cancelled, the new one waits for the next build
  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials.map((m) => [m.name, m.status, !!m.inBuild]).sort()).toEqual([["b.txt", "pending", false], ["late.txt", "pending", false]]);

  await rm(join(dir, "late.txt")); // deleted outside the app: gone, like Remove in the card
  await vi.waitFor(async () => expect(sc<{ state: string }>(await call("course_status", { number: num })).state).toBe("done"));
  expect(sc<FilesData>(await call("files_list", { number: num })).materials).toMatchObject([{ name: "b.txt", status: "pending", inBuild: undefined }]); // the next Update plan reads it
});

it("deleted mid-build: the file's job is withdrawn and the build ends", async () => {
  const { call, num } = await boot();
  const dir = coursePaths(useSettings.getState().settings.dataRoot, num).materials;
  await writeFile(join(dir, "a.txt"), "limits of sequences");
  await call("plan_build_request", { number: num });
  expect(JSON.stringify((await call("shalav_next_job", { build: true })).content)).toContain("limits of sequences");
  await rm(join(dir, "a.txt"));
  expect(sc<FilesData>(await call("files_list", { number: num })).materials).toEqual([]);
  await vi.waitFor(async () => expect(sc<{ state: string }>(await call("course_status", { number: num })).state).toBe("done"));
});

it("renamed mid-scan: the scan's result keeps the new name", async () => {
  const { call, num } = await boot();
  const dir = coursePaths(useSettings.getState().settings.dataRoot, num).materials;
  await writeFile(join(dir, "a.txt"), "limits of sequences");
  await call("plan_build_request", { number: num });
  const job = JSON.stringify((await call("shalav_next_job", { build: true })).content);
  await rename(join(dir, "a.txt"), join(dir, "b.txt"));
  await call("files_list", { number: num });
  await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(job)?.[1]), input: { pages: [{ page: 1, stageIds: ["S001"], summary: "s", hasFigure: false, hasExercises: false }] } });
  expect(await listFileIndexes(num)).toMatchObject([{ fileName: "b.txt", status: "indexed" }]); // as written, before any scan fixes it
});

it("M70: the teacher's notes zone takes uploads and lists them apart", async () => {
  const { call, num } = await boot();
  expect(sc<{ status: string }>(await call("file_upload_chunk", { number: num, role: "teacher", name: "hw2 graded.txt", index: 0, total: 1, data: b64("missing section number") })).status).toBe("added");
  const f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.teacher).toMatchObject([{ name: "hw2 graded.txt", status: "pending" }]);
  expect(f.materials).toEqual([]);
});

it("U8: the summary counts the files this build read; refine still runs when nothing new was read; a failed file is not counted", async () => {
  const { call, num } = await boot(); // boot already made the plan (36 stages)
  const upload = (name: string, data: string) => call("file_upload_chunk", { number: num, role: "material", name, index: 0, total: 1, data: b64(data) });

  // 1) two files, first update: both read
  await upload("a.txt", "limits of sequences");
  await upload("b.txt", "continuity");
  await call("plan_build_request", { number: num });
  expect((await drive(call)).sum).toMatch(/is updated from 2 newly read course file\(s\); it already covered every topic/);

  // 2) one more file: 2 indexed + 1 pending -> "from 1" (old code says "from 3"), and refine (+ enrich) still runs
  await upload("c.txt", "derivatives");
  await call("plan_build_request", { number: num });
  let d = await drive(call);
  expect(d.sum).toMatch(/is updated from 1 newly read course file\(s\); it already covered every topic/);
  expect(d.seen).toContain("submit_plan_revision");

  // 3) nothing pending (text-only host / the model calls plan_build_request): no count, refine runs exactly as before
  await call("plan_build_request", { number: num });
  d = await drive(call);
  expect(d.sum).toMatch(/is updated \(no course file was newly read\); it already covered every topic/);
  expect(d.sum).not.toMatch(/course file\(s\)/);
  expect(d.seen).toContain("submit_plan_revision");
  expect(d.seen).not.toContain("submit_material_pages");

  // 4) a file that fails during the build is not counted
  await upload("locked.txt", "secret");
  await upload("d.txt", "integrals");
  await call("plan_build_request", { number: num });
  d = await drive(call);
  expect(d.sum).toMatch(/is updated from 1 newly read course file\(s\)/); // old code: "from 4"
  const m = sc<FilesData>(await call("files_list", { number: num })).materials;
  expect(m.find((x) => x.name === "d.txt")?.status).toBe("indexed");
  expect(m.find((x) => x.name === "locked.txt")?.status).toBe("failed");
}, 20_000);
