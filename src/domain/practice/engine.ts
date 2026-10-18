import type { CheckGrade, CheckItem } from "@/claude/practiceTools";
import { getDeviceId } from "@/lib/device";
import { appendJsonl, readJsonl } from "@/lib/fs/jsonl";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { appendEvent } from "@/domain/progress/store";
import { SessionLineSchema } from "@/domain/dataSchemas";
import type { ExerciseRef } from "@/domain/dataSchemas";
import { allExercises, fromExercise, loadCtx, paths, type Ctx, type Ex } from "./exercises";
import { chooseFocus, generateChecks, generateExercise } from "./generate";
import { gradeCheck, type Attachment, type Env } from "./grade";
import { emptyRun, ExerciseRun, type RunState } from "./run";
import { completedIds, itemKind, pick, type Scope } from "./select";

export type Check = CheckItem & { id: string };
export type Item =
  | { kind: "E"; ref: ExerciseRef; run: RunState }
  | { kind: "M"; check: Check; selected: number | null }
  | { kind: "O"; check: Check; answer: string | null; result: CheckGrade | null };
export type Result = { kind: "E" | "M" | "O"; score: number; correct: boolean; stageIds: string[]; tags: string[] };
export type PState = {
  sid: string; scope: Scope; startedAt: string; endedAt: string | null; index: number; served: string[];
  current: Item | null; next: Item | null; queue: Check[]; queueKey: string; results: Result[];
};
export type Summary = { items: number; avgScore: number; newMistakes: string[]; weakStages: { id: string; title: string }[] };

const WIDGET = "state";
const WEAK = 0.75;

/** Practice session controller (7.1-7.9). State survives restarts as `ui` lines in sessions/practice/<deviceId>.jsonl. */
export class Practice {
  state: PState | null = null;
  ctx!: Ctx;
  run: ExerciseRun | null = null;
  loading = false;
  error: string | null = null;
  summary: Summary | null = null;
  private subs = new Set<() => void>();
  private prefetching: Promise<void> | null = null;
  private ac = new AbortController();

  constructor(readonly courseNumber: string, private env: Omit<Env, "signal">) {}
  subscribe = (f: () => void) => (this.subs.add(f), () => void this.subs.delete(f));
  private emit() {
    this.subs.forEach((f) => f());
  }
  private get e(): Env {
    return { ...this.env, signal: this.ac.signal };
  }
  private file() {
    return paths(this.courseNumber).practiceSessionFile(getDeviceId());
  }
  private async persist() {
    if (!this.state) return;
    await appendJsonl(this.file(), { kind: "ui", id: newId(), ts: nowIso(), deviceId: getDeviceId(), widgetId: WIDGET, state: this.state });
  }
  private async set(patch: Partial<PState>) {
    this.state = { ...(this.state as PState), ...patch };
    await this.persist();
    this.emit();
  }
  close() {
    this.ac.abort();
  }

  get counters() {
    const r = this.state?.results ?? [];
    return { answered: r.length, correct: r.filter((x) => x.correct).length, avg: r.length ? Math.round(r.reduce((a, x) => a + x.score, 0) / r.length) : 0 };
  }
  /** Units with ≥1 completed stage and completed stages, for the scope pickers. */
  get completed() {
    return completedIds(this.ctx.progress);
  }

  async open() {
    this.ctx = await loadCtx(this.courseNumber);
    const lines = await readJsonl(this.file(), SessionLineSchema);
    const last = lines.findLast((l) => l.kind === "ui" && l.widgetId === WIDGET);
    const st = last?.kind === "ui" ? (last.state as PState) : null;
    this.state = st && !st.endedAt ? st : null;
    this.bindRun();
    this.emit();
    if (this.state && !this.state.current) await this.advance();
  }

  async start(scope: Scope) {
    this.summary = null;
    this.state = { sid: newId(), scope, startedAt: nowIso(), endedAt: null, index: 0, served: [], current: null, next: null, queue: [], queueKey: "", results: [] };
    await this.persist();
    await this.advance();
  }

  // ----- item production -----

  private key() {
    return JSON.stringify([this.state?.scope, [...this.completed].sort()]);
  }

  private async produce(): Promise<{ item: Item; served?: string } | null> {
    const st = this.state as PState;
    this.ctx = await loadCtx(this.courseNumber);
    const ctx = this.ctx;
    if (st.queueKey !== this.key()) { st.queue = []; st.queueKey = this.key(); } // 7.5: queue is discarded on scope/completed change
    let kind = itemKind(st.index);
    if (kind === "E") {
      const exercises = await allExercises(this.courseNumber);
      const prevEx = st.served.length ? exercises.find((x) => x.id === st.served[st.served.length - 1]) : null;
      const base = { exercises, plan: ctx.plan, progress: ctx.progress, events: ctx.events, scope: st.scope, servedIds: st.served, now: nowIso(), previous: prevEx ?? null };
      const p = pick(base);
      let chosen = p.exercise;
      if (!chosen || p.needsGeneration) {
        const focus = chooseFocus(ctx, st.scope);
        const gen = focus ? await generateExercise(this.e, ctx, focus).catch(() => null) : null;
        if (gen) chosen = gen; // otherwise serve the best eligible one, if any (7.5)
      }
      if (chosen) return { item: { kind: "E", ref: fromExercise(chosen).ref, run: emptyRun() }, served: chosen.id };
      kind = "M"; // no exercise can be produced: substitute the next M or O
    }
    const want = kind === "O" ? "open" : "mcq";
    const i = st.queue.findIndex((c) => c.kind === want);
    let check = st.queue[i];
    if (!check) {
      const focus = chooseFocus(ctx, st.scope);
      if (!focus) return null;
      st.queue = [...st.queue, ...(await generateChecks(this.e, ctx, focus))];
      check = st.queue.find((c) => c.kind === want) ?? st.queue[0];
    }
    if (!check) return null;
    st.queue = st.queue.filter((c) => c.id !== check?.id);
    return { item: check.kind === "mcq" ? { kind: "M", check, selected: null } : { kind: "O", check, answer: null, result: null } };
  }

