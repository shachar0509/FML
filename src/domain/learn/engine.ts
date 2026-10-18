import { statusBlock, tutorSystem } from "@/claude/prompts/tutor";
import { BLOCKING, TUTOR_TOOLS, consultMaterials, presentMcq, recordCheckResult, updateAssessment } from "@/claude/tutorTools";
import { textOf, toolUses, type ClaudeGateway, type ToolUseBlock } from "@/claude/types";
import { buildKnowledgeBoundary } from "@/domain/boundary/boundary";
import { CourseJsonSchema, EventSchema, PlanJsonSchema, type CourseJson, type Event, type PlanJson, type ProgressJson, type SessionLine, type StoredBlock } from "@/domain/dataSchemas";
import { listFileIndexes } from "@/domain/ingest/indexStore";
import { checkAdvanceCriteria } from "@/domain/progress/criteria";
import { normalizeTag, reduceProgress } from "@/domain/progress/reduce";
import { appendEvent } from "@/domain/progress/store";
import { consult, getLessonBrief } from "@/domain/retrieval/retrieve";
import { readJsonFile } from "@/lib/fs/atomicWrite";
import { readJsonlDir } from "@/lib/fs/jsonl";
import { coursePaths } from "@/lib/fs/paths";
import { nowIso } from "@/lib/time";
import { useSettings } from "@/stores/settings";
import { buildMessages, compactIfNeeded, resumePrefix, type LoadImage } from "./context";
import { appendLine, lastActivityTs, loadSession } from "./session";

/** Recorded outcome of one tool_use (stored in a `ui` line whose widgetId is the tool_use id). */
export type ToolState = { content: string; ephemeral?: boolean; stub?: string; is_error?: boolean; images?: StoredBlock[] };
export type Attachment = Extract<StoredBlock, { type: "image_ref" }>;
export type Env = { gw: ClaudeGateway; loadImage: LoadImage };

