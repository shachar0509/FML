import type { ClaudeGateway, ClaudeRequest, ClaudeResponse } from "./types";

export const usage0 = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };

/** Scripted gateway for tests: each send() pops the next reply (object or function of the request). */
export class FakeClaudeGateway implements ClaudeGateway {
  calls: ClaudeRequest[] = [];
  constructor(private script: (Partial<ClaudeResponse> | ((r: ClaudeRequest) => Partial<ClaudeResponse>))[]) {}

  async send(req: ClaudeRequest): Promise<ClaudeResponse> {
    this.calls.push(req);
    const next = this.script.shift();
    if (!next) throw new Error("FakeClaudeGateway: script exhausted");
    const r = typeof next === "function" ? next(req) : next;
    return { content: [], stopReason: "end_turn", usage: usage0, model: "fake", ...r };
  }
}

export const toolCall = (name: string, input: unknown, id = "tu_1"): Partial<ClaudeResponse> => ({
  content: [{ type: "tool_use", id, name, input }],
  stopReason: "tool_use",
});
