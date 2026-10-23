// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { LessonData, McqData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { EventSchema } from "@/core/domain/dataSchemas";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["first objective", "second objective"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const text = (r: { content?: unknown }) => JSON.stringify(r.content);

it("runs a lesson: start, questions, events, status, completion, reopen + recap", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(18), unit(18)] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});
  const n = "01040195";
  const events = () => readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema);

  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const tools = (await client.listTools()).tools;
  for (const t of ["check_answer", "lesson_state", "stage_complete", "stage_reopen"]) expect(tools.find((x) => x.name === t)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  for (const t of ["shalav_start_lesson", "shalav_lesson_status", "present_mcq", "ask_open_question", "record_check_result", "update_assessment", "consult_materials"]) expect(tools.map((x) => x.name)).toContain(t);

  // figures: validated on the server, rendered by the card
  const fig = await call("show_figure", { kind: "plot", source: JSON.stringify({ xDomain: [-2, 2], yDomain: [0, 4], data: [{ fn: "x^2" }] }), captionMd: "$y=x^2$" });
  expect(sc(fig)).toMatchObject({ view: "figure", kind: "plot", captionMd: "$y=x^2$" });
  expect((await call("show_figure", { kind: "plot", source: "not json" })).isError).toBe(true);
  expect((await call("show_figure", { kind: "svg", source: "<div/>" })).isError).toBe(true);

  // tutor tools need an open lesson
  expect((await call("shalav_lesson_status")).isError).toBe(true);

  expect((await call("teach_step", { titleMd: "t", bodyMd: "b" })).isError).toBe(true); // no lesson yet
  const start = await call("shalav_start_lesson", { courseNumber: n });
  expect(text(start)).toContain("[STATUS]");
  expect(text(start)).toContain("teach_step");
  // lesson steps: small, rendered by the card; a too long step is sent back to be split
  const step = await call("teach_step", { titleMd: "Fields", bodyMd: "A **field** is $F$ with $+$ and $\\cdot$.", figure: { kind: "svg", source: "<svg viewBox='0 0 1 1'></svg>" } });
  expect(sc(step)).toMatchObject({ view: "step", titleMd: "Fields", figure: { kind: "svg", captionMd: "" } });
  expect(text(await call("teach_step", { titleMd: "x", bodyMd: "word ".repeat(300) }))).toMatch(/too long.*split/);
  expect(sc(await call("teach_step", { titleMd: "x", bodyMd: "b", progress: { n: 7, of: 5 } }))).toMatchObject({ progress: { n: 5, of: 5 } });
  expect(sc(await call("teach_step", { titleMd: "x", bodyMd: "b", sideMd: "$\\N \\subset \\Z$" }))).toMatchObject({ sideMd: "$\\N \\subset \\Z$" });
  expect(text(await call("teach_step", { titleMd: "x", bodyMd: "word ".repeat(150), sideMd: "note ".repeat(100) }))).toMatch(/too long/); // the side note counts too
  // M78: beats travel to the card; each beat is capped like a step; the figure can't use a beat the slide doesn't have
  const geo = (b: number) => JSON.stringify({ boundingBox: [-1, 3, 3, -1], axis: true, elements: [{ type: "point", id: "V", x: 1, y: 0, label: "(1,0)", beat: 1, color: "blue" }, { type: "curve", fn: "x^2-2x+1", domain: [-1, 3], beat: b }] });
  expect(sc(await call("teach_step", { titleMd: "f", bodyMd: "", beats: [{ md: "$f'(x)=0$" }, { md: "$f''>0$", sideMd: "opens up" }], figure: { kind: "geometry", source: geo(2) } }))).toMatchObject({ beats: [{ md: "$f'(x)=0$", sideMd: null }, { md: "$f''>0$", sideMd: "opens up" }] });
  expect(text(await call("teach_step", { titleMd: "f", bodyMd: "", beats: [{ md: "a" }, { md: "b" }], figure: { kind: "geometry", source: geo(3) } }))).toMatch(/beat 3, but the slide has 2 beats/);
  expect(text(await call("teach_step", { titleMd: "f", bodyMd: "", beats: [{ md: "a" }, { md: "word ".repeat(200) }] }))).toMatch(/Beat 2 is too long/);
  expect(text(await call("teach_step", { titleMd: "f", bodyMd: "", beats: Array.from({ length: 5 }, () => ({ md: "word ".repeat(170) })) }))).toMatch(/slide is too long/);
  expect(text(await call("teach_step", { titleMd: "f", bodyMd: "", beats: [{ md: "a" }, { md: "b" }], figure: { kind: "svg", source: '<svg viewBox="0 0 1 1"><g data-beat="4"/></svg>' } }))).toMatch(/beat 4/);
  // M79: server kinds are drawn when sent (the error reaches Claude); `% @n` markers count as beats; the guide tool answers per kind
  const tikz = (n: number) => String.raw`\begin{tikzpicture}
\draw (0,0) -- (1,0); % @1
\draw[m-blue] (1,0) -- (1,1); % @${n}
\end{tikzpicture}`;
  expect(sc(await call("teach_step", { titleMd: "t", bodyMd: "", beats: [{ md: "a" }, { md: "b" }], figure: { kind: "tikz", source: tikz(2) } }))).toMatchObject({ figure: { kind: "tikz" } });
  expect(text(await call("teach_step", { titleMd: "t", bodyMd: "", beats: [{ md: "a" }, { md: "b" }], figure: { kind: "tikz", source: tikz(3) } }))).toMatch(/beat 3, but the slide has 2 beats/);
  expect(text(await call("teach_step", { titleMd: "t", bodyMd: "", figure: { kind: "tikz", source: String.raw`\begin{tikzpicture}\nodee{x}\end{tikzpicture}` } }))).toMatch(/Invalid tikz figure: .*Undefined control sequence/);
  expect(text(await call("show_figure", { kind: "bio", source: '<svg viewBox="0 0 9 9"><use href="#nucleous"/></svg>' }))).toMatch(/Unknown library part nucleous/);
  expect(text(await call("figure_guide", { kind: "bio" }))).toMatch(/Parts: .*mitochondrion/);
  const drawn = sc<{ svg: string }>(await call("figure_render", { kind: "tikz", source: tikz(2) }));
  expect(drawn.svg).toContain('data-beat="2"');
  // M81: an image figure gets the lesson's course; the student's files are listed when the name is wrong; abc and chords are checked; course_page answers
  expect(text(await call("teach_step", { titleMd: "i", bodyMd: "", figure: { kind: "image", source: '{"file":"x.pdf","course":"other"}' } }))).toMatch(/No course file .*x\.pdf.*no scanned files/);
  expect(text(await call("show_figure", { kind: "abc", source: "X:1\nCDE" }))).toMatch(/K: \(key\) header/);
  expect(text(await call("show_figure", { kind: "chords", source: "{}" }))).toMatch(/Invalid chords figure: expected/);
  expect(text(await call("show_figure", { kind: "smiles", source: "C C O" }))).toMatch(/one SMILES string/);
  expect(sc(await call("show_figure", { kind: "chess", source: '{"moves":[{"move":"e2e4"}]}' }))).toMatchObject({ kind: "chess" });
  expect(sc(await call("show_figure", { kind: "map", source: '{"layers":[{"countries":["Israel"],"beat":0}]}' }))).toMatchObject({ kind: "map" });
  expect(text(await call("course_page", { file: "x.pdf", page: 1 }))).toMatch(/No course file/);
  // a question about the step: answered in a pop-up over the step card, which polls for answers newer than its question
  const asked = Date.now();
  expect(sc(await call("step_answer", { since: asked }))).toEqual({ answerMd: null });
  expect(text(await call("answer_question", { answerMd: "Because $0$ is neutral." }))).toMatch(/shown over the step card/);
  expect(sc(await call("step_answer", { since: asked }))).toEqual({ answerMd: "Because $0$ is neutral." });
  expect(sc(await call("step_answer", { since: Date.now() + 1000 }))).toEqual({ answerMd: null }); // an older answer is not this question's
  // "Explain differently": no question until the step is re-taught
  await call("shalav_request", { kind: "step", action: "again" });
  const mcq = { stageId: "S001", questionMd: "q", options: ["a", "b"], correctIndex: 0, explanationMd: "", conceptTags: [] };
  expect(text(await call("present_mcq", mcq))).toMatch(/Explain differently: re-teach the same step/);
  expect((await call("ask_open_question", { stageId: "S001", questionMd: "q" })).isError).toBe(true);
  await call("teach_step", { titleMd: "x", bodyMd: "simpler" });
  expect((await call("present_mcq", mcq)).isError).toBeFalsy();
  expect((await call("teach_step", { titleMd: "x", bodyMd: "b", figure: { kind: "plot", source: "nope" } })).isError).toBe(true);
  expect(text(start)).toContain("shalav_lesson_status");
  expect(text(start)).not.toContain("[START_LESSON]");
  expect(text(start)).not.toContain("RECAP (the student"); // nothing to recap yet
  expect(sc<LessonData>(start)).toMatchObject({ view: "lesson", stageId: "S001", status: "in_progress" });
  expect((await events()).filter((e) => e.type === "stage_started")).toHaveLength(1);
  expect(sc<LessonData>(await call("lesson_state", { number: n, stageId: "S001" })).status).toBe("in_progress");
  await call("shalav_start_lesson", { courseNumber: n });
  expect((await events()).filter((e) => e.type === "stage_started")).toHaveLength(1); // not repeated
  expect((await call("shalav_start_lesson", { courseNumber: n, stageId: "S999" })).isError).toBe(true); // unknown stage

  // multiple choice: the key stays on the server, the answer is recorded once
  const q = await call("present_mcq", { stageId: "S001", questionMd: "q", options: ["a", "b", "c"], correctIndex: 0, explanationMd: "because", conceptTags: [] });
  expect(sc<McqData>(q)).toMatchObject({ view: "mcq", options: ["a", "b", "c"] });
  expect(JSON.stringify(q.structuredContent)).not.toMatch(/correctIndex|because/);
  const checkId = sc<McqData>(q).checkId;
  const wrong = sc<{ correct: boolean; correctIndex: number; explanationMd: string }>(await call("check_answer", { checkId, selectedIndex: 2 }));
  expect(wrong).toMatchObject({ correct: false, correctIndex: 0, explanationMd: "because" });
  await call("check_answer", { checkId, selectedIndex: 0 }); // second press does not re-record
  expect((await events()).filter((e) => e.type === "check_answered")).toMatchObject([{ kind: "mcq", correct: false, score: 0 }]);
  expect((await call("check_answer", { checkId: "nope", selectedIndex: 0 })).isError).toBe(true);
  expect((await call("present_mcq", { stageId: "S001", questionMd: "q", options: ["a", "b"], correctIndex: 5, explanationMd: "", conceptTags: [] })).isError).toBe(true);

  const tag = { tag: "Sign Error", labelHe: "שגיאת סימן", labelEn: "Sign error", description: "d" };
  await call("record_check_result", { checkToolUseId: checkId, correct: false, score: 0, mistakes: [tag] });
  let ev = await events();
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toMatchObject([{ tag: "sign-error" }]);
  expect(ev.filter((e) => e.type === "mistake_observed")).toMatchObject([{ tag: "sign-error", stageIds: ["S001"], refId: checkId }]);
  expect(ev.filter((e) => e.type === "check_answered")).toHaveLength(1); // MCQ result adds mistakes only

  // open question: recorded by record_check_result
  const oq = await call("ask_open_question", { stageId: "S001", questionMd: "why?", expectedPoints: ["x"], allowAttachment: false });
  const oid = sc<{ checkId: string }>(oq).checkId;
  await call("record_check_result", { checkToolUseId: oid, correct: true, score: 90, mistakes: [tag] });
  ev = await events();
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toHaveLength(1); // tag reused
  expect(ev.filter((e) => e.type === "check_answered").at(-1)).toMatchObject({ kind: "open", correct: true, score: 90, mistakeTags: ["sign-error"] });

  // M62: [STATUS] numbers the lesson's graph nodes; answers are tagged by number; a skill the tutor adds exists once
  expect(text(start)).toMatch(/knowledge graph for this lesson[^]*1\. \[concept\] t — control 10%/);
  expect(text(start)).toMatch(/The student.s knowledge now:[^]{0,8}- Level: 0(\.5)?★ of 5 of the whole course; exam-ready 0%[^]*Weakest nodes of what was learned: t \(10%\)[^]*100\/100/); // M64 digest
  const tq = sc<McqData>(await call("present_mcq", { stageId: "S001", questionMd: "q2", options: ["a", "b"], correctIndex: 1, explanationMd: "", conceptTags: [], nodes: [1, 9] }));
  expect(tq.stars).toBe(3); // M65: a 2/5 MCQ on a node at 10% control, frozen in the card
  await call("check_answer", { checkId: tq.checkId, selectedIndex: 1 });
  const s1 = (await events()).find((e) => e.type === "check_answered" && e.checkId === tq.checkId);
  expect(s1).toMatchObject({ nodes: [{ id: expect.stringMatching(/^S001\/concept\//), score: 1 }] }); // 9 is not listed: dropped
  const skill = { kind: "skill", label: "Cites statute + section", why: "never cites the section number", stageIds: [], score: 0.2 };
  expect(text(await call("update_knowledge_graph", { add: [skill] }))).toContain("2. [skill] Cites statute + section");
  const oq2 = sc<{ checkId: string }>(await call("ask_open_question", { stageId: "S001", questionMd: "cite?", expectedPoints: ["x"], allowAttachment: false })).checkId;
  await call("record_check_result", { checkToolUseId: oq2, correct: false, score: 60, mistakes: [], nodeResults: [{ n: 1, score: 0.8 }], newNodes: [{ ...skill, label: " cites  STATUTE + section", score: 0.4 }] });
  ev = await events();
  expect(ev.filter((e) => e.type === "node_added")).toMatchObject([{ nodeId: expect.stringMatching(/^G\/skill\//), origin: "tutor" }]);
  expect(ev.find((e) => e.type === "check_answered" && e.checkId === oq2)).toMatchObject({ nodes: [{ score: 0.8 }, { id: expect.stringMatching(/^G\/skill\//), score: 0.4 }] });
  // a wrong MCQ tagged with node 1, then record_check_result scoring node 1 again: still one zero on it
  const wq = sc<McqData>(await call("present_mcq", { stageId: "S001", questionMd: "q3", options: ["a", "b"], correctIndex: 1, explanationMd: "", conceptTags: [], nodes: [1] }));
  await call("check_answer", { checkId: wq.checkId, selectedIndex: 0 });
  await call("record_check_result", { checkToolUseId: wq.checkId, correct: false, score: 0, mistakes: [], nodeResults: [{ n: 1, score: 0 }] });
  const n1 = (ev.find((e) => e.type === "check_answered" && e.checkId === oq2) as { nodes: { id: string }[] }).nodes[0]?.id;
  ev = await events();
  expect(ev.filter((e) => e.type === "node_observed" && e.nodeId === n1)).toHaveLength(0);
  expect(ev.find((e) => e.type === "check_answered" && e.checkId === wq.checkId)).toMatchObject({ nodes: [{ id: n1, score: 0 }] });
  const skillControl = async () => Number(/2\. \[skill\] Cites statute \+ section — control (\d+)%/.exec(text(await call("shalav_lesson_status")))?.[1]);
  const before = await skillControl();
  await call("update_knowledge_graph", { observe: [{ n: 2, score: 1, why: "cited section 12 this time" }] });
  expect(await skillControl()).toBeGreaterThan(before); // later answers raise it

  // assessment -> criteria + status
  const as = await call("update_assessment", { stageId: "S001", mastery: 0.6, coveredObjectives: [0], gaps: ["limits"], reviewTopics: [], readyToAdvance: false, rationale: "halfway" });
  expect(JSON.parse(((as.content as { text: string }[])[0] as { text: string }).text)).toMatchObject({ ok: true, advanceCriteriaMet: false });
  expect(text(as)).toMatch(/covered objectives 0.*gaps limits/); // fresh status comes with the result
  expect(text(await call("shalav_lesson_status"))).toMatch(/covered objectives 0.*gaps limits/);
  expect(sc<LessonData>(await call("lesson_state", { number: n, stageId: "S001" }))).toMatchObject({ objectives: [{ covered: true }, { covered: false }] });

  expect(text(await call("consult_materials", { question: "limit", purpose: "definition", stageId: "S001" }))).toContain("No indexed");

  // completion: mastery needs the criteria, override does not
  expect((await call("stage_complete", { number: n, stageId: "S001", by: "mastery" })).isError).toBe(true);
  expect(sc<LessonData>(await call("stage_complete", { number: n, stageId: "S001", by: "user_override" })).status).toBe("completed_override");
  expect(text(await call("shalav_start_lesson", { courseNumber: n, stageId: "S001" }))).toContain("already completed");

  // reopen: relearn with a recap built from the events
  expect(sc<LessonData>(await call("stage_reopen", { number: n, stageId: "S001" })).status).toBe("in_progress");
  const again = text(await call("shalav_start_lesson", { courseNumber: n, stageId: "S001" }));
  expect(again).toContain("RECAP");
  expect(again).toContain("reopened");
  expect(again).toContain("Gaps: limits");
  expect(again).toContain("first objective");

  // ----- M60: lessons are saved; a new server (Claude Desktop restarted) continues the newest one -----
  const s2 = await call("shalav_start_lesson", { courseNumber: n, stageId: "S002" });
  expect(text(s2)).not.toContain("LESSON SO FAR");
  await call("teach_step", { titleMd: "Limits", bodyMd: "first slide" });
  await call("shalav_request", { kind: "step", action: "next" });
  await call("teach_step", { titleMd: "Epsilon", bodyMd: "second slide" });
  const last = sc<McqData>(await call("present_mcq", { stageId: "S002", questionMd: "Which?", options: ["x", "y"], correctIndex: 1, explanationMd: "since y", conceptTags: [] }));
  await call("check_answer", { checkId: last.checkId, selectedIndex: 1 }); // answered before leaving
  const answered = (await events()).filter((e) => e.type === "check_answered").length;
  const lessons = sc<{ items: { id: string; title: string; stageId: string }[] }>(await call("history_list", { number: n, kind: "lesson" })).items;
  expect(lessons[0]).toMatchObject({ stageId: "S002", title: expect.stringMatching(/^S002 · /) });
  expect(lessons.length).toBeGreaterThan(1); // the S001 lessons too
  const root = useSettings.getState().settings.dataRoot;
  expect(existsSync(join(root, ".chat_history", n, `${lessons[0]?.id}.json`))).toBe(true);

  const [a2, b2] = InMemoryTransport.createLinkedPair();
  const c2 = new Client({ name: "t2", version: "0" });
  await Promise.all([createServer().connect(a2), c2.connect(b2)]);
  const call2 = (name: string, args: Record<string, unknown> = {}) => c2.callTool({ name, arguments: args });
  const back = await call2("shalav_start_lesson", { courseNumber: n, resume: "latest" });
  expect(text(back)).toContain("THE LESSON SO FAR");
  for (const x of ["Limits", "Epsilon", "Pressed Continue", "Which?"]) expect(text(back)).toContain(x);
  expect(sc<McqData & { history: { id: string; count: number } }>(back)).toMatchObject({ view: "mcq", checkId: last.checkId, questionMd: "Which?", history: { id: lessons[0]?.id, count: 2 } });
  // the key came back with it, and the answer given before leaving: not recorded again
  expect(sc<{ correct: boolean; selectedIndex: number }>(await call2("check_answer", { checkId: last.checkId, selectedIndex: 0 }))).toMatchObject({ correct: true, selectedIndex: 1 });
  expect((await events()).filter((e) => e.type === "check_answered")).toHaveLength(answered);
  expect(sc<{ slides: { titleMd: string }[] }>(await call2("history_slides", { number: n, id: lessons[0]?.id })).slides.map((x) => x.titleMd)).toEqual(["Limits", "Epsilon"]);
  // a card request to continue a chosen lesson
  await call2("shalav_request", { kind: "resume", number: n, id: lessons[1]?.id });
  expect(text(await call2("shalav_next_job"))).toContain(`resume \\"${lessons[1]?.id}\\"`);
  expect((await call2("shalav_start_lesson", { courseNumber: n, resume: "nope" })).isError).toBe(true);
  // delete
  const left = sc<{ items: unknown[] }>(await call2("history_delete", { number: n, kind: "lesson", ids: [lessons[0]?.id] })).items;
  expect(left).toHaveLength(lessons.length - 1);
});
