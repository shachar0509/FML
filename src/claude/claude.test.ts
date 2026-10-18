import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { applyCaching } from "./cache";
import { ClaudeError } from "./errors";
import { FakeClaudeGateway, toolCall, usage0 } from "./fake";
import { createGateway, type Transport } from "./gateway";
import { modelCatalog, pickAvailable, resolveModel } from "./models";
import { callStructured } from "./structured";
import { defineTool, submitRetrieval } from "./tools";
import type { ClaudeRequest, ClaudeResponse } from "./types";
import { capState, costUsd, summarizeMonth } from "@/domain/usage/usage";

const ok = (text = "hi"): ClaudeResponse => ({
  content: [{ type: "text", text }],
  stopReason: "end_turn",
  usage: { ...usage0, input_tokens: 5 },
  model: "claude-sonnet-5-5",
});
const req = (o: Partial<ClaudeRequest> = {}): ClaudeRequest => ({
  task: "ask",
  system: "sys",
  messages: [{ role: "user", content: "q" }],
  ...o,
});
const httpErr = (status: number, message = "x") => Object.assign(new Error(message), { status });
const gw = (transport: Transport, extra = {}) =>
  createGateway({ transport, settings: () => ({ models: {} }), sleep: async () => {}, random: () => 0, ...extra });

describe("models", () => {
  it("resolves override, then default", () => {
    expect(resolveModel("plan", { models: {} })).toBe("claude-opus-5-5");
    expect(resolveModel("plan", { models: { plan: "m" } })).toBe("m");
  });
  it("falls back to the newest same-family model", () => {
    expect(pickAvailable("claude-opus-5-5", ["claude-sonnet-6", "claude-opus-6", "claude-opus-5"])).toEqual({
      model: "claude-opus-6",
      substituted: true,
    });
    expect(pickAvailable("claude-opus-5-5", ["claude-opus-5-5"]).substituted).toBe(false);
  });
  it("caches the model list for 24 h", async () => {
    let t = 0;
    const f = vi.fn(async () => ["a"]);
    const get = modelCatalog(f, () => t);
    await get();
    t = 3600_000;
    await get();
    expect(f).toHaveBeenCalledTimes(1);
    t = 25 * 3600_000;
    await get();
    expect(f).toHaveBeenCalledTimes(2);
  });
});

describe("cache breakpoints", () => {
  const msgs = [
    { role: "user" as const, content: "a" },
    { role: "assistant" as const, content: "b" },
    { role: "user" as const, content: "c" },
  ];
  it("marks last tool, system and last assistant block; does not mutate input", () => {
    const tools = [submitRetrieval.def, { ...submitRetrieval.def, name: "z" }];
    const r = applyCaching({ system: "s", tools, messages: msgs }, { conversation: true, ttl1h: true });
    expect(r.tools?.[1]).toMatchObject({ cache_control: { type: "ephemeral", ttl: "1h" } });
    expect(r.tools?.[0]).not.toHaveProperty("cache_control");
    expect(r.system[0]?.cache_control.ttl).toBe("1h");
    expect(r.messages[1]?.content).toEqual([{ type: "text", text: "b", cache_control: { type: "ephemeral", ttl: "1h" } }]);
    expect(msgs[1]?.content).toBe("b");
  });
});

