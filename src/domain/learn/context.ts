import type { SessionLine, StoredBlock } from "@/domain/dataSchemas";
import { summaryPrompt } from "@/claude/prompts/summary";
import type { Lang } from "@/claude/prompts/shared";
import { textOf, type Block, type ClaudeGateway, type Message } from "@/claude/types";
import { appendLine } from "./session";

type MsgLine = Extract<SessionLine, { kind: "message" }>;
export type LoadImage = (sha256: string, mediaType: "image/jpeg" | "image/png") => Promise<string>;

export const COMPACT_TOKENS = 40_000;
export const KEEP_MESSAGES = 10;
const IMAGE_STUB = "[image: student's attachment, already evaluated]";
const text = (t: string): Block => ({ type: "text", text: t });

export function resumePrefix(lastTs: string | null, now: string): string | null {
  if (!lastTs) return null;
  const h = (Date.parse(now) - Date.parse(lastTs)) / 3_600_000;
  return h > 6 ? `[RESUME after ${Math.round(h)} hours: recap in 2-3 sentences where we stopped, then continue]` : null;
}

/** Latest summary and the message lines it does not cover (3.8, 6.4). */
function afterSummary(lines: SessionLine[]) {
  const si = lines.findLastIndex((l) => l.kind === "summary");
  const summary = si < 0 ? null : (lines[si] as Extract<SessionLine, { kind: "summary" }>);
  const from = summary ? lines.findIndex((l) => l.id === summary.coversThroughId) + 1 : 0;
  return { summary, msgs: lines.slice(from).filter((l): l is MsgLine => l.kind === "message") };
}

export async function buildMessages(o: {
  lines: SessionLine[];
  statusText?: string;
  /** Hidden control text for the newest user message, e.g. `[START_LESSON]` or resumePrefix(). */
  hiddenPrefix?: string | null;
  loadImage: LoadImage;
}): Promise<Message[]> {
  const { summary, msgs } = afterSummary(o.lines);
  const newest = msgs.findLastIndex((m) => m.role === "user");
  const out: Message[] = summary ? [{ role: "user", content: [text(summary.text)] }] : [];
  for (const [i, m] of msgs.entries()) {
    const last = i === newest;
    const content: Block[] = [];
    for (const b of m.content as StoredBlock[]) {
      if (b.type === "image_ref")
        content.push(last ? { type: "image", source: { type: "base64", media_type: b.mediaType, data: await o.loadImage(b.sha256, b.mediaType) } } : text(IMAGE_STUB));
      else if (b.type === "tool_result") {
        const c = b.ephemeral && !last ? (b.stub ?? b.content) : b.content;
        content.push({ type: "tool_result", tool_use_id: b.tool_use_id, content: c, ...(b.is_error ? { is_error: true } : {}) });
      } else content.push(b);
    }
    if (last) {
      // tool_result blocks must stay first in a user message.
      const k = content.findIndex((b) => b.type !== "tool_result");
      content.splice(k < 0 ? content.length : k, 0, ...[o.statusText, o.hiddenPrefix].filter((t): t is string => !!t).map(text));
    }
    out.push({ role: m.role, content });
  }
  return out;
}

export function estimateTokens(messages: Message[]): number {
  let chars = 0;
  let images = 0;
  for (const m of messages)
    for (const b of typeof m.content === "string" ? [text(m.content)] : m.content) {
      if (b.type === "image") images++;
      else if (b.type === "text") chars += (b as { text: string }).text.length;
      else if (b.type === "tool_result") chars += (b as { content: string }).content.length;
      else if (b.type === "tool_use") chars += JSON.stringify((b as { input: unknown }).input).length + (b as { name: string }).name.length;
    }
  return chars / 3.5 + 1600 * images;
}

const flatten = (m: MsgLine) =>
  `${m.role}: ${m.content
    .map((b) => (b.type === "text" ? b.text : b.type === "image_ref" ? "[image]" : b.type === "tool_use" ? `[tool ${b.name}: ${JSON.stringify(b.input)}]` : `[result: ${b.ephemeral ? (b.stub ?? b.content) : b.content}]`))
    .join("\n")}`;

/** 6.4: over 40k history tokens, summarize all but the last 10 messages and append a `summary` line. */
export async function compactIfNeeded(o: {
  gw: ClaudeGateway;
  course: string;
  stageId: string;
  lines: SessionLine[];
  lang: Lang;
}): Promise<SessionLine | null> {
  if (estimateTokens(await buildMessages({ lines: o.lines, loadImage: async () => "" })) <= COMPACT_TOKENS) return null;
  const { summary, msgs } = afterSummary(o.lines);
  let cut = msgs.length - KEEP_MESSAGES;
  // Never split a tool_use from its tool_result: a kept user message starting with a result pulls its assistant turn in.
  while (cut > 0 && (msgs[cut]?.content ?? []).some((b) => b.type === "tool_result")) cut--;
  if (cut <= 0) return null;
  const transcript = [...(summary ? [`Earlier summary: ${summary.text}`] : []), ...msgs.slice(0, cut).map(flatten)].join("\n\n");
  const r = await o.gw.send({ task: "summary", courseNumber: o.course, system: summaryPrompt(o.lang), messages: [{ role: "user", content: transcript }] });
  return appendLine(o.course, o.stageId, { kind: "summary", coversThroughId: (msgs[cut - 1] as MsgLine).id, text: textOf(r) });
}
