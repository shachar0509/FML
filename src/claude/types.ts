import type { TaskId } from "./models";

export type TextBlock = { type: "text"; text: string; cache_control?: CacheControl };
export type ImageBlock = {
  type: "image";
  source: { type: "base64"; media_type: "image/jpeg" | "image/png"; data: string };
  cache_control?: CacheControl;
};
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: CacheControl;
};
// Anything else the API returns (thinking, server_tool_use, web_search_tool_result...) is carried through untouched.
export type OtherBlock = { type: string; [k: string]: unknown };
export type Block = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | OtherBlock;

export type CacheControl = { type: "ephemeral"; ttl?: "1h" };
export type Message = { role: "user" | "assistant"; content: string | Block[] };

export type ToolDef = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  cache_control?: CacheControl;
};
// Server-side tools (web search) are passed through as-is.
export type ServerToolDef = { type: string; name: string; [k: string]: unknown };

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

export type ToolChoice = { type: "auto" } | { type: "tool"; name: string };

export type ClaudeRequest = {
  task: TaskId;
  courseNumber?: string;
  system: string;
  messages: Message[];
  tools?: (ToolDef | ServerToolDef)[];
  toolChoice?: ToolChoice;
  /** Extended thinking budget (grading only). */
  thinkingBudget?: number;
  /** Overrides the task default (e.g. grading with thinking: maxTokens already excludes the budget). */
  maxTokens?: number;
  /** Tutor/Ask: also breakpoint the last assistant turn (9.5). */
  cacheConversation?: boolean;
  signal?: AbortSignal;
  /** Live text deltas (tutor only). */
  onText?: (delta: string) => void;
  /** Jump the FIFO queue (tutor). */
  priority?: boolean;
};

export type ClaudeResponse = {
  content: Block[];
  stopReason: string | null;
  usage: Usage;
  model: string;
};

export interface ClaudeGateway {
  send(req: ClaudeRequest): Promise<ClaudeResponse>;
}

export const toolUses = (r: ClaudeResponse): ToolUseBlock[] =>
  r.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
export const textOf = (r: ClaudeResponse): string =>
  r.content
    .filter((b): b is TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