  /** Prefetch the next item while the user works (7.5). */
  private prefetch() {
    const st = this.state;
    if (!st || st.next || this.prefetching) return;
    this.prefetching = (async () => {
      try {
        const made = await this.produce();
        if (made && this.state === st) {
          await this.set({ next: made.item, queue: st.queue, queueKey: st.queueKey, served: made.served ? [...st.served, made.served] : st.served, index: st.index + 1 });
        }
      } catch {
        /* prefetch is best effort; advance() retries */
      } finally {
        this.prefetching = null;
      }
    })();
  }

  async advance() {
    if (!this.state || this.loading) return;
    this.loading = true;
    this.error = null;
    this.emit();
    try {
      await this.prefetching;
      let st = this.state;
      if (!st.next) {
        const made = await this.produce();
        if (!made) throw new Error("practice.noItems");
        await this.set({ next: made.item, queue: st.queue, queueKey: st.queueKey, served: made.served ? [...st.served, made.served] : st.served, index: st.index + 1 });
        st = this.state as PState;
      }
      await this.set({ current: st.next, next: null });
      this.bindRun();
      this.prefetch();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
      this.emit();
    }
  }

  // ----- current item -----

  /** The Ex of the current exercise item. */
  exercise: Ex | null = null;
  private bindRun() {
    this.run = null;
    this.exercise = null;
    const cur = this.state?.current;
    if (cur?.kind !== "E") return;
    void (async () => {
      const found = (await allExercises(this.courseNumber)).find((x) => x.id === cur.ref.id);
      if (!found || this.state?.current !== cur) return;
      this.exercise = fromExercise(found);
      this.run = new ExerciseRun(this.courseNumber, this.exercise, "practice", this.e, cur.run, async (s) => {
        const it = (this.state as PState).current;
        if (it?.kind !== "E") return;
        const grade = s.grade;
        const results = grade && grade !== cur.run.grade
          ? [...(this.state as PState).results, { kind: "E" as const, score: grade.score, correct: grade.verdict === "correct", stageIds: this.exercise?.stageIds ?? [], tags: grade.mistakes.map((m) => m.tag) }]
          : (this.state as PState).results;
        cur.run = s;
        await this.set({ current: { ...it, run: s }, results });
      });
      this.emit();
    })();
  }

  private push(r: Result) {
    return this.set({ results: [...(this.state as PState).results, r] });
  }
  async answerMcq(selected: number) {
    const cur = this.state?.current;
    if (cur?.kind !== "M" || cur.selected !== null) return;
    const correct = selected === cur.check.correctIndex;
    await appendEvent(this.courseNumber, {
      type: "check_answered", stageId: cur.check.stageIds[0] as string, checkId: cur.check.id, kind: "mcq", context: "practice",
      correct, score: correct ? 100 : 0, mistakeTags: [],
    });
    await this.set({ current: { ...cur, selected } });
    await this.push({ kind: "M", score: correct ? 100 : 0, correct, stageIds: cur.check.stageIds, tags: [] });
  }
  async answerOpen(text: string, files: Attachment[]) {
    const cur = this.state?.current;
    if (cur?.kind !== "O" || cur.result || this.loading) return;
    this.loading = true;
    this.error = null;
    this.emit();
    try {
      const result = await gradeCheck(this.e, await loadCtx(this.courseNumber), { id: cur.check.id, stageIds: cur.check.stageIds, questionMd: cur.check.questionMd, expectedPoints: cur.check.expectedPoints ?? [] }, text, files, "practice");
      await this.set({ current: { ...cur, answer: text, result } });
      await this.push({ kind: "O", score: result.score, correct: result.correct, stageIds: cur.check.stageIds, tags: result.mistakes.map((m) => m.tag) });
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
      this.emit();
    }
  }
  /** "Try again": same item, new attempt. */
  async tryAgain() {
    const cur = this.state?.current;
    if (!cur) return;
    if (cur.kind === "E") await this.run?.retry();
    else if (cur.kind === "M") await this.set({ current: { ...cur, selected: null } });
    else await this.set({ current: { ...cur, answer: null, result: null } });
  }

  // ----- end -----

  async end(): Promise<Summary> {
    const st = this.state as PState;
    this.ctx = await loadCtx(this.courseNumber);
    const stages = new Set(st.results.flatMap((r) => r.stageIds));
    const defined = this.ctx.events.filter((e) => e.type === "mistake_tag_defined" && e.ts >= st.startedAt).map((e) => (e as { tag: string }).tag);
    const summary: Summary = {
      items: st.results.length,
      avgScore: st.results.length ? Math.round(st.results.reduce((a, r) => a + r.score, 0) / st.results.length) : 0,
      newMistakes: [...new Set(st.results.flatMap((r) => r.tags).filter((t) => defined.includes(t)))],
      weakStages: this.ctx.plan.stages.filter((s) => stages.has(s.id) && (this.ctx.progress.stages[s.id]?.mastery ?? 0) < WEAK).map((s) => ({ id: s.id, title: s.title })),
    };
    await this.set({ endedAt: nowIso() });
    this.summary = summary;
    this.state = null;
    this.run = null;
    this.emit();
    return summary;
  }

  /** "Learn again" in the summary. */
  async relearn(stageId: string) {
    await appendEvent(this.courseNumber, { type: "stage_reopened", stageId });
  }
}
