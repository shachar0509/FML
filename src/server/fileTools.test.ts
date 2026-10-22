// @vitest-environment node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it, vi } from "vitest";
import type { FilesData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const opened: string[] = [];
vi.mock("./native", async (orig) => ({ ...(await orig<typeof import("./native")>()), openFolder: async (p: string) => void opened.push(p) }));

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const b64 = (s: string) => Buffer.from(s).toString("base64");

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
  const sid = (k: number) => `S${String(k).padStart(3, "0")}`;
  const revUnit = (from: number) => ({ title: "u", summary: "s", stages: Array.from({ length: 18 }, (_, i) => ({ title: "t", kind: "concept", summary: "s", prerequisites: [], sourceId: sid(from + i) })) });
  const fin = await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(rev)?.[1]), input: { courseKind: "mixed", units: [revUnit(1), revUnit(19)] } });
  // kept stage S001 has a file line: one enrich job asks what it is missing
  const ask = JSON.stringify(fin.content);
  expect(ask).toContain("submit_stage_additions");
  const end = await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(ask)?.[1]), input: { stages: [{ id: "S001", techniques: ["epsilon-N"], edgeCases: [], theorems: [] }] } });
  expect(JSON.stringify(end.content)).toMatch(/updated from 1 course file\(s\); it already covered every topic/);

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

it("follows the folders: a file added mid-build waits for the next build, one deleted mid-build stops being read", async () => {
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

  await rm(join(dir, "a.txt")); // deleted outside the app while it is read: its job is withdrawn, like Remove in the card
  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials.map((m) => m.name)).toEqual(["late.txt"]);
  await vi.waitFor(async () => expect(sc<{ state: string }>(await call("course_status", { number: num })).state).toBe("done"));
  expect(sc<FilesData>(await call("files_list", { number: num })).materials).toMatchObject([{ name: "late.txt", status: "pending", inBuild: undefined }]); // the next Update plan reads it
});
