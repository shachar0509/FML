// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { FilesData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const b64 = (s: string) => Buffer.from(s).toString("base64");

it("uploads in chunks, lists, indexes through the bridge, removes", async () => {
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
  const num = "01040195";
  const up = (index: number, data: string, name = "notes.txt") => call("file_upload_chunk", { number: num, role: "material", name, index, total: 2, data: b64(data) });

  expect((await client.listTools()).tools.find((t) => t.name === "file_upload_chunk")?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  for (const n of ["files_list", "files_start_indexing", "plan_improve_request"])
    expect((await client.listTools()).tools.find((t) => t.name === n)?._meta).toMatchObject({ ui: { visibility: ["model", "app"] } });

  let f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f).toMatchObject({ materials: [], exercises: [], hasPlan: true, canIndex: false, canImprove: false });

  expect((await up(1, "x")).isError).toBe(true); // out of order
  expect(sc<{ done: boolean }>(await up(0, "limits of ")).done).toBe(false);
  expect(sc<{ status: string }>(await up(1, "sequences")).status).toBe("added");
  await up(0, "limits of ", "again.txt");
  expect(sc<{ status: string }>(await up(1, "sequences", "again.txt")).status).toBe("duplicate"); // same bytes

  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials).toMatchObject([{ name: "notes.txt", status: "pending", pages: 1 }]);
  expect(f.canIndex).toBe(true);

  // indexing is a bridge operation answered by the host model
  expect(sc<{ count: number }>(await call("files_start_indexing", { number: num })).count).toBe(1);
  const job = JSON.stringify((await call("shalav_next_job")).content);
  const id = Number(/job #(\d+)/.exec(job)?.[1]);
  expect(job).toContain("limits of sequences");
  const done = await call("shalav_submit_job", { jobId: id, input: { pages: [{ page: 1, stageIds: ["S001"], summary: "s", hasFigure: false, hasExercises: false }] } });
  // the same run then refines the plan (M15: one Enter does both)
  const rev = JSON.stringify(done.content);
  expect(rev).toContain("submit_plan_revision");
  const sid = (k: number) => `S${String(k).padStart(3, "0")}`;
  const revUnit = (from: number) => ({ title: "u", summary: "s", stages: Array.from({ length: 18 }, (_, i) => ({ title: "t", kind: "concept", summary: "s", prerequisites: [], sourceId: sid(from + i) })) });
  const fin = await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(rev)?.[1]), input: { courseKind: "mixed", units: [revUnit(1), revUnit(19)] } });
  expect(JSON.stringify(fin.content)).toMatch(/Indexed 1 file/);

  f = sc<FilesData>(await call("files_list", { number: num }));
  expect(f.materials[0]?.status).toBe("indexed");
  expect(f.canImprove).toBe(true);
  expect(f.canIndex).toBe(false);

  await call("file_remove", { number: num, sha: f.materials[0]?.sha });
  expect(sc<FilesData>(await call("files_list", { number: num })).materials).toEqual([]);
});
