import type { z } from "zod";
import { ClaudeError } from "./errors";
import type { Tool } from "./tools";
import type { ClaudeGateway, ClaudeRequest, ClaudeResponse, Message, ToolUseBlock } from "./types";
import { toolUses } from "./types";

const MAX_CORRECTIONS = 2;

type Opts = Omit<ClaudeRequest, "tools" | "toolChoice">;
export type Structured<T> = { value: T; response: ClaudeResponse };

/**
 * Spec 9.3: forced tool call -> zod validate -> up to 2 corrections in the SAME conversation (only errors sent).
 * With thinking, forced tool choice is not allowed: tool_choice auto + closing instruction; if the model never
 * calls the tool, retry once with thinking off and forced choice.
 */
export async function callStructured<T extends z.ZodType>(
  gw: ClaudeGateway,
  tool: Tool<T>,
  req: Opts,
): Promise<Structured<z.output<T>>> {
  const name = tool.def.name;
  const thinking = !!req.thinkingBudget;
  let base: Opts = thinking
    ? { ...req, system: `${req.system}\n\nYou must finish by calling ${name} exactly once.` }
    : req;
  const go = (messages: Message[], o: Opts) =>
    gw.send({ ...o, messages, tools: [tool.def], toolChoice: o.thinkingBudget ? { type: "auto" } : { type: "tool", name } });

  let messages = req.messages;
  let res = await go(messages, base);
  let call = toolUses(res).find((c) => c.name === name);
  if (!call && thinking) {
    base = { ...req, thinkingBudget: undefined };
    res = await go(messages, base);
    call = toolUses(res).find((c) => c.name === name);
  }

  for (let fixes = 0; ; fixes++) {
    if (!call) throw new ClaudeError("invalid_output", `model did not call ${name}`);
    const parsed = tool.schema.safeParse(call.input); // zod strips unknown keys by default
    if (parsed.success) return { value: parsed.data, response: res };
    if (fixes >= MAX_CORRECTIONS) {
      throw new ClaudeError("invalid_output", `${name}: ${parsed.error.message}`);
    }
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("\n");
    messages = [
      ...messages,
      { role: "assistant", content: res.content },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: (call as ToolUseBlock).id, is_error: true, content: `${issues}\nCall the tool again with corrected input.` },
        ],
      },
    ];
    res = await go(messages, base);
    call = toolUses(res).find((c) => c.name === name);
  }
}
