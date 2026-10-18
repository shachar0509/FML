import Anthropic from "@anthropic-ai/sdk";
import type { Transport } from "./gateway";
import type { Block, ClaudeResponse } from "./types";

/** Spec 9.1. Inside Tauri requests go through plugin-http (CSP/CORS); elsewhere (tests, dev browser) global fetch. */
export async function makeClient(apiKey: string): Promise<Anthropic> {
  const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const fetch = inTauri ? ((await import("@tauri-apps/plugin-http")).fetch as typeof globalThis.fetch) : undefined;
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, ...(fetch && { fetch }) });
}

/** Streaming transport over the SDK; retries/queue/caching live in gateway.ts. */
export const sdkTransport =
  (client: Anthropic): Transport =>
  async (p, { signal, onText, onActivity }) => {
    // ponytail: loose cast, WireParams is validated by the API rather than mirrored in SDK types.
    const stream = client.messages.stream(p as unknown as Anthropic.MessageStreamParams, { signal });
    stream.on("streamEvent", onActivity);
    if (onText) stream.on("text", onText);
    const m = await stream.finalMessage();
    return {
      content: m.content as unknown as Block[],
      stopReason: m.stop_reason,
      model: m.model,
      usage: {
        input_tokens: m.usage.input_tokens,
        output_tokens: m.usage.output_tokens,
        cache_creation_input_tokens: m.usage.cache_creation_input_tokens ?? 0,
        cache_read_input_tokens: m.usage.cache_read_input_tokens ?? 0,
      },
    } satisfies ClaudeResponse;
  };

export const listModelIds = async (client: Anthropic): Promise<string[]> => {
  const ids: string[] = [];
  for await (const m of client.models.list({ limit: 100 })) ids.push(m.id);
  return ids;
};
