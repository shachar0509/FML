/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionLine } from "@/domain/dataSchemas";
import { FakeClaudeGateway } from "@/claude/fake";
import { setDeviceId } from "@/lib/device";
import { setFs } from "@/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { buildMessages, compactIfNeeded, estimateTokens, resumePrefix } from "./context";
import { appendLine, lastActivityTs, loadSession } from "./session";

let n = 0;
const msg = (role: "user" | "assistant", content: object[], id = `m${String(n++).padStart(3, "0")}`): SessionLine =>
  ({ kind: "message", id, ts: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`, deviceId: "d", role, content }) as SessionLine;
const img = { type: "image_ref", sha256: "h", mediaType: "image/png" };
const loadImage = async () => "B64";
const blocks = (m: { content: unknown }) => m.content as { type: string; text?: string; content?: string }[];
beforeEach(() => { n = 0; });

describe("buildMessages", () => {
  it("images only in newest user message; status only on newest", async () => {
    const lines = [msg("user", [img, { type: "text", text: "a" }]), msg("assistant", [{ type: "text", text: "r" }]), msg("user", [img])];
    const m = await buildMessages({ lines, statusText: "[STATUS]", hiddenPrefix: "[START_LESSON]", loadImage });
    expect(blocks(m[0]!)[0]).toEqual({ type: "text", text: "[image: student's attachment, already evaluated]" });
    expect(JSON.stringify(m[0])).not.toContain("STATUS");
    expect(blocks(m[2]!).map((b) => b.type)).toEqual(["text", "text", "image"]);
    expect(blocks(m[2]!)[0]!.text).toBe("[STATUS]");
  });
  it("ephemeral result: full only when in last user message; status goes after tool_result", async () => {
    const lines = [
      msg("assistant", [{ type: "tool_use", id: "t", name: "consult_materials", input: {} }]),
      msg("user", [{ type: "tool_result", tool_use_id: "t", content: "FULL", ephemeral: true, stub: "STUB", is_error: false }]),
    ];
    let m = await buildMessages({ lines, statusText: "[S]", loadImage });
    expect(blocks(m[1]!).map((b) => b.type)).toEqual(["tool_result", "text"]);
    expect(blocks(m[1]!)[0]!.content).toBe("FULL");
    expect(JSON.stringify(m)).not.toContain("ephemeral");
    m = await buildMessages({ lines: [...lines, msg("assistant", [{ type: "text", text: "x" }]), msg("user", [{ type: "text", text: "y" }])], loadImage });
    expect(blocks(m[1]!)[0]!.content).toBe("STUB");
  });
  it("honours summary: summary first, only later messages", async () => {
    const a = msg("user", [{ type: "text", text: "old" }]);
    const lines = [a, msg("assistant", [{ type: "text", text: "old2" }]), { kind: "summary", id: "s", ts: "2026-01-01T01:00:00Z", deviceId: "d", coversThroughId: "m001", text: "SUM" } as SessionLine, msg("user", [{ type: "text", text: "new" }])];
    const m = await buildMessages({ lines, loadImage });
    expect(m.map((x) => blocks(x)[0]!.text)).toEqual(["SUM", "new"]);
  });
  it("resumePrefix and estimateTokens", () => {
    expect(resumePrefix("2026-01-01T00:00:00Z", "2026-01-01T07:00:00Z")).toBe("[RESUME after 7 hours: recap in 2-3 sentences where we stopped, then continue]");
    expect(resumePrefix("2026-01-01T00:00:00Z", "2026-01-01T05:00:00Z")).toBeNull();
    expect(estimateTokens([{ role: "user", content: [{ type: "text", text: "x".repeat(350) }, { type: "image", source: { type: "base64", media_type: "image/png", data: "" } }] }])).toBe(1700);
  });
});

describe("session + compaction", () => {
  beforeEach(() => {
    setFs(memFs());
    useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
  });
  it("merges two device files", async () => {
    setDeviceId("devA");
    await appendLine("C", "S001", { kind: "message", role: "user", content: [{ type: "text", text: "1" }] });
    setDeviceId("devB");
    await appendLine("C", "S001", { kind: "message", role: "assistant", content: [{ type: "text", text: "2" }] });
    const l = await loadSession("C", "S001");
    expect(l.map((x) => x.deviceId)).toEqual(["devA", "devB"]);
    expect(lastActivityTs(l)).toBe(l[1]!.ts);
  });
  it("compacts without splitting a tool pair", async () => {
    setDeviceId("devA");
    const big = "x".repeat(20_000);
    const lines: SessionLine[] = [];
    for (let i = 0; i < 12; i++) lines.push(msg(i % 2 ? "assistant" : "user", [{ type: "text", text: big }]));
    // keep window starts (index 12-10=2) must not be a tool_result: make index 2 a tool_result whose tool_use is index 1
    lines[1] = msg("assistant", [{ type: "tool_use", id: "t", name: "n", input: {} }]);
    lines[2] = msg("user", [{ type: "tool_result", tool_use_id: "t", content: big }]);
    const gw = new FakeClaudeGateway([{ content: [{ type: "text", text: "SUMMARY" }] }]);
    const s = await compactIfNeeded({ gw, course: "C", stageId: "S001", lines, lang: "English" });
    expect(s).toMatchObject({ kind: "summary", text: "SUMMARY", coversThroughId: lines[0]!.id });
    expect(gw.calls[0]!.task).toBe("summary");
    expect(await compactIfNeeded({ gw, course: "C", stageId: "S001", lines: lines.slice(0, 3), lang: "English" })).toBeNull();
  });
});
