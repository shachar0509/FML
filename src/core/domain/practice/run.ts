import type { Grade } from "@/core/claude/practiceTools";
import { clarifyClue, digest, examples, getClue, getHint, getSolution } from "./assist";
import { loadCtx, type Ex } from "./exercises";
import { gradeAttempt, type Attachment, type Context, type Env } from "./grade";

export type RunState = {
  hints: { level: number; hintMd: string; targetsStep: string }[];
  solutionMd: string | null;
  grade: Grade | null;
  attemptId: string | null;
  attempts: number;
  /** M56 solving loop: clues so far (`more` = re-explanations after "I didn't understand"); `clueOpen` until "Thank you" */
  clues?: { onTrack: boolean; clueMd: string; more: string[] }[];
  clueOpen?: boolean;
  /** the pages of the last graded attempt (M57: a perfect one goes into the homework's solution file) */
  files?: string[];
};
export const emptyRun = (): RunState => ({ hints: [], solutionMd: null, grade: null, attemptId: null, attempts: 0, clues: [], clueOpen: false });
/** M56: a perfect answer = over 95% for reasoning, explanations and conventions, and every final answer right. */
export const perfect = (g: Grade | null) => !!g && g.score > 95 && g.finalAnswerCorrect && g.verdict !== "unreadable";
/** 7.7: "Show full solution" appears after level 3 or after a graded attempt. */
export const canReveal = (s: RunState) => !s.solutionMd && (s.hints.length >= 3 || s.attempts > 0);

/** One exercise card (Learn and Practice share it): hints, solution reveal, grading. State persists through `save`. */
export class ExerciseRun {
  busy = false;
  error: string | null = null;
  private subs = new Set<() => void>();
  constructor(
    readonly courseNumber: string, readonly ex: Ex, readonly context: Context, private env: Env,
    public state: RunState, private save: (s: RunState) => Promise<void>,
    /** M56: the solving loop (clues, grading by the course's conventions) instead of the 3 hints */
    readonly loop = false,
  ) {}
  subscribe = (f: () => void) => (this.subs.add(f), () => void this.subs.delete(f));
  private emit() {
    this.subs.forEach((f) => f());
  }
  private async set(s: RunState) {
    this.state = s;
    await this.save(s);
    this.emit();
  }
  private async guard<T>(f: () => Promise<T>): Promise<T | null> {
    if (this.busy) return null;
    this.busy = true;
    this.error = null;
    this.emit();
    try {
      return await f();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      return null;
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  get level() {
    return Math.min(3, this.state.hints.length + 1);
  }
  async hint(files: Attachment[]) {
    if (this.state.hints.length >= 3) return;
    await this.guard(async () => {
      const ctx = await loadCtx(this.courseNumber);
      const h = await getHint(this.env, ctx, this.ex, this.level, this.state.hints.map((x) => x.hintMd), files, this.context);
      await this.set({ ...this.state, hints: [...this.state.hints, { level: this.level, hintMd: h.hintMd, targetsStep: h.targetsStep }] });
    });
  }
  async reveal() {
    if (!canReveal(this.state)) return;
    await this.guard(async () => {
      const md = await getSolution(this.env, await loadCtx(this.courseNumber), this.ex, this.context);
      await this.set({ ...this.state, solutionMd: md });
    });
  }
  get clues() {
    return this.state.clues ?? [];
  }
  /** Loop "Get a clue": the work so far is checked for a mistake, else one small clue. */
  async clue(files: Attachment[]) {
    await this.guard(async () => {
      const c = await getClue(this.env, await loadCtx(this.courseNumber), this.ex, this.clues.map((x) => x.clueMd), files);
      await this.set({ ...this.state, clues: [...this.clues, { onTrack: c.onTrack, clueMd: c.clueMd, more: [] }], clueOpen: true, grade: null });
    });
  }
  /** Loop "I didn't understand the clue": the last clue again, in other words. */
  async clarify() {
    const last = this.clues.at(-1);
    if (!last) return;
    await this.guard(async () => {
      const md = await clarifyClue(this.env, await loadCtx(this.courseNumber), this.ex, last.clueMd, last.more);
      await this.set({ ...this.state, clues: [...this.clues.slice(0, -1), { ...last, more: [...last.more, md] }] });
    });
  }
  /** Loop "Thank you": back to clue / submit. */
  async clueDone() {
    await this.set({ ...this.state, clueOpen: false });
  }
  /** Returns the grade (also kept in state) or null on error (see `error`). */
  async submit(files: Attachment[]): Promise<Grade | null> {
    return this.guard(async () => {
      const ctx = await loadCtx(this.courseNumber);
      const conv = this.loop ? { examples: await examples(ctx, this.ex), digest: await digest(this.env, ctx, this.ex) } : {};
      const { grade, attemptId } = await gradeAttempt(this.env, ctx, this.ex, files, {
        hintsUsed: Math.min(3, this.state.hints.length + this.clues.length), solutionRevealed: !!this.state.solutionMd, context: this.context, ...conv,
      });
      await this.set({ ...this.state, grade, attemptId, attempts: this.state.attempts + 1, clueOpen: false, files: files.map((f) => f.sha256) });
      return grade;
    });
  }
  /** "Try again": same item, new attempt. */
  async retry() {
    await this.set({ ...this.state, grade: null });
  }
}
