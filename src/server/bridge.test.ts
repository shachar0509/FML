// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as z from "zod";
import { callStructured } from "@/claude/structured";
import { defineTool } from "@/claude/tools";
import { BridgeGateway, type Content } from "./bridge";

const tool = defineTool("submit_x", "x", z.object({ n: z.number() }));
const req = { task: "plan" as const, system: "SYS", messages: [{ role: "user" as const, content: "do it" }] };
const text = (c: Content[]) => c.map((x) => (x.type === "text" ? x.text : "[img]")).join("\n");
const idOf = (c: Content[]) => Number(/job #(\d+)/.exec(text(c))?.[1]);

describe("BridgeGateway", () => {
  it("callStructured with a correction round", async () => {
    const b = new BridgeGateway();
    const { opId, done } = b.run("op", () => callStructured(b, tool, req), () => [{ type: "text", text: "FINAL" }]);
    expect(opId).toBe(1);
    await new Promise((r) => setImmediate(r));
    const j1 = b.next();
    expect(text(j1)).toContain("SYS");
    expect(text(j1)).toContain("submit_x");
    const id1 = idOf(j1);
    const r1 = await b.submit({ jobId: id1, input: { n: "bad" } });
    expect(text(r1.content)).toContain("Next job is ready");
    expect(text(r1.content)).toContain(`continues job #${id1}`);
    expect(text(r1.content)).toContain("Fix these problems");
    expect(text(r1.content)).not.toContain("SYS");
    const r2 = await b.submit({ jobId: id1 + 1, input: { n: 3 } });
    expect(text(r2.content)).toBe("FINAL");
    expect((await done).value).toEqual({ n: 3 });
  });

  it("two parallel jobs, dedupe, wrong submit", async () => {
    const b = new BridgeGateway();
    const { done } = b.run("op", () => Promise.all([callStructured(b, tool, req), callStructured(b, tool, req)]));
    await new Promise((r) => setImmediate(r));
    expect(b.pending()).toBe(2);
    const a = b.next();
    const c = b.next();
    expect(text(a)).toContain("SYS");
    expect(text(c)).toContain("Same instructions as job #1");
    expect((await b.submit({ jobId: 99, input: {} })).isError).toBe(true);
    expect((await b.submit({ jobId: 1, text: "x" })).isError).toBe(true); // schema job needs input
    await b.submit({ jobId: 1, input: { n: 1 } });
    const last = await b.submit({ jobId: 2, input: { n: 2 } });
    expect(text(last.content)).toBe("Done.");
    expect((await done).map((v) => v.value.n)).toEqual([1, 2]);
  });

  it("cancel rejects every job of the operation", async () => {
    const b = new BridgeGateway();
    const { opId, done } = b.run("op", () => Promise.all([b.send(req), b.send(req)]));
    await new Promise((r) => setImmediate(r));
    b.cancel(opId);
    await expect(done).rejects.toMatchObject({ kind: "aborted" });
    expect(text(b.next())).toContain("No Shalav job");
  });

  it("request signal aborts, plain text job, operation error is reported", async () => {
    const b = new BridgeGateway();
    const ctl = new AbortController();
    const p = b.send({ ...req, signal: ctl.signal });
    ctl.abort();
    await expect(p).rejects.toMatchObject({ kind: "aborted" });

    const t = b.run("op", async () => (await b.send(req)).content[0]);
    await new Promise((r) => setImmediate(r));
    expect(text(b.next())).toContain('"text"');
    const fin = await b.submit({ jobId: 2, text: "hi" });
    expect(text(fin.content)).toBe("Done.");
    expect(await t.done).toEqual({ type: "text", text: "hi" });

    const bad = b.run("boom", async () => {
      await b.send(req);
      throw new Error("nope");
    });
    bad.done.catch(() => {});
    await new Promise((r) => setImmediate(r));
    b.next();
    const e = await b.submit({ jobId: 3, text: "x" });
    expect(e.isError).toBe(true);
    expect(text(e.content)).toContain("nope");
  });

  it("image job becomes MCP image content", async () => {
    const b = new BridgeGateway();
    void b.send({
      ...req,
      messages: [{ role: "user", content: [{ type: "text", text: "look" }, { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } }] }],
    });
    const c = b.next();
    expect(c.find((x) => x.type === "image")).toEqual({ type: "image", data: "AAAA", mimeType: "image/jpeg" });
    expect(text(c)).toContain("look");
  });
});

it("nextWait waits for a running operation's first request", async () => {
  const b = new BridgeGateway();
  expect(text(await b.nextWait())).toContain("No Shalav job");
  const { done } = b.run("op", async () => {
    await new Promise((r) => setTimeout(r, 30));
    return b.send(req);
  });
  expect(text(await b.nextWait())).toContain("do it");
  await b.submit({ jobId: 1, text: "ok" });
  await done;
});
