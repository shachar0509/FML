// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { CourseData, HomeData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = (u: number) => ({ title: `יחידה ${u}`, summary: "s", stages: Array.from({ length: 18 }, (_, i) => ({ title: `שלב ${u}.${i}`, kind: "concept", summary: "תקציר", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;

it("Translate: a study-lane job, then the course card and Home show the course in the settings language", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(1), unit(2)] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "חשבון אינפיניטסימלי 1", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});
  useSettings.setState({ settings: { ...useSettings.getState().settings, language: "en" } });

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const num = "01040195";
  await call("shalav_choose_university", { university: "technion" });

  let c = sc<CourseData>(await call("shalav_course", { number: num }));
  expect(c.name).toBe("חשבון אינפיניטסימלי 1"); // not translated yet: the original
  expect(c.translate).toEqual({ missing: 1 + 2 + 36 + 1, running: false }); // name, unit titles, stage titles, one shared summary

  expect((await client.listTools()).tools.find((t) => t.name === "course_translate_request")?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  expect((await call("course_translate_request", { number: num })).isError).toBeFalsy();
  expect(sc<CourseData>(await call("shalav_course", { number: num })).translate.running).toBe(true);

  // the chat that got "▶️ Continue" (study lane) finds the job; every numbered text gets an answer
  const job = JSON.stringify((await call("shalav_next_job")).content).replaceAll("\\n", "\n");
  expect(job).toContain("submit_translations");
  const lines = [...job.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ i: Number(m[1]), src: m[2] ?? "" }));
  expect(lines).toHaveLength(40);
  const en = (s: string) => (s === "חשבון אינפיניטסימלי 1" ? "Calculus 1" : s.replace("יחידה", "Unit").replace("שלב", "Stage").replace("תקציר", "Summary"));
  const done = await call("shalav_submit_job", { jobId: Number(/job #(\d+)/.exec(job)?.[1]), input: { items: lines.map(({ i, src }) => ({ i, text: en(src) })) } });
  expect(JSON.stringify(done.content)).toContain("40 text(s) of the 01040195 plan were translated");

  c = sc<CourseData>(await call("shalav_course", { number: num }));
  expect(c.name).toBe("Calculus 1");
  expect(c.units.map((u) => u.title)).toEqual(["Unit 1", "Unit 2"]);
  expect(c.units[0]?.stages[0]).toMatchObject({ title: "Stage 1.0", summary: "Summary" });
  expect(c.translate).toEqual({ missing: 0, running: false });
  expect(sc<HomeData>(await call("shalav_home")).courses[0]).toMatchObject({ name: "Calculus 1", stage: "S001 · Stage 1.0" });

  // back in Hebrew: the original texts, nothing to translate
  useSettings.setState({ settings: { ...useSettings.getState().settings, language: "he" } });
  c = sc<CourseData>(await call("shalav_course", { number: num }));
  expect([c.name, c.translate.missing]).toEqual(["חשבון אינפיניטסימלי 1", 0]);
});
