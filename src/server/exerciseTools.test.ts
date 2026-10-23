// @vitest-environment node
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { createCanvas } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import type { ExerciseData, LessonData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { saveAnswerFile, saveAttachment } from "@/core/lib/attachments";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { EventSchema } from "@/core/domain/dataSchemas";
import { loadConv } from "@/core/domain/history/history";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, (_, i) => ({ title: "t", kind: i % 2 ? "technique" : "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({
      id, objectives: ["first objective", "second objective"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
    })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;
const text = (r: { content?: unknown }) => JSON.stringify(r.content);
const grade = {
  legibility: "clear", illegibleParts: [], verdict: "partially_correct", score: 70, finalAnswerCorrect: false, summaryMd: "ok", steps: [{ label: "s", status: "correct", commentMd: "c" }],
  missingForFullCredit: ["N"], mistakes: [{ tag: "Missing N", labelHe: "חסר", labelEn: "Missing N", description: "d", severity: "major", whereMd: "line 2" }],
  edgeCasesMissed: [], correctedKeyStepMd: "k", usesMaterialBeyondCompleted: [], stageIds: ["S001"],
};

it("exercise card: hints 1-3, upload, grade through the bridge, solution reveal, events", async () => {
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
  for (const t of ["exercise_state", "exercise_grade_request", "exercise_hint_request", "exercise_solution_request", "exercise_retry", "attachment_upload_chunk"])
    expect(tools.find((x) => x.name === t)?._meta).toMatchObject({ ui: { visibility: ["app"] } });
  expect(tools.map((x) => x.name)).toContain("assign_exercise");

  expect((await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "s", difficulty: 2, edgeCaseFocus: [] })).isError).toBe(true); // no lesson yet
  await call("shalav_start_lesson", { courseNumber: n });
  expect((await call("assign_exercise", { stageIds: ["S001"], source: "index", exerciseId: "nope", difficulty: 2, edgeCaseFocus: [] })).isError).toBe(true);
  const card = await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "Prove $x$.", referenceSolutionMd: "ref", difficulty: 2, edgeCaseFocus: [] });
  const ex = sc<ExerciseData>(card);
  expect(ex).toMatchObject({ view: "exercise", statementMd: "Prove $x$.", hints: [], grade: null, canReveal: false, busy: null });
  // M68: without a difficulty the exercise gets the student's target (nothing answered: 2), and its stars for them
  expect(sc<ExerciseData>(await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "Prove $y$.", referenceSolutionMd: "r", edgeCaseFocus: [] }))).toMatchObject({ difficulty: 2, stars: 3 });
  expect(JSON.stringify(card.structuredContent)).not.toContain("ref"); // the reference solution stays on the server
  const runId = ex.runId;

  // answer the job the card started (as the host model does)
  async function answer(input?: object, textAnswer?: string) {
    const job = await call("shalav_next_job");
    const id = Number(/# Shalav job #(\d+)/.exec(text(job))?.[1]);
    expect(id).toBeGreaterThan(0);
    return { job, res: await call("shalav_submit_job", { jobId: id, ...(input ? { input } : { text: textAnswer }) }) };
  }

  // hints: levels 1-3, a fourth is refused
  for (const level of [1, 2, 3]) {
    expect(sc<ExerciseData>(await call("exercise_hint_request", { runId, files: [] })).busy).toBe("hint");
    const { job, res } = await answer({ hintMd: `hint ${level}`, level, targetsStep: "s" });
    expect(text(job)).toContain(`level ${level}`);
    expect(text(res)).toContain("hint is shown");
  }
  expect((await call("exercise_hint_request", { runId, files: [] })).isError).toBe(true);
  expect(sc<ExerciseData>(await call("exercise_state", { runId }))).toMatchObject({ busy: null, canReveal: true, hints: [{ level: 1 }, { level: 2 }, { level: 3 }] });
  expect((await events()).filter((e) => e.type === "hint_requested").map((e) => (e as { level: number }).level)).toEqual([1, 2, 3]);

  // upload a photo, grade it through the bridge
  const png = createCanvas(40, 30).toBuffer("image/png").toString("base64");
  const up = sc<{ files: { sha256: string; mediaType: string }[] }>(await call("attachment_upload_chunk", { number: n, id: "w1", name: "w.png", mime: "image/png", index: 0, total: 1, data: png }));
  expect(up.files).toHaveLength(1);
  expect((await call("attachment_upload_chunk", { number: n, id: "w2", name: "w.txt", mime: "text/plain", index: 0, total: 1, data: "aGk=" })).isError).toBe(true);
  expect((await call("exercise_grade_request", { runId, files: [] })).isError).toBe(true);
  await call("exercise_grade_request", { runId, files: up.files });
  const { job, res } = await answer(grade);
  expect(JSON.stringify((job.content as { type: string }[]).map((c) => c.type))).toContain("image"); // the solution page goes to the host model
  expect(text(res)).toContain("Graded");
  expect(text(res)).toContain("update_assessment");
  const st = sc<ExerciseData>(await call("exercise_state", { runId }));
  expect(st.grade).toMatchObject({ verdict: "partially_correct", score: 70 });
  const ev = await events();
  expect(ev.filter((e) => e.type === "attempt_graded")).toMatchObject([{ verdict: "partially_correct", score: 70, hintsUsed: 3, context: "learn", attachmentHashes: [up.files[0]?.sha256] }]);
  expect(ev.filter((e) => e.type === "mistake_tag_defined")).toHaveLength(1);
  // the grade is saved in the lesson's conversation
  const lesson = sc<{ items: { id: string }[] }>(await call("history_list", { number: n, kind: "lesson" })).items[0];
  expect((await loadConv(n, lesson?.id ?? ""))?.entries.find((e) => e.kind === "grade")).toMatchObject({ who: "tutor", text: expect.stringMatching(/^Graded 70 \(partially_correct\)/) });

  // solution: the model-written solution is cached; reveal is an event
  await call("exercise_solution_request", { runId });
  expect(text(await call("shalav_next_job"))).toContain("No Shalav job"); // the reference solution exists: no job is parked
  expect(sc<ExerciseData>(await call("exercise_state", { runId }))).toMatchObject({ solutionMd: "ref", busy: null });
  expect((await events()).filter((e) => e.type === "solution_revealed")).toHaveLength(1);

  expect(sc<ExerciseData>(await call("exercise_retry", { runId })).grade).toBeNull();
  expect((await call("exercise_state", { runId: "gone" })).isError).toBe(true);
  expect(sc<LessonData>(await call("lesson_state", { number: n, stageId: "S001" })).view).toBe("lesson");

  // M56 solving loop: a hard exercise of an advanced stage (S002 is a technique) opens with clues instead of hints
  expect(sc<ExerciseData>(await call("assign_exercise", { stageIds: ["S001"], source: "new", statementMd: "q", difficulty: 4, edgeCaseFocus: [] })).loop).toBe(false); // an intro stage keeps the hints
  const lp = sc<ExerciseData>(await call("assign_exercise", { stageIds: ["S002"], source: "new", statementMd: "Hard $y$.", referenceSolutionMd: "ref2", difficulty: 4, edgeCaseFocus: [] }));
  expect(lp).toMatchObject({ loop: true, clues: [], clueOpen: false, perfect: false });
  const r = lp.runId;
  expect((await call("exercise_clarify_request", { runId: r })).isError).toBe(true); // nothing to explain yet
  expect(sc<ExerciseData>(await call("exercise_clue_request", { runId: r, files: up.files })).busy).toBe("clue");
  let j = await answer({ onTrack: true, clueMd: "think of N" });
  expect(text(j.job)).toContain("ONE small clue");
  expect(text(j.job)).toContain("image"); // the work so far is checked
  for (const m of ["say it simpler", "simplest"]) {
    await call("exercise_clarify_request", { runId: r });
    j = await answer({ onTrack: true, clueMd: m });
    expect(text(j.job)).toContain("think of N");
  }
  expect(sc<ExerciseData>(await call("exercise_state", { runId: r }))).toMatchObject({ clueOpen: true, clues: [{ onTrack: true, clueMd: "think of N", more: ["say it simpler", "simplest"] }] });
  expect(sc<ExerciseData>(await call("exercise_clue_done", { runId: r }))).toMatchObject({ clueOpen: false });
  // 96 with a wrong final answer is not perfect; 95 (not over 95) is not either; 96 with every final answer right is
  for (const [score, finalAnswerCorrect, ok] of [[96, false, false], [95, true, false], [96, true, true]] as const) {
    await call("exercise_grade_request", { runId: r, files: up.files });
    j = await answer({ ...grade, verdict: "correct", score, finalAnswerCorrect, mistakes: [], stageIds: ["S002"] });
    expect(text(j.job)).toContain("finalAnswerCorrect");
    expect(sc<ExerciseData>(await call("exercise_state", { runId: r })).perfect).toBe(ok);
  }
});

