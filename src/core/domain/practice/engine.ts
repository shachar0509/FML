import type { CheckGrade, CheckItem } from "@/core/claude/practiceTools";
import { createConv, loadConv, updateConv } from "@/core/domain/history/history";
import { getDeviceId } from "@/core/lib/device";
import { useSettings } from "@/stores/settings";
import { appendJsonl, readJsonl } from "@/core/lib/fs/jsonl";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { appendEvent } from "@/core/domain/progress/store";
import { SessionLineSchema } from "@/core/domain/dataSchemas";
import type { ExerciseRef } from "@/core/domain/dataSchemas";
import { allExercises, fromExercise, loadCtx, paths, type Ctx, type Ex } from "./exercises";
import { chooseFocus, generateChecks, generateExercise } from "./generate";
import { gradeCheck, type Attachment, type Env } from "./grade";
import { emptyRun, ExerciseRun, perfect, type RunState } from "./run";
import { completedIds, itemKind, pick, requiredSet, skill, type Scope } from "./select";
import { after, burn, examPool, loadStore, pickTest, saveStore, scopeOf, type Chain, type Note } from "./test";

export type Check = CheckItem & { id: string };
export type Item =
  | { kind: "E"; ref: ExerciseRef; run: RunState }
  | { kind: "M"; check: Check; selected: number | null }
  | { kind: "O"; check: Check; answer: string | null; result: CheckGrade | null };
