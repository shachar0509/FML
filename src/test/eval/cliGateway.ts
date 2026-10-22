import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Block, ClaudeGateway, ClaudeRequest, ClaudeResponse, Message, ToolDef } from "@/core/claude/types";

/**
 * Semantic eval only (never in `pnpm test`): sends each request to the local Claude Code CLI on the user's own login,
 * `claude -p` with the forced tool's schema as --json-schema, so the real prompts run on a real model with no key in any file.
 * Isolated: an empty temp cwd, --safe-mode (no CLAUDE.md, skills, hooks), --strict-mcp-config (no MCP servers), no tools.
 */
const MAX_PROCS = 4;

const blockText = (b: Block): string => {
  if (b.type === "text") return (b as { text: string }).text;
  if (b.type === "tool_use") return `[called ${(b as { name: string }).name} with ${JSON.stringify((b as { input: unknown }).input)}]`;
  if (b.type === "tool_result") return `[tool result${(b as { is_error?: boolean }).is_error ? " (error)" : ""}: ${(b as { content: string }).content}]`;
  if (b.type === "image") throw new Error("CliGateway: image blocks are not supported; write eval fixtures as text");
  return "";
};
const transcript = (ms: Message[]) =>
  ms.length === 1 && ms[0]?.role === "user"
    ? typeof ms[0].content === "string" ? ms[0].content : ms[0].content.map(blockText).join("\n\n")
    : ms.map((m) => `${m.role === "user" ? "User" : "Assistant"}:\n${typeof m.content === "string" ? m.content : m.content.map(blockText).join("\n\n")}`).join("\n\n");

export class CliGateway implements ClaudeGateway {
  private running = 0;
  private waiting: (() => void)[] = [];
  private cwd = mkdtempSync(join(tmpdir(), "shalav-eval-"));
  calls = 0;
  costUsd = 0;

  async send(req: ClaudeRequest): Promise<ClaudeResponse> {
    while (this.running >= MAX_PROCS) await new Promise<void>((r) => this.waiting.push(r));
    this.running++;
    try {
      return await this.run(req);
    } finally {
      this.running--;
      this.waiting.shift()?.();
    }
  }

  private run(req: ClaudeRequest): Promise<ClaudeResponse> {
    const forced = req.toolChoice?.type === "tool" ? req.toolChoice.name : undefined;
    const tool = req.tools?.find((t): t is ToolDef => "input_schema" in t && (!forced || t.name === forced));
    const args = ["-p", "--safe-mode", "--strict-mcp-config", "--no-session-persistence", "--output-format", "json", "--tools", "", "--system-prompt", req.system];
    if (tool) args.push("--json-schema", JSON.stringify(tool.input_schema));
    this.calls++;
    return new Promise((resolve, reject) => {
      const p = spawn("claude", args, { cwd: this.cwd, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (err += d));
      req.signal?.addEventListener("abort", () => p.kill(), { once: true });
      p.on("error", reject);
      p.on("close", (code) => {
        try {
          const d = JSON.parse(out) as { is_error: boolean; result?: string; structured_output?: unknown; total_cost_usd?: number; usage?: Record<string, number>; modelUsage?: Record<string, unknown> };
          if (d.is_error) throw new Error(d.result ?? "claude -p failed");
          this.costUsd += d.total_cost_usd ?? 0;
          const u = d.usage ?? {};
          resolve({
            content: tool ? [{ type: "tool_use", id: `cli_${this.calls}`, name: tool.name, input: d.structured_output }] : [{ type: "text", text: d.result ?? "" }],
            stopReason: tool ? "tool_use" : "end_turn",
            usage: { input_tokens: u.input_tokens ?? 0, output_tokens: u.output_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0, cache_read_input_tokens: u.cache_read_input_tokens ?? 0 },
            model: Object.keys(d.modelUsage ?? {})[0] ?? "claude-cli",
          });
        } catch (e) {
          reject(new Error(`claude -p (exit ${code}): ${e instanceof Error ? e.message : e}\n${err.slice(0, 500)}`));
        }
      });
      p.stdin.end(transcript(req.messages));
    });
  }
}