describe("gateway", () => {
  it("retries retryable errors with backoff then succeeds", async () => {
    const sleeps: number[] = [];
    const t = vi.fn<Transport>().mockRejectedValueOnce(httpErr(529)).mockRejectedValueOnce(httpErr(429)).mockResolvedValue(ok());
    const g = gw(t, { sleep: async (ms: number) => void sleeps.push(ms) });
    await g.send(req());
    expect(sleeps).toEqual([1000, 2000]);
  });
  it("gives up after 4 retries; 400 never retries", async () => {
    const t = vi.fn<Transport>().mockRejectedValue(httpErr(503));
    await expect(gw(t).send(req())).rejects.toMatchObject({ kind: "retryable" });
    expect(t).toHaveBeenCalledTimes(5);
    const b = vi.fn<Transport>().mockRejectedValue(httpErr(400, "bad"));
    await expect(gw(b).send(req())).rejects.toMatchObject({ kind: "bad_request" });
    expect(b).toHaveBeenCalledTimes(1);
  });
  it("401 calls onAuthError", async () => {
    const onAuthError = vi.fn();
    await expect(gw(vi.fn<Transport>().mockRejectedValue(httpErr(401)), { onAuthError }).send(req())).rejects.toBeInstanceOf(ClaudeError);
    expect(onAuthError).toHaveBeenCalled();
  });
  it("remembers a thinking rejection and retries without it", async () => {
    const t = vi.fn<Transport>().mockRejectedValueOnce(httpErr(400, "thinking is not supported")).mockResolvedValue(ok());
    await gw(t).send(req({ task: "grading", thinkingBudget: 8000 }));
    expect(t.mock.calls[0]?.[0].thinking).toBeDefined();
    expect(t.mock.calls[1]?.[0].thinking).toBeUndefined();
    await gw(t).send(req({ task: "grading", thinkingBudget: 8000 })); // new gateway = new session memory
    expect(t.mock.calls[2]?.[0].max_tokens).toBe(16000);
  });
  it("retries without ttl when the API rejects it", async () => {
    const t = vi.fn<Transport>().mockRejectedValueOnce(httpErr(400, "invalid ttl")).mockResolvedValue(ok());
    await gw(t).send(req({ task: "tutor" }));
    expect(JSON.stringify(t.mock.calls[0]?.[0])).toContain('"ttl":"1h"');
    expect(JSON.stringify(t.mock.calls[1]?.[0])).not.toContain("ttl");
  });
  it("413 re-encodes images once", async () => {
    const shrinkImages = vi.fn(async (m) => m);
    const t = vi.fn<Transport>().mockRejectedValueOnce(httpErr(413)).mockResolvedValue(ok());
    await gw(t, { shrinkImages }).send(req());
    expect(shrinkImages).toHaveBeenCalledTimes(1);
  });
  it("logs usage and honours the cap gate", async () => {
    const onUsage = vi.fn();
    await gw(vi.fn<Transport>().mockResolvedValue(ok()), { onUsage }).send(req({ courseNumber: "094412" }));
    expect(onUsage.mock.calls[0]?.[0]).toMatchObject({ task: "ask", courseNumber: "094412", input_tokens: 5 });
    const beforeRequest = async () => {
      throw new ClaudeError("cap_stopped", "stop");
    };
    await expect(gw(vi.fn<Transport>(), { beforeRequest }).send(req())).rejects.toMatchObject({ kind: "cap_stopped" });
  });
  it("limits concurrency to 3 and lets the tutor jump the queue", async () => {
    const order: string[] = [];
    const gates: (() => void)[] = [];
    const t: Transport = (p) =>
      new Promise((res) => {
        order.push(p.max_tokens === 4096 ? "tutor" : String(p.max_tokens));
        gates.push(() => res(ok()));
      });
    const g = gw(t);
    const ps = [req(), req(), req(), req({ task: "hint" }), req({ task: "tutor" })].map((r) => g.send(r));
    await vi.waitFor(() => expect(order).toHaveLength(3));
    gates.shift()?.();
    await vi.waitFor(() => expect(order).toHaveLength(4));
    expect(order[3]).toBe("tutor");
    while (gates.length || order.length < 5) {
      gates.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    }
    await Promise.all(ps);
  });
  it("aborts on idle timeout and retries", async () => {
    let n = 0;
    const t: Transport = (_p, { signal }) =>
      ++n === 1 ? new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("AbortError")))) : Promise.resolve(ok());
    await gw(t, { idleMs: 10 }).send(req());
    expect(n).toBe(2);
  });
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

describe("usage", () => {
  const e = { ts: "2026-10-05T10:00:00Z", task: "tutor", model: "m", courseNumber: "1", input_tokens: 1e6, output_tokens: 1e6, cache_creation_input_tokens: 0, cache_read_input_tokens: 1e6 };
  const pricing = { m: { inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 2, cacheReadPerMTok: 0.1 } };
  it("costs, summarizes, caps", () => {
    expect(costUsd(e, pricing)).toBeCloseTo(6.1);
    expect(costUsd({ ...e, model: "unknown" }, pricing)).toBeUndefined();
    const s = summarizeMonth([e, { ...e, ts: "2025-01-01T00:00:00Z" }], "2026-10", pricing);
    expect(s.total.usd).toBeCloseTo(6.1);
    expect(s.byTask.tutor?.input).toBe(1e6);
    expect(s.cacheShare).toBeCloseTo(0.5);
    expect([capState(1, null), capState(8, 10), capState(10, 10)]).toEqual(["ok", "warn", "stop"]);
  });
});