// a PDF with n pages of different widths (distinct page images, so the order is visible in the shas); no xref, as in node.test.ts
const pdf = (n: number) => {
  const o = ["1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj", `2 0 obj<</Type/Pages/Kids[${Array.from({ length: n }, (_, i) => `${i + 3} 0 R`).join(" ")}]/Count ${n}>>endobj`];
  for (let i = 0; i < n; i++) o.push(`${i + 3} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${200 + 40 * i} 100]>>endobj`);
  return Buffer.from(`%PDF-1.4\n${o.join("\n")}\ntrailer<</Root 1 0 R/Size ${n + 3}>>\n%%EOF`, "latin1");
};

it("U3: answer files in chunks are stored exactly like a direct save; bad chunks and failures leave no temp dir", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  const tmp = join(d, "tmp"); // own temp dir (os.tmpdir() reads TMPDIR on each call; vitest runs files in forks)
  await mkdir(tmp);
  const oldTmp = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([createServer().connect(a), client.connect(b)]);
    const n = "01040195";
    const send = (id: string, name: string, mime: string, parts: Buffer[], order = parts.map((_, i) => i)) =>
      order.reduce<Promise<{ isError?: boolean; structuredContent?: unknown }>>(
        async (prev, i) => {
          const r = await prev;
          return r.isError ? r : client.callTool({ name: "attachment_upload_chunk", arguments: { number: n, id, name, mime, index: i, total: parts.length, data: (parts[i] as Buffer).toString("base64") } });
        },
        Promise.resolve({}),
      );
    const split3 = (buf: Buffer) => ((k) => [buf.subarray(0, k), buf.subarray(k, 2 * k), buf.subarray(2 * k)])(Math.ceil(buf.length / 3)); // three non-empty parts

    expect((await client.listTools()).tools.find((t) => t.name === "attachment_upload_chunk")?._meta).toMatchObject({ ui: { visibility: ["app"] } });
    expect((await client.listTools()).tools.some((t) => t.name === "attachment_upload")).toBe(false);

    // a JPEG in 3 chunks = the same stored image as a direct save of the same bytes
    const c = createCanvas(400, 300);
    const g = c.getContext("2d");
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `hsl(${i},80%,50%)`;
      g.fillRect(i, i % 200, 90, 40);
    }
    const jpg = c.toBuffer("image/jpeg");
    const up = await send("u1", "photo.jpg", "image/jpeg", split3(jpg));
    expect(up.isError).toBeFalsy();
    const direct = await saveAttachment(n, new File([new Uint8Array(jpg)], "photo.jpg", { type: "image/jpeg" }));
    expect((up.structuredContent as { done: boolean; files: unknown[] }).files).toEqual([{ sha256: direct.sha256, mediaType: "image/jpeg" }]);

    // a 2-page PDF in 3 chunks: the same page images in the same order as a direct save
    const two = pdf(2);
    const pages = await send("u2", "hw.pdf", "application/pdf", split3(two));
    const want = (await saveAnswerFile(n, new File([new Uint8Array(two)], "hw.pdf", { type: "application/pdf" }))).map((x) => ({ sha256: x.sha256, mediaType: x.mediaType }));
    expect(want).toHaveLength(2);
    expect(new Set(want.map((x) => x.sha256)).size).toBe(2);
    expect((pages.structuredContent as { files: unknown[] }).files).toEqual(want);

    // two uploads with the same name at once (different ids) do not collide
    const [p, q] = [split3(jpg), split3(jpg)];
    const call = (id: string, i: number, parts: Buffer[]) => client.callTool({ name: "attachment_upload_chunk", arguments: { number: n, id, name: "same.jpg", mime: "image/jpeg", index: i, total: 3, data: (parts[i] as Buffer).toString("base64") } });
    for (const i of [0, 1, 2]) {
      const [x, y] = await Promise.all([call("A", i, p), call("B", i, q)]);
      expect(x.isError || y.isError).toBeFalsy();
      if (i === 2) expect(x.structuredContent).toEqual(y.structuredContent);
    }

    // out of order: refused, and its temp dir is gone
    const bad = await send("u3", "x.jpg", "image/jpeg", split3(jpg), [0, 2]);
    expect(bad.isError).toBe(true);
    expect(JSON.stringify((bad as { content?: unknown }).content)).toContain("out of order");
    // a chunk after the refusal is out of order too (the upload was dropped)
    expect((await client.callTool({ name: "attachment_upload_chunk", arguments: { number: n, id: "u3", name: "x.jpg", mime: "image/jpeg", index: 1, total: 3, data: "AA==" } })).isError).toBe(true);

    // a PDF over 12 pages fails with the same key as before, and leaves nothing behind
    const big = await send("u4", "big.pdf", "application/pdf", split3(pdf(13)));
    expect(big.isError).toBe(true);
    expect(JSON.stringify((big as { content?: unknown }).content)).toContain("grade.tooManyPages");

    // wrong type: refused before any temp dir exists
    expect((await send("u5", "w.txt", "text/plain", [Buffer.from("hi")])).isError).toBe(true);
    // more than 15 chunks: refused by the schema
    expect((await client.callTool({ name: "attachment_upload_chunk", arguments: { number: n, id: "u6", name: "a.pdf", mime: "application/pdf", index: 0, total: 16, data: "AA==" } })).isError).toBe(true);

    expect(await readdir(tmp)).toEqual([]); // every exit path removed its temp dir
  } finally {
    if (oldTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = oldTmp;
  }
});
