// @vitest-environment node
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { SettingsData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { EventSchema } from "@/core/domain/dataSchemas";
import { isConflictCopy } from "@/core/lib/fs/conflicts";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = { title: "u", summary: "s", stages: Array.from({ length: 18 }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) };
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["first objective", "second objective"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });

it("recognises sync conflict copies", () => {
  for (const n of ["a (1).json", "e (2).jsonl", "a (conflicted copy).json", "a (Bob's conflicted copy 2026-01-01).md", "a (Case Conflict).json"]) expect(isConflictCopy(n), n).toBe(true);
  for (const n of ["a.json", "dev-1.jsonl", "notes (final) v2.json", "(1)"]) expect(isConflictCopy(n), n).toBe(false);
});

it("settings round trip, conflict warning, ignored copies and shalav_context", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit, unit] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});
  const n = "01040195";
  const p = coursePaths(useSettings.getState().settings.dataRoot, n);

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const sc = (r: { structuredContent?: unknown }) => r.structuredContent as SettingsData;
  const tools = (await client.listTools()).tools;
  expect(tools.find((t) => t.name === "settings_update")?._meta).toMatchObject({ ui: { visibility: ["app"] } });

  expect(sc(await call("shalav_settings")).conflicts).toEqual([]);
  const r = sc(await call("settings_update", { language: "en", learning: { ...sc(await call("shalav_settings")).learning, minExercises: 4 } }));
  expect(r.language).toBe("en");
  expect(r.learning.minExercises).toBe(4);
  expect((await call("settings_update", { learning: { minExercises: 99 } })).isError).toBe(true); // schema bounds
  useSettings.getState().update({ language: "he" });

  // a provider conflict copy of an events file: warned about and not read
  await mkdir(p.events, { recursive: true });
  const ev = { id: "01HZZZZZZZZZZZZZZZZZZZZZZZ", ts: "2026-01-01T00:00:00.000Z", deviceId: "x", type: "stage_started", stageId: "S001" };
  await writeFile(join(p.events, "dev1 (1).jsonl"), JSON.stringify(ev) + "\n");
  expect(await readJsonlDir(p.events, EventSchema)).toEqual([]);
  expect(sc(await call("shalav_settings")).conflicts).toEqual([expect.stringContaining("dev1 (1).jsonl")]);

  // side-question context
  const c = await call("shalav_context");
  const t = JSON.stringify(c.content);
  expect(c.isError).toBeFalsy();
  expect(t).toContain("KNOWLEDGE BOUNDARY");
  expect(t).toContain("Not learned yet");
  expect(t).toContain("S001");
  expect((await call("shalav_context", { courseNumber: "02340117" })).isError).toBe(true);
});
