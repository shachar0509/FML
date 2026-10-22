// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { callStructured } from "@/core/claude/structured";
import { defineTool } from "@/core/claude/tools";
import { BridgeGateway, STOPPED, type Content } from "./bridge";

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
    const both = text(b.next()); // one call hands out both jobs
    expect(both).toContain("2 jobs are ready: #1, #2");
    expect(both).toContain("SYS");
    expect(both).toContain("Same instructions as job #1");
    expect(both).toContain("same JSON schema as job #1"); // shown just before: not repeated
    expect(both.split('"properties"')).toHaveLength(2);
    expect(text(b.next())).toContain("No Shalav job");
    expect((await b.submit({ jobId: 99, input: {} })).isError).toBe(true);
    expect((await b.submit({ jobId: 1, text: "x" })).isError).toBe(true); // schema job needs input
    await b.submit({ jobId: 1, input: { n: 1 } });
    const last = await b.submit({ jobId: 2, input: { n: 2 } });
    expect(text(last.content)).toBe("Done.");
    expect((await done).map((v) => v.value.n)).toEqual([1, 2]);
  });

  it("dedupe is per operation: a later op (maybe a new chat) gets the full instructions", async () => {
    const b = new BridgeGateway();
    b.run("op1", () => b.send(req));
    await new Promise((r) => setImmediate(r));
    await b.submit({ jobId: idOf(b.next()), text: "x" });
    b.run("op2", () => b.send(req));
    await new Promise((r) => setImmediate(r));
    const j = text(b.next());
    expect(j).toContain("SYS");
    expect(j).not.toContain("Same");
  });

  it("the schema is repeated once another kind of job came in between", async () => {
    const b = new BridgeGateway();
    b.run("op", () => Promise.all([callStructured(b, tool, req), b.send({ ...req, system: "S2" }), callStructured(b, tool, req)]));
    await new Promise((r) => setImmediate(r));
    expect(text(b.next()).split('"properties"')).toHaveLength(3); // jobs 1 and 3 both show it
  });

  it("hands out up to 3 jobs per call, fewer when the images are big; parallel submits get distinct jobs", async () => {
    const b = new BridgeGateway();
    const img = (kb: number) => ({ ...req, messages: [{ role: "user" as const, content: [{ type: "image" as const, source: { type: "base64", media_type: "image/png", data: "A".repeat(kb * 1000) } }] }] });
    const { done } = b.run("op", () => Promise.all([1, 2, 3, 4, 5].map(() => callStructured(b, tool, req))));
    await new Promise((r) => setImmediate(r));
    const first = text(b.next());
    expect(first).toContain("3 jobs are ready: #1, #2, #3");
    const [r1, r2] = await Promise.all([b.submit({ jobId: 1, input: { n: 1 } }), b.submit({ jobId: 2, input: { n: 2 } })]);
    const both = text(r1.content) + text(r2.content);
    for (const id of [4, 5]) expect(both.split(`# Shalav job #${id} `)).toHaveLength(2); // each handed out once
    for (const id of [3, 4, 5]) await b.submit({ jobId: id, input: { n: id } }).catch(() => undefined);
    await done;

    const big = new BridgeGateway();
    big.run("op", () => Promise.all([big.send(img(1000)), big.send(img(1000))]));
    await new Promise((r) => setImmediate(r));
    expect(text(big.next())).not.toContain("jobs are ready"); // 2 MB of images: one job only
    expect(big.pending()).toBe(1);
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

it("build lane: a chat whose build is waiting gets another course's job; it never hears 'no build work' while one runs", async () => {
  const b = new BridgeGateway();
  let release!: () => void;
  const hold = new Promise<void>((r) => (release = r));
  // A: one job, then waits (e.g. for an index queue slot) before its next one
  const a = b.run("A", async () => {
    await b.send(req);
    await hold;
    return b.send(req);
  }, undefined, "build");
  const ja = await b.nextWait("build");
  // B is pressed meanwhile and queues a job
  const bb = b.run("B", () => callStructured(b, tool, { ...req, system: "SYS B" }), undefined, "build");
  await new Promise((r) => setTimeout(r, 10));
  expect(text(await b.nextWait("study"))).toContain("No Shalav job"); // another chat never gets build jobs
  // answering A's job hands out B's job at once (no 45 s wait for A)
  const t0 = Date.now();
  const r = await b.submit({ jobId: idOf(ja), text: "a1" });
  expect(Date.now() - t0).toBeLessThan(1000);
  expect(text(r.content)).toContain("(B)");
  expect(text(r.content)).toContain("JSON schema (tool submit_x)"); // the schema is shown: the job before it in this lane had none
  // A still running, nothing queued: keep calling, not "no build work"
  await b.submit({ jobId: idOf(r.content), input: { n: 1 } });
  await bb.done;
  expect(text(b.next("build"))).toContain("still running");
  release();
  const last = await b.nextWait("build");
  expect(text(last)).toContain("(A)");
  await b.submit({ jobId: idOf(last), text: "a2" });
  await a.done;
  expect(text(b.next("build"))).toContain("No build work is pending");
});

describe("abandoned jobs end (the card's spinner must stop)", () => {
  const MIN = 60_000;
  let now = 1_000_000;
  const at = (min: number) => (now = 1_000_000 + min * MIN);
  beforeEach(() => void vi.spyOn(Date, "now").mockImplementation(() => now));
  afterEach(() => vi.restoreAllMocks());
  const tick = () => new Promise((r) => setImmediate(r));

  it("a queued job nobody fetched is stopped after 5 idle minutes, not before", async () => {
    at(0);
    const b = new BridgeGateway();
    const { done } = b.run("op", () => b.send(req), undefined, "study", "web:1");
    done.catch(() => {});
    await tick();
    b.sweep(at(4));
    expect(b.pending()).toBe(1);
    b.sweep(at(6));
    await expect(done).rejects.toMatchObject({ kind: "aborted", message: STOPPED });
    expect(b.pending()).toBe(0);
  });

  it("never stops a job the chat is answering, nor a lane the chat keeps working in", async () => {
    at(0);
    const b = new BridgeGateway();
    const { done } = b.run("op", async () => {
      await Promise.all([b.send(req), b.send(req), b.send(req), b.send(req)]); // 4: one stays queued after the first next()
      for (let i = 0; i < 4; i++) await b.send(req);
    });
    await tick();
    b.next(); // 3 shown, 1 queued: Claude is writing the answers
    b.sweep(at(20));
    expect(b.pending()).toBe(1);
    // the chat answers one job every 4 minutes for a long while
    let id = 1;
    for (let m = 24; id <= 4; m += 4, id++) {
      at(m);
      void b.submit({ jobId: id, text: "x" });
      await tick();
      b.sweep(at(m + 3));
    }
    for (let m = 40; m < 60; m += 4) {
      at(m);
      const c = b.next();
      const j = idOf(c);
      if (!j) break;
      void b.submit({ jobId: j, text: "x" });
      await tick();
      b.sweep(at(m + 3));
    }
    await expect(done).resolves.toBeUndefined();
  });

  it("an op doing non-AI work (no jobs) is never stopped", async () => {
    at(0);
    const b = new BridgeGateway();
    let release!: () => void;
    const { done } = b.run("pdf", () => new Promise<void>((r) => (release = r)));
    b.sweep(at(30));
    release();
    await expect(done).resolves.toBeUndefined();
  });

  it("practice prefetch: waits while the student thinks; stopped only once a new op waits on it unserved", async () => {
    at(0);
    const b = new BridgeGateway();
    let prefetch!: Promise<unknown>;
    const first = b.run("advance", async () => void (prefetch = b.send(req).catch((e) => e)), undefined, "study", "practice:1");
    await first.done;
    b.sweep(at(10)); // the student is thinking; no op waits
    expect(b.pending()).toBe(1);
    at(11);
    const next = b.run("advance", () => prefetch, undefined, "study", "practice:1"); // Next pressed, no chat serves it
    b.sweep(at(15));
    expect(b.pending()).toBe(1);
    b.sweep(at(17));
    expect(await next.done).toMatchObject({ message: STOPPED });
  });

  it("a shown job: handed out again after 2 silent minutes (Nudge), stopped only after 30", async () => {
    at(0);
    const b = new BridgeGateway();
    const { done } = b.run("op", () => b.send(req));
    done.catch(() => {});
    await tick();
    const id = idOf(b.next());
    at(1);
    expect(text(b.next())).toContain("No Shalav job");
    at(4);
    expect(idOf(b.next())).toBe(id); // the chat that had it was stopped mid-answer
    b.sweep(at(20));
    expect(b.jobLane(id)).toBe("study");
    b.sweep(at(35));
    await expect(done).rejects.toMatchObject({ message: STOPPED });
  });

  it("cancelKey stops the card's op; others keep going", async () => {
    at(0);
    const b = new BridgeGateway();
    const web = b.run("web", () => b.send(req), undefined, "study", "web:1");
    const tr = b.run("tr", () => b.send(req), undefined, "study", "translate:1");
    web.done.catch(() => {});
    await tick();
    b.cancelKey("web:1");
    await expect(web.done).rejects.toMatchObject({ message: STOPPED });
    expect(b.pending()).toBe(1);
    void tr;
  });

  it("host cancel during submit stops the op; an abort after the call returned does nothing", async () => {
    at(0);
    const b = new BridgeGateway();
    let gate!: () => void;
    const { done } = b.run("op", async () => {
      await b.send(req);
      await new Promise<void>((r) => (gate = r)); // the op works on before its next job
      await b.send(req);
    });
    done.catch(() => {});
    await tick();
    const ctl = new AbortController();
    const r = b.submit({ jobId: idOf(b.next()), text: "x" }, ctl.signal);
    await tick();
    ctl.abort();
    gate();
    expect((await r).isError).toBe(true);
    await expect(done).rejects.toMatchObject({ message: STOPPED });

    const late = new AbortController();
    const ok = b.run("op2", async () => (await b.send(req), await b.send(req)));
    await tick();
    const r2 = await b.submit({ jobId: idOf(b.next()), text: "x" }, late.signal);
    expect(text(r2.content)).toContain("Next job is ready");
    late.abort();
    await b.submit({ jobId: idOf(r2.content), text: "y" });
    await expect(ok.done).resolves.toBeTruthy();
  });

  it("host cancel while next_job waits stops the lane's waiting ops", async () => {
    at(0);
    const b = new BridgeGateway();
    let gate!: () => void;
    const { done } = b.run("op", async () => (await new Promise<void>((r) => (gate = r)), b.send(req)));
    done.catch(() => {});
    const ctl = new AbortController();
    const w = b.nextWait("study", ctl.signal);
    await tick();
    ctl.abort();
    gate();
    await expect(done).rejects.toMatchObject({ message: STOPPED });
    expect(text(await w)).toContain("No Shalav job");
  });
});
