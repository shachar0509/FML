/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, usage0 } from "@/claude/fake";
import { setFs } from "@/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { AskThread, ASK_KEEP } from "./ask";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }], usage: usage0 });

beforeEach(() => {
  setFs(memFs());
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r", language: "en" } }));
});

describe("AskThread", () => {
  it("answers outside a course, keeps only the last 6 messages, resets", async () => {
    const gw = new FakeClaudeGateway(Array.from({ length: 5 }, (_, i) => text(`a${i}`)));
    const th = new AskThread(() => gw);
    for (let i = 0; i < 4; i++) await th.send(`q${i}`, { courseNumber: null, screen: "Home" });
    expect(th.messages).toHaveLength(8);
    const last = gw.calls[3]!;
    expect(last.task).toBe("ask");
    expect(last.tools).toBeUndefined();
    expect(last.messages.length).toBeLessThanOrEqual(ASK_KEEP);
    expect(last.messages[0]!.role).toBe("user");
    th.reset();
    expect(th.messages).toEqual([]);
  });
});