const CONTROL = /^\[(START_LESSON|RECAP|REOPENED|RESUME)/;
export const isControl = (b: StoredBlock) => b.type === "text" && CONTROL.test(b.text);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** One Learn session (6.2-6.7). The UI subscribes and renders `lines`, `streaming`, `busy`. */
export class Lesson {
  lines: SessionLine[] = [];
  plan!: PlanJson;
  course!: CourseJson;
  progress!: ProgressJson;
  events: Event[] = [];
  streaming = "";
  busy = false;
  consulting = false;
  error: string | null = null;
  criteria: { met: boolean; missing: string[] } | null = null;
  private system?: string;
  private ac?: AbortController;
  private subs = new Set<() => void>();

  constructor(readonly courseNumber: string, readonly stageId: string, private env: Env) {}

  subscribe = (f: () => void) => (this.subs.add(f), () => void this.subs.delete(f));
  private emit() {
    this.subs.forEach((f) => f());
  }
  private get lang() {
    return useSettings.getState().settings.language;
  }
  private get langName() {
    return this.lang === "he" ? ("Hebrew" as const) : ("English" as const);
  }
  get stage() {
    return this.plan.stages.find((s) => s.id === this.stageId) as PlanJson["stages"][number];
  }
  get status() {
    return this.progress.stages[this.stageId]?.status;
  }
  get readOnly() {
    return this.status === "completed" || this.status === "completed_override";
  }

  private async refresh() {
    const p = coursePaths(useSettings.getState().settings.dataRoot, this.courseNumber);
    const [course, plan] = await Promise.all([readJsonFile(p.courseJson, CourseJsonSchema), readJsonFile(p.planJson, PlanJsonSchema)]);
    if (!course || !plan) throw new Error("course not found");
    this.course = course;
    this.plan = plan;
    this.events = await readJsonlDir(p.events, EventSchema);
    this.progress = reduceProgress(plan, this.events, nowIso());
    this.lines = await loadSession(this.courseNumber, this.stageId);
  }

  /** Load the transcript. Never calls the API on its own; a brand new session starts the lesson (6.2). */
  async open() {
    await this.refresh();
    if (!this.lines.some((l) => l.kind === "message")) {
      if (this.readOnly) return this.emit();
      await appendEvent(this.courseNumber, { type: "stage_started", stageId: this.stageId });
      await this.sendUser([{ type: "text", text: "[START_LESSON]" }]);
    } else {
      // crash between the last widget answer and the follow-up request: finish it
      const t = this.unresolved();
      if (t && t.every((u) => this.stateOf(u.id))) await this.flush();
      else this.emit();
    }
  }

  private messages() {
    return this.lines.filter((l): l is Extract<SessionLine, { kind: "message" }> => l.kind === "message");
  }
  stateOf(id: string): ToolState | undefined {
    const l = this.lines.find((x) => x.kind === "ui" && x.widgetId === id);
    return l?.kind === "ui" ? (l.state as ToolState) : undefined;
  }
  /** tool_use blocks of the last assistant turn while no user message follows it. */
  private unresolved(): ToolUseBlock[] | null {
    const last = this.messages().at(-1);
    if (last?.role !== "assistant") return null;
    const u = last.content.filter((b) => b.type === "tool_use") as ToolUseBlock[];
    return u.length ? u : null;
  }
  /** Blocking widgets waiting for the student. */
  pending(): ToolUseBlock[] {
    return (this.unresolved() ?? []).filter((u) => BLOCKING.has(u.name) && !this.stateOf(u.id));
  }
  /** Last message is the student's: a request failed or was interrupted. */
  get needsRetry() {
    return this.messages().at(-1)?.role === "user" && !this.busy;
  }

  private async add(line: Parameters<typeof appendLine>[2]) {
    this.lines = [...this.lines, await appendLine(this.courseNumber, this.stageId, line)];
    this.emit();
  }
  private async setState(id: string, state: ToolState) {
    await this.add({ kind: "ui", widgetId: id, state });
  }

  // ----- student actions -----

  /** Chat message (also chips). Open blocking widgets are answered as interjected (6.5). */
  async send(text: string, images: Attachment[] = []) {
    if (this.busy) return;
    for (const u of this.pending()) await this.setState(u.id, { content: JSON.stringify({ answered: false, studentInterjected: true }) });
    const msg: StoredBlock[] = [{ type: "text", text }, ...images];
    if (this.unresolved()) await this.flush(msg); // results of the open turn + the student's text in one message
    else await this.sendUser(msg);
  }
  async recap() {
    await this.send("[RECAP]");
  }
  async answerMcq(id: string, selectedIndex: number) {
    const u = this.pending().find((x) => x.id === id);
    if (!u) return;
    const input = presentMcq.schema.parse(u.input);
    const correct = selectedIndex === input.correctIndex;
    await this.setState(id, { content: JSON.stringify({ selectedIndex, correct }) });
    await appendEvent(this.courseNumber, {
      type: "check_answered", stageId: this.stageId, checkId: id, kind: "mcq", context: "learn", correct, score: correct ? 100 : 0, mistakeTags: [],
    });
    if (!this.pending().length) await this.flush();
  }
  async answerOpen(id: string, answerText: string, images: Attachment[] = []) {
    if (!this.pending().some((x) => x.id === id)) return;
    await this.setState(id, { content: JSON.stringify({ answerText }), images });
    if (!this.pending().length) await this.flush();
  }
  /** Step 10 adds grading; until then an exercise can only be skipped. */
  async skipExercise(id: string) {
    if (!this.pending().some((x) => x.id === id)) return;
    await this.setState(id, { content: JSON.stringify({ skipped: true }) });
    if (!this.pending().length) await this.flush();
  }
  stop() {
    this.ac?.abort();
  }
  async retry() {
    if (this.needsRetry) await this.run();
  }

  /** 8.3: `mastery` needs the criteria; `user_override` is the confirmed "Advance anyway". */
  async complete(by: "mastery" | "user_override") {
    await this.refresh();
    await appendEvent(this.courseNumber, {
      type: "stage_completed", stageId: this.stageId, by, masteryAtCompletion: this.progress.stages[this.stageId]?.mastery ?? 0,
    });
    await this.refresh();
    this.emit();
  }
  async reopen() {
    await appendEvent(this.courseNumber, { type: "stage_reopened", stageId: this.stageId });
    await this.refresh();
    await this.sendUser([{ type: "text", text: "[REOPENED: the student chose to relearn this stage; focus on the recorded gaps and review topics]" }]);
  }

  // ----- request loop -----

  private async sendUser(content: StoredBlock[]) {
    const idle = lastActivityTs(this.lines);
    const hidden = content.some(isControl) ? null : resumePrefix(idle, nowIso());
    await this.add({ kind: "message", role: "user", content });
    await this.run(hidden);
  }

  /** Answers of the previous assistant turn -> one user message of tool_results (+ attachments). */
  private async flush(more: StoredBlock[] = []) {
    const uses = this.unresolved() ?? [];
    const content: StoredBlock[] = [];
    const extra: StoredBlock[] = [];
    for (const u of uses) {
      const s = this.stateOf(u.id) as ToolState;
      content.push({ type: "tool_result", tool_use_id: u.id, content: s.content, is_error: s.is_error, ephemeral: s.ephemeral, stub: s.stub });
      extra.push(...(s.images ?? []));
    }
    await this.sendUser([...content, ...extra, ...more]);
  }

  private async ensureSystem(signal: AbortSignal) {
    if (this.system) return this.system;
    const lang = this.langName;
    const brief = await getLessonBrief(
      { gw: this.env.gw, signal },
      { course: this.course, plan: this.plan, stageId: this.stageId, lang },
    );
    const exercises = (await listFileIndexes(this.courseNumber))
      .flatMap((f) => f.exercises)
      .filter((e) => e.primaryStageId === this.stageId || e.requiredStageIds.includes(this.stageId));
    this.system = tutorSystem({
      course: this.course,
      courseKind: this.course.courseKind,
      stage: this.stage,
      plan: this.plan,
      minExercises: useSettings.getState().settings.learning.minExercises,
      lang,
      knowledgeBoundary: buildKnowledgeBoundary({ course: this.course, plan: this.plan, progress: this.progress, currentStageId: this.stageId }),
      lessonBrief: brief.briefMd,
      exercises,
      mistakeTags: this.progress.mistakes,
    });
    return this.system;
  }

  private status_(): string {
    const sp = this.progress.stages[this.stageId];
    const learning = useSettings.getState().settings.learning;
    const now = nowIso();
    const { missing } = checkAdvanceCriteria({ plan: this.plan, events: this.events, stageId: this.stageId, cfg: learning, lang: this.lang, now });
    const last = lastActivityTs(this.lines);
    return statusBlock({
      completed: this.progress.totals.stagesCompleted,
      total: this.progress.totals.stagesTotal,
      mastery: Math.round((sp?.tutorMastery ?? 0) * 100) / 100,
      covered: sp?.coveredObjectives ?? [],
      gaps: sp?.gaps ?? [],
      reviewTopics: sp?.reviewTopics ?? [],
      missing,
      overriddenPrereqs: this.stage.prerequisites.filter((p) => this.progress.stages[p]?.status === "completed_override"),
      mistakes: this.progress.mistakes
        .filter((m) => !m.resolved && m.stageIds.includes(this.stageId))
        .slice(0, 8)
        .map((m) => `${m.tag} — ${this.lang === "he" ? m.labelHe : m.labelEn}`),
      idleMinutes: last ? Math.max(0, Math.round((Date.parse(now) - Date.parse(last)) / 60000)) : 0,
    });
  }

  private async run(hidden: string | null = null) {
    this.busy = true;
    this.error = null;
    this.streaming = "";
    this.ac = new AbortController();
    const signal = this.ac.signal;
    this.emit();
    try {
      for (;;) {
        await this.refresh();
        const system = await this.ensureSystem(signal);
        await compactIfNeeded({ gw: this.env.gw, course: this.courseNumber, stageId: this.stageId, lines: this.lines, lang: this.langName }).catch(() => null);
        this.lines = await loadSession(this.courseNumber, this.stageId);
        const messages = await buildMessages({ lines: this.lines, statusText: this.status_(), hiddenPrefix: hidden, loadImage: this.env.loadImage });
        hidden = null;
        this.streaming = "";
        const res = await this.env.gw.send({
          task: "tutor", courseNumber: this.courseNumber, system, messages, tools: TUTOR_TOOLS,
          cacheConversation: true, priority: true, signal, onText: (d) => ((this.streaming += d), this.emit()),
        });
        const content = res.content.flatMap((b): StoredBlock[] =>
          b.type === "text" ? [{ type: "text", text: String((b as { text: string }).text) }] : b.type === "tool_use" ? [b as ToolUseBlock] : [],
        );
        this.streaming = "";
        await this.add({ kind: "message", role: "assistant", content: content.length ? content : [{ type: "text", text: textOf(res) || "…" }] });
        const uses = toolUses(res);
        if (!uses.length) break;
        for (const u of uses) if (!BLOCKING.has(u.name)) await this.setState(u.id, await this.handle(u, signal));
        if (uses.some((u) => BLOCKING.has(u.name))) break; // wait for the student
        const results: StoredBlock[] = [];
        for (const u of uses) {
          const s = this.stateOf(u.id) as ToolState;
          results.push({ type: "tool_result", tool_use_id: u.id, content: s.content, is_error: s.is_error, ephemeral: s.ephemeral, stub: s.stub });
        }
        await this.add({ kind: "message", role: "user", content: results });
      }
    } catch (e) {
      if (signal.aborted) {
        await this.add({ kind: "message", role: "assistant", content: [{ type: "text", text: `${this.streaming}\n\n[stopped]`.trim() }] });
      } else this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
      this.consulting = false;
      this.streaming = "";
      this.emit();
    }
  }

  // ----- non-blocking tools (6.5) -----

  private async handle(u: ToolUseBlock, signal: AbortSignal): Promise<ToolState> {
    const ok = (v: unknown, extra: Partial<ToolState> = {}): ToolState => ({ content: JSON.stringify(v), ...extra });
    try {
      if (u.name === recordCheckResult.def.name) return ok(await this.recordCheck(recordCheckResult.schema.parse(u.input)));
      if (u.name === updateAssessment.def.name) return ok(await this.assess(updateAssessment.schema.parse(u.input)));
      if (u.name === consultMaterials.def.name) {
        const i = consultMaterials.schema.parse(u.input);
        this.consulting = true;
        this.emit();
        const r = await consult(
          { gw: this.env.gw, signal },
          { course: this.course, plan: this.plan, progress: this.progress, stageId: this.stageId, question: i.question, purpose: i.purpose, lang: this.langName, webSearch: useSettings.getState().settings.retrieval.webSearch },
        );
        this.consulting = false;
        const stub = `[Course materials consulted: ${clip(i.question, 80)}${r.sources.length ? ` (${clip(r.sources.join("; "), 80)})` : ""}]`;
        return ok({ answerMd: r.answerMd, coverage: r.coverage, sources: r.sources }, { ephemeral: true, stub });
      }
      return { content: `Unknown tool ${u.name}`, is_error: true };
    } catch (e) {
      if (signal.aborted) throw e;
      return { content: `Tool failed: ${e instanceof Error ? e.message : String(e)}`, is_error: true };
    }
  }

  private async defineTags(tags: { tag: string; labelHe: string; labelEn: string; description: string }[]) {
    const known = new Set(this.events.flatMap((e) => (e.type === "mistake_tag_defined" ? [e.tag] : [])));
    const out: string[] = [];
    for (const t of tags) {
      const tag = normalizeTag(t.tag);
      if (!known.has(tag)) {
        known.add(tag);
        await appendEvent(this.courseNumber, { type: "mistake_tag_defined", tag, labelHe: t.labelHe, labelEn: t.labelEn, description: t.description });
      }
      out.push(tag);
    }
    return out;
  }

  private async recordCheck(i: ReturnType<typeof recordCheckResult.schema.parse>) {
    const tags = await this.defineTags(i.mistakes);
    const ref = this.messages().flatMap((m) => m.content).find((b) => b.type === "tool_use" && b.id === i.checkToolUseId);
    const name = ref?.type === "tool_use" ? ref.name : null;
    if (name === presentMcq.def.name) {
      for (const tag of tags) await appendEvent(this.courseNumber, { type: "mistake_observed", tag, stageIds: [this.stageId], refId: i.checkToolUseId, context: "learn" });
    } else {
      await appendEvent(this.courseNumber, {
        type: "check_answered", stageId: this.stageId, checkId: i.checkToolUseId, kind: "open", context: "learn",
        correct: i.correct, score: i.score, mistakeTags: tags,
      });
    }
    return { ok: true };
  }

  private async assess(i: ReturnType<typeof updateAssessment.schema.parse>) {
    await appendEvent(this.courseNumber, {
      type: "assessment_updated", stageId: this.stageId, mastery: i.mastery, coveredObjectives: i.coveredObjectives,
      gaps: i.gaps, reviewTopics: i.reviewTopics, readyToAdvance: i.readyToAdvance, rationale: i.rationale,
    });
    await this.refresh();
    const c = checkAdvanceCriteria({
      plan: this.plan, events: this.events, stageId: this.stageId, cfg: useSettings.getState().settings.learning, lang: this.lang, now: nowIso(),
    });
    this.criteria = c;
    return { ok: true, advanceCriteriaMet: c.met, missing: c.missing };
  }
}
