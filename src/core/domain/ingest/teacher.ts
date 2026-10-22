import { callStructured } from "@/core/claude/structured";
import { teacherPrompt } from "@/core/claude/prompts/index";
import { submitTeacherNotes } from "@/core/claude/tools";
import { EventSchema, type FileIndex, type PlanJson, type TeacherItem } from "@/core/domain/dataSchemas";
import { courseGraph, listText } from "@/core/domain/knowledge/tag";
import { nodeId, stageOf } from "@/core/domain/knowledge/graph";
import { normalizeTag } from "@/core/domain/progress/reduce";
import { appendEvent } from "@/core/domain/progress/store";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { finish, type IndexOpts, PARALLEL, pageBlocks, planCompact, pool, range, RECORD_CHARS, slices } from "./index";

/**
 * M71: teacher's notes (graded work, rubrics, remarks). Graded pages show the STUDENT's answers, which are never truth:
 * no exercise extraction, no solution patterns, and the stored page text is only what the teacher wrote (the model's
 * `text`, never the raw page), so lessons, graders, generation and the exam pool never see the student's work.
 */
const TEACHER_BATCH = 6;
/** ponytail: every node numbered once for the whole file (graded work may touch any stage); a huge graph is cut here */
const MAX_NODES = 300;

const eventsOf = (n: string) => readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema);

export async function indexTeacher(o: IndexOpts): Promise<FileIndex> {
  const { gw, source, rec, plan, course, lang } = o;
  const events = await eventsOf(course.courseNumber);
  const nodes = courseGraph(plan, events).nodes.slice(0, MAX_NODES); // one list shared by every batch: numbers map back through it
  const tags = [...new Map(events.flatMap((e) => (e.type === "mistake_tag_defined" ? [[e.tag, `${e.tag} — ${e.labelEn}`] as const] : []))).values()].join("\n");
  const known = new Set(plan.stages.map((s) => s.id));
  const stages = (xs: string[]) => xs.filter((s) => known.has(s));
  const batches = slices(range(source.pageCount), TEACHER_BATCH, TEACHER_BATCH);
  const system = teacherPrompt(course, planCompact(plan), listText(nodes), tags, lang === "he" ? "Hebrew" : "English");
  let done = 0;
  const replies = await pool(batches, PARALLEL, async (batch) => {
    const r = await callStructured(gw, submitTeacherNotes, {
      task: "index", courseNumber: course.courseNumber, system, messages: [{ role: "user", content: await pageBlocks(source, batch, "teacher") }], signal: o.signal,
    });
    o.onProgress?.(++done, batches.length);
    return r;
  });

  let model = "";
  const materialPages: FileIndex["materialPages"] = [];
  const teacherItems: TeacherItem[] = [];
  const idOf = (n: number | null) => (n ? (nodes[n - 1]?.id ?? null) : null);
  for (const [i, { value, response }] of replies.entries()) {
    model = response.model;
    for (const p of batches[i] as number[]) {
      const r = value.pages.find((x) => x.page === p);
      materialPages.push({ page: p, stageIds: stages(r?.stageIds ?? []), summary: r?.summary ?? "", notes: [], hasFigure: false, text: (r?.text ?? "").slice(0, RECORD_CHARS), kind: r?.kind ?? "graded_work" });
    }
    for (const x of value.items) {
      teacherItems.push({
        id: `${rec.sha256.slice(0, 8)}-t${teacherItems.length + 1}`, page: x.page, type: x.type, rule: x.rule, quote: x.quote, points: x.points, exercise: x.exercise,
        when: x.when, level: x.level, answerForms: x.answerForms, questionTypes: x.questionTypes, stageIds: stages(x.stageIds),
        nodes: x.nodeResults.flatMap((r) => { const id = idOf(r.n); return id ? [{ id, score: r.score }] : []; }),
        concerns: x.type === "deduction" ? idOf(x.concerns) : null,
        mistake: x.type === "deduction" ? x.mistake : null,
      });
    }
  }
  return finish(o, model, { materialPages, exercises: [], patterns: undefined, teacherItems });
}

/**
 * Graded work is the strongest evidence (weight 2 in control.ts), written once per file sha (an edited file is a new sha;
 * the log is append-only, so the old file's evidence stays). A deduction is a mistake; the same mistake tag in two or more
 * works (or a graded work and other answers) becomes a misconception node, linked to the concept it concerns, and every
 * later repeat lowers its control.
 */
export async function teacherEvidence(n: string, plan: PlanJson, rec: FileIndex, lang: "he" | "en"): Promise<void> {
  const items = rec.teacherItems ?? [];
  if (!items.length) return;
  const sha = rec.sha256;
  const events = await eventsOf(n);
  if (events.some((e) => "refId" in e && e.refId === sha)) return;
  const ids = new Set(courseGraph(plan, events).nodes.map((x) => x.id));
  const known = new Set(plan.stages.map((s) => s.id));

  const per = new Map<string, number[]>();
  for (const it of items) for (const x of it.nodes) per.set(x.id, [...(per.get(x.id) ?? []), x.score]);
  for (const [id, s] of per)
    if (ids.has(id)) await appendEvent(n, { type: "node_observed", nodeId: id, score: s.reduce((a, b) => a + b, 0) / s.length, why: "graded by the teacher", context: "teacher", refId: sha });

  const defined = new Set(events.flatMap((e) => (e.type === "mistake_tag_defined" ? [e.tag] : [])));
  const refs = new Map<string, Set<string>>(); // mistake tag → the works and answers it was seen in
  const see = (tag: string, ref: string) => refs.set(tag, (refs.get(tag) ?? new Set()).add(ref));
  for (const e of events) {
    if (e.type === "mistake_observed") see(e.tag, e.refId);
    else if (e.type === "attempt_graded") e.mistakes.forEach((m) => see(m.tag, e.attemptId));
    else if (e.type === "check_answered") e.mistakeTags.forEach((t) => see(t, e.checkId));
  }
  const done = new Set<string>();
  for (const it of items) {
    if (it.type !== "deduction" || !it.mistake) continue;
    const tag = normalizeTag(it.mistake.tag);
    if (!tag || done.has(tag)) continue;
    done.add(tag);
    const own = it.stageIds.filter((s) => known.has(s));
    const at = it.concerns ? stageOf(it.concerns) : null;
    const st = own.length ? own : at && known.has(at) ? [at] : [];
    if (!defined.has(tag)) await appendEvent(n, { type: "mistake_tag_defined", tag, labelHe: it.mistake.labelHe, labelEn: it.mistake.labelEn, description: it.mistake.description });
    await appendEvent(n, { type: "mistake_observed", tag, stageIds: st, refId: sha, context: "teacher" });
    see(tag, sha);
    const seen = refs.get(tag)?.size ?? 0;
    if (seen < 2) continue;
    const mid = nodeId(null, "misconception", tag);
    if (!ids.has(mid)) {
      const label = (lang === "he" ? it.mistake.labelHe : it.mistake.labelEn).trim().slice(0, 80) || tag;
      await appendEvent(n, { type: "node_added", nodeId: mid, kind: "misconception", label, why: `The teacher took points off for this again (${seen} works or answers): ${it.quote}`.slice(0, 300), stageIds: st, requires: [], origin: "teacher", refId: sha });
      ids.add(mid);
      if (it.concerns && ids.has(it.concerns)) await appendEvent(n, { type: "node_linked", from: mid, to: it.concerns, rel: "misconception_of" });
    }
    await appendEvent(n, { type: "node_observed", nodeId: mid, score: 0, why: it.quote.slice(0, 300), context: "teacher", refId: sha });
  }
}
