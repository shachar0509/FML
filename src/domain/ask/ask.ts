import { askPrompt, askPromptNoCourse } from "@/claude/prompts/ask";
import { consultMaterials } from "@/claude/tutorTools";
import { textOf, toolUses, type Block, type ClaudeGateway, type Message, type ToolDef } from "@/claude/types";
import { buildKnowledgeBoundary } from "@/domain/boundary/boundary";
import { loadCtx } from "@/domain/practice/exercises";
import { consult } from "@/domain/retrieval/retrieve";
import { bytesToBase64, fitImageFile } from "@/lib/images";
import { useSettings } from "@/stores/settings";

/** What the screen tells the panel (12.9). `stageId` only inside Learn. */
export type AskContext = {
  courseNumber: string | null;
  screen: string;
  stageId?: string | null;
  openExercise?: string;
};
export type AskMessage = { id: number; role: "user" | "assistant"; text: string; image?: string };

export const ASK_KEEP = 6;
const MAX_LOOPS = 3;

/** The in-memory thread (12.9): nothing is written to disk, no events. */
export class AskThread {
  messages: AskMessage[] = [];
  busy = false;
  error: string | null = null;
  private n = 0;
  private abort: AbortController | null = null;
  private subs = new Set<() => void>();

  constructor(private gw: () => ClaudeGateway) {}

  subscribe = (f: () => void) => (this.subs.add(f), () => void this.subs.delete(f));
  private emit() {
    this.messages = [...this.messages];
    this.subs.forEach((f) => f());
  }

  reset() {
    this.abort?.abort();
    this.messages = [];
    this.error = null;
    this.busy = false;
    this.emit();
  }

  /** One image (any browser-decodable file) -> base64 JPEG, kept in memory only. */
  static async image(file: File): Promise<string> {
    return bytesToBase64(await fitImageFile(new Uint8Array(await file.arrayBuffer()), file.type));
  }

  async send(text: string, ctx: AskContext, image?: string): Promise<void> {
    if (this.busy || !(text.trim() || image)) return;
    this.messages.push({ id: ++this.n, role: "user", text: text.trim(), image });
    this.busy = true;
    this.error = null;
    this.emit();
    const ac = (this.abort = new AbortController());
    try {
      const answer = await this.ask(ctx, ac.signal);
      if (!ac.signal.aborted) this.messages.push({ id: ++this.n, role: "assistant", text: answer });
    } catch (e) {
      if (!ac.signal.aborted) this.error = e instanceof Error ? e.message : String(e);
    } finally {
      if (this.abort === ac) this.busy = false;
      this.emit();
    }
  }

  private async ask(ctx: AskContext, signal: AbortSignal): Promise<string> {
    const s = useSettings.getState().settings;
    const lang = s.language === "he" ? "Hebrew" : "English";
    const gw = this.gw();
    let system: string;
    let tools: ToolDef[] | undefined;
    let courseCtx: Awaited<ReturnType<typeof loadCtx>> | null = null;
    if (ctx.courseNumber) {
      courseCtx = await loadCtx(ctx.courseNumber);
      const { course, plan, progress } = courseCtx;
      system = askPrompt({
        courseNumber: course.courseNumber,
        courseName: course.nameHe,
        screenContext: ctx.screen,
        // Learn: current stage allowed; elsewhere only completed stages (currentStageId null).
        knowledgeBoundary: buildKnowledgeBoundary({ course, plan, progress, currentStageId: ctx.stageId ?? null }),
        openExercise: ctx.openExercise ?? "",
        lang,
      });
      tools = [consultMaterials.def];
    } else system = askPromptNoCourse(ctx.screen, lang);

    const last = this.messages.slice(-ASK_KEEP);
    const msgs: Message[] = last.map((m, i) => ({
      role: m.role,
      content: [
        ...(m.image && i === last.length - 1 ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: m.image } } as Block] : m.image ? [{ type: "text", text: "[image: attached earlier]" } as Block] : []),
        { type: "text", text: m.text || "?" } as Block,
      ],
    }));
    // The window may start on an assistant turn; the API needs a user turn first.
    while (msgs[0]?.role === "assistant") msgs.shift();

    for (let loop = 0; loop < MAX_LOOPS; loop++) {
      const r = await gw.send({
        task: "ask",
        courseNumber: ctx.courseNumber ?? undefined,
        system,
        messages: msgs,
        tools: loop < MAX_LOOPS - 1 ? tools : undefined,
        cacheConversation: true,
        signal,
      });
      const uses = toolUses(r);
      if (!uses.length || !courseCtx) return textOf(r);
      // consult_materials results are ephemeral: they live only in this local loop (9.9).
      const { course, plan, progress } = courseCtx;
      const results: Block[] = [];
      for (const u of uses) {
        const i = consultMaterials.schema.safeParse(u.input);
        let content: string;
        if (!i.success) content = "Invalid input";
        else {
          const got = await consult(
            { gw, signal },
            { course, plan, progress, stageId: ctx.stageId ?? plan.stages[0]?.id ?? "S001", question: i.data.question, purpose: i.data.purpose, lang, webSearch: s.retrieval.webSearch },
          ).catch((e: unknown) => ({ answerMd: `Lookup failed: ${e instanceof Error ? e.message : String(e)}`, coverage: "none", sources: [] as string[] }));
          content = JSON.stringify({ answerMd: got.answerMd, coverage: got.coverage, sources: got.sources });
        }
        results.push({ type: "tool_result", tool_use_id: u.id, content });
      }
      msgs.push({ role: "assistant", content: r.content }, { role: "user", content: results });
    }
    return "";
  }
}
