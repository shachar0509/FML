import type { Block, CacheControl, Message, ServerToolDef, ToolDef } from "./types";

type Cacheable = { system: string; tools?: (ToolDef | ServerToolDef)[]; messages: Message[] };
export type CachedParts = {
  system: { type: "text"; text: string; cache_control: CacheControl }[];
  tools?: (ToolDef | ServerToolDef)[];
  messages: Message[];
};

/**
 * Spec 9.5 breakpoints (max 4): last tool, end of the stable system block, and (tutor/Ask)
 * the last content block of the newest assistant turn. Pure: inputs are not mutated.
 * `ttl1h` makes every breakpoint use the 1-hour cache.
 */
export function applyCaching(p: Cacheable, o: { conversation: boolean; ttl1h: boolean }): CachedParts {
  const cc: CacheControl = o.ttl1h ? { type: "ephemeral", ttl: "1h" } : { type: "ephemeral" };
  const tools = p.tools?.map((t, i, a) => (i === a.length - 1 && !("type" in t && t.type !== "custom") ? { ...t, cache_control: cc } : t));
  let messages = p.messages;
  if (o.conversation) {
    const i = messages.findLastIndex((m) => m.role === "assistant");
    const m = messages[i];
    if (m) {
      const blocks: Block[] = typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...m.content];
      const last = blocks.at(-1);
      // thinking blocks cannot carry cache_control
      if (last && last.type !== "thinking" && last.type !== "redacted_thinking") {
        blocks[blocks.length - 1] = { ...last, cache_control: cc };
        messages = messages.map((x, j) => (j === i ? { ...x, content: blocks } : x));
      }
    }
  }
  return { system: [{ type: "text", text: p.system, cache_control: cc }], tools, messages };
}

/** Rejected `ttl` -> drop it from every breakpoint (caller remembers that for the session). */
export function stripTtl<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, x) => (k === "ttl" ? undefined : x))) as T;
}