export type Result = { kind: "E" | "M" | "O"; score: number; correct: boolean; stageIds: string[]; tags: string[] };
export type PState = {
  sid: string; scope: Scope; startedAt: string; endedAt: string | null; index: number; served: string[];
  current: Item | null; next: Item | null; queue: Check[]; queueKey: string; results: Result[];
  /** M59 Test practice: the follow-up chain after a miss, the note shown with the current question, the last stages served */
  /** M60: its saved conversation in .chat_history */
  cid?: string;
  test?: { chain: Chain | null; note: Note; noteStage?: string; recent: string[]; /** the question last scored (a retried Next or End doesn't score it twice) */ scored?: string };
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
  /** The MCP server turns this off: a prefetched item would park a job nobody fetches until the next chat line. */
  prefetchOn = true;
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
    const fresh = !this.state.cid; // a new session, or one from before M60
    this.state.cid ??= newId();
    await appendJsonl(this.file(), { kind: "ui", id: newId(), ts: nowIso(), deviceId: getDeviceId(), widgetId: WIDGET, state: this.state });
    const meta = { type: this.state.scope.kind === "test" ? ("test" as const) : ("normal" as const), title: this.title() };
    // created once; after that only updated, so a session deleted from the list is never saved back into it
    const st = this.state;
    await (fresh ? createConv(this.courseNumber, { id: st.cid, kind: "practice", ...meta, state: st }) : updateConv(this.courseNumber, st.cid as string, (c) => ({ ...c, ...meta, state: st }))).catch(() => undefined);
  }
  /** What the session covers, for the saved-sessions list. */
  private title() {
    const sc = (this.state as PState).scope;
    const p = this.ctx?.plan;
    const he = useSettings.getState().settings.language === "he";
    const stage = (id: string) => `${id} · ${p?.stages.find((s) => s.id === id)?.title ?? ""}`;
    if (sc.kind === "unit") return p?.units.find((u) => u.id === sc.unitId)?.title ?? sc.unitId;
    if (sc.kind === "stage") return stage(sc.stageId);
    if (sc.kind === "weak") return he ? "נושאים חלשים" : "Weak topics";
    if (sc.kind === "test" && sc.stageIds) return sc.stageIds.slice(0, 3).map(stage).join(", ") + (sc.stageIds.length > 3 ? "…" : "");
    return he ? (sc.kind === "test" ? "כל הקורס" : "כל מה שנלמד") : sc.kind === "test" ? "The whole course" : "Everything learned";
  }
  /** M60: continue a saved session (an ended one too). */
  async resume(st: PState) {
    this.summary = null;
    this.ctx = await loadCtx(this.courseNumber);
    this.state = { ...st, endedAt: null };
    this.bindRun();
    await this.persist();
    this.emit();
    if (!this.state.current) await this.advance();
  }
  /** M60: the running session was deleted from the list. */
  drop() {
    this.state = null;
    this.run = null;
    this.summary = null;
    this.emit();
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
    if (this.state?.cid && !(await loadConv(this.courseNumber, this.state.cid))) this.state = null; // deleted from the saved sessions
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
    if (st.scope.kind === "test") return this.produceTest(st, st.scope.stageIds);
    if (st.queueKey !== this.key()) { st.queue = []; st.queueKey = this.key(); } // 7.5: queue is discarded on scope/completed change
    let kind = itemKind(st.index, skill(ctx));
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

  /** M59: a past exam question (burned once served), or a new verified one like it when the concept's exam questions are used up. */
  private async produceTest(st: PState, scope: string[] | null): Promise<{ item: Item; served: string } | null> {
    const n = this.courseNumber;
    const t = (st.test ??= { chain: null, note: null, recent: [] });
    const store = await loadStore(n);
    const p = pickTest(await examPool(n), store, t.chain, scopeOf(this.ctx.plan.stages, scope), t.recent);
    if (!p) return null;
    let chosen: Parameters<typeof fromExercise>[0] | null;
    if ("pick" in p) {
      await saveStore(n, burn(store, p.pick));
      chosen = p.pick.ex;
    } else {
      const like = t.chain ? ((await allExercises(n)).find((x) => x.id === t.chain?.missedId) ?? null) : null;
      const all = new Set(this.ctx.plan.stages.map((s) => s.id));
      chosen = await generateExercise(this.e, this.ctx, { stageId: p.generate, required: like?.requiredStageIds ?? requiredSet(this.ctx.plan, p.generate, all) }, { like });
      if (!chosen) throw new Error("practice.test.generateFailed");
    }
    t.recent = [...t.recent, chosen.primaryStageId].slice(-3);
    return { item: { kind: "E", ref: fromExercise(chosen).ref, run: emptyRun() }, served: chosen.id };
  }
  /** M59: the answer to the current question decides the follow-ups; perfect = the first submission perfect (a miss fixed on retry is still a miss). */
  private async scoreTest() {
    const st = this.state;
    if (st?.scope.kind !== "test") return;
    await this.binding;
    const cur = st.current;
    const stageId = this.exercise?.stageIds[0];
    const t = (st.test ??= { chain: null, note: null, recent: [] });
    if (cur?.kind === "E" && t.scored === cur.ref.id) return;
    t.note = null;
    if (cur?.kind !== "E" || !cur.run.grade || !stageId) return; // skipped: nothing changes
    const r = after(await loadStore(this.courseNumber), t.chain, stageId, cur.ref.id, perfect(cur.run.grade) && cur.run.attempts === 1);
    await saveStore(this.courseNumber, r.store);
    st.test = { ...t, chain: r.chain, note: r.note, noteStage: stageId, scored: cur.ref.id };
  }

  /** Prefetch the next item while the user works (7.5). */
  private prefetch() {
    const st = this.state;
    if (!this.prefetchOn || !st || st.next || this.prefetching || st.scope.kind === "test") return; // the next test question depends on this answer
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
      await this.scoreTest();
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
  /** Settles when the run of the current exercise item exists. */
  binding: Promise<void> = Promise.resolve();
  private bindRun() {
    this.run = null;
    this.exercise = null;
    const cur = this.state?.current;
    if (cur?.kind !== "E") return;
    this.binding = (async () => {
      const found = (await allExercises(this.courseNumber)).find((x) => x.id === cur.ref.id);
      if (!found || this.state?.current !== cur) return;
      this.exercise = { ...fromExercise(found), ...(this.state?.scope.kind === "test" ? { open: true } : {}) };
      this.run = new ExerciseRun(this.courseNumber, this.exercise, "practice", this.e, cur.run, async (s) => {
        const it = (this.state as PState).current;
        if (it?.kind !== "E") return;
        const grade = s.grade;
        const results = grade && grade !== cur.run.grade
          ? [...(this.state as PState).results, { kind: "E" as const, score: grade.score, correct: grade.verdict === "correct", stageIds: this.exercise?.stageIds ?? [], tags: grade.mistakes.map((m) => m.tag) }]
          : (this.state as PState).results;
        cur.run = s;
        await this.set({ current: { ...it, run: s }, results });
      }, true); // M56: practice exercises use the solving loop
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
    await this.scoreTest(); // M59: the last answer counts too
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
