import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeClaudeGateway, toolCall } from "./fake";
import { callStructured } from "./structured";
import { defineTool } from "./tools";
import type { ClaudeRequest } from "./types";

const req = (o: Partial<ClaudeRequest> = {}): ClaudeRequest => ({
  task: "ask",
  system: "sys",
  messages: [{ role: "user", content: "q" }],
  ...o,
});
describe("callStructured", () => {
  const tool = defineTool("submit_x", "x", z.object({ n: z.number() }));
  it("returns validated input and strips unknown keys", async () => {
    const f = new FakeClaudeGateway([toolCall("submit_x", { n: 1, extra: 2 })]);
    const r = await callStructured(f, tool, req());
    expect(r.value).toEqual({ n: 1 });
    expect(f.calls[0]?.toolChoice).toEqual({ type: "tool", name: "submit_x" });
  });
  it("corrects in the same conversation, max 2 times", async () => {
    const f = new FakeClaudeGateway([toolCall("submit_x", { n: "a" }), toolCall("submit_x", { n: "b" }, "tu_2"), toolCall("submit_x", { n: 3 }, "tu_3")]);
    expect((await callStructured(f, tool, req())).value.n).toBe(3);
    const last = f.calls[2]?.messages.at(-1);
    expect(JSON.stringify(last)).toContain("is_error");
    expect(f.calls[2]?.messages).toHaveLength(5);
    const bad = new FakeClaudeGateway([1, 2, 3].map((i) => toolCall("submit_x", { n: "z" }, `t${i}`)));
    await expect(callStructured(bad, tool, req())).rejects.toMatchObject({ kind: "invalid_output" });
  });
  it("thinking: auto choice + suffix; falls back to forced without thinking", async () => {
    const f = new FakeClaudeGateway([{ content: [{ type: "text", text: "hm" }] }, toolCall("submit_x", { n: 1 })]);
    await callStructured(f, tool, req({ task: "grading", thinkingBudget: 8000 }));
    expect(f.calls[0]).toMatchObject({ toolChoice: { type: "auto" }, thinkingBudget: 8000 });
    expect(f.calls[0]?.system).toContain("exactly once");
    expect(f.calls[1]).toMatchObject({ toolChoice: { type: "tool", name: "submit_x" } });
    expect(f.calls[1]?.thinkingBudget).toBeUndefined();
  });
});
