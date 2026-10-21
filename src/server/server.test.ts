// @vitest-environment node
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import { initNode } from "./platform";
import { createServer } from "./server";

it("lists tools/prompts and calls shalav_home", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html>cards</html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  expect(client.getInstructions()).toMatch(/shalav_next_job/);
  expect((await client.listTools()).tools.map((t) => t.name)).toEqual(expect.arrayContaining(["shalav_home", "shalav_next_job", "shalav_submit_job"]));
  const nj = await client.callTool({ name: "shalav_next_job", arguments: {} });
  expect(JSON.stringify(nj.content)).toContain("No Shalav job");
  // card requests (M15): queued by the card, handed to the model by shalav_next_job
  expect((await client.callTool({ name: "shalav_request", arguments: { kind: "learn", stageId: "S003", title: "Squeeze" } })).isError).toBeFalsy();
  expect((await client.callTool({ name: "shalav_request", arguments: { kind: "answer", text: "B) 1/n" } })).isError).toBeFalsy();
  expect((await client.callTool({ name: "shalav_request", arguments: { kind: "hack", text: "x" } })).isError).toBe(true);
  // only the newest click counts: an unfetched older one belongs to a card already gone (it made answers lag behind)
  const r1 = JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content);
  expect(r1).toContain("B) 1/n");
  expect(r1).not.toMatch(/S003|call shalav_next_job again/);
  await client.callTool({ name: "shalav_request", arguments: { kind: "step", action: "question", text: "why 0+0=0?" } });
  expect(JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content)).toMatch(/asked about the lesson step on screen.*why 0\+0=0\?.*answer_question/);
  expect(JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content)).toContain("No Shalav job");
  // an answer solved on paper: the uploaded photo reaches the model as an image next to the request
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
  const up = (await client.callTool({ name: "attachment_upload", arguments: { number: "01040195", name: "p.png", mime: "image/png", base64: PNG } })).structuredContent as { files: { sha256: string }[] };
  expect((await client.callTool({ name: "shalav_request", arguments: { kind: "answer", text: " " } })).isError).toBe(true); // neither text nor files
  await client.callTool({ name: "shalav_request", arguments: { kind: "answer", text: "", number: "01040195", files: up.files.map((f) => f.sha256) } });
  const paper = (await client.callTool({ name: "shalav_next_job", arguments: {} })).content as { type: string; text?: string; mimeType?: string }[];
  expect(paper[0]?.text).toMatch(/1 page image\(s\) of their handwritten solution/);
  expect(paper[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
  const bad = await client.callTool({ name: "shalav_submit_job", arguments: { jobId: 5, text: "x" } });
  expect(bad.isError).toBe(true);
  expect((await client.listPrompts()).prompts.map((p) => p.title)).toEqual(["Shalav: my courses", "Shalav: continue learning"]);
  const first = await client.callTool({ name: "shalav_home", arguments: {} });
  expect(first.structuredContent).toMatchObject({ view: "home", university: null, courses: [] });
  expect(JSON.stringify(first.content)).toMatch(/shalav_choose_university/);
  // the choice is written once and then locked
  const picked = await client.callTool({ name: "shalav_choose_university", arguments: { university: "huji" } });
  expect(picked.structuredContent).toMatchObject({ university: "huji" });
  expect((await client.callTool({ name: "shalav_choose_university", arguments: { university: "huji" } })).isError).toBeFalsy();
  const locked = await client.callTool({ name: "shalav_choose_university", arguments: { university: "technion" } });
  expect(locked.isError).toBe(true);
  expect(JSON.stringify(locked.content)).toMatch(/locked/);
  // other universities have no catalog: lookup goes straight to manual entry, ids are normalised loosely
  const look = await client.callTool({ name: "course_lookup", arguments: { number: " 80 131 " } });
  expect(look.structuredContent).toMatchObject({ status: "manual", number: "80131" });
  expect((await client.callTool({ name: "course_lookup", arguments: { number: "a/b" } })).structuredContent).toMatchObject({ status: "invalid" });
  const r = await client.callTool({ name: "shalav_home", arguments: {} });
  expect(JSON.stringify(r.content)).toMatch(/No courses yet/);
  expect(r.structuredContent).toMatchObject({ view: "home", university: "huji", courses: [] });
  const home = (await client.listTools()).tools.find((t) => t.name === "shalav_home");
  expect(home?._meta).toMatchObject({ ui: { resourceUri: "ui://shalav/cards.html" } });
  expect((await client.listResources()).resources.map((x) => x.uri)).toContain("ui://shalav/cards.html");
  const html = await client.readResource({ uri: "ui://shalav/cards.html" });
  expect(html.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
  // one card on screen (M31): a card claims the number of the result it was created with; mounting an older card again
  // (or a card's own Back call) never outranks the newest card
  const num = async (name: string) => ((await client.callTool({ name, arguments: {} })).structuredContent as { card: number }).card;
  const latest = async (card?: number) => ((await client.callTool({ name: "shalav_card", arguments: { claim: card !== undefined, ...(card ? { card } : {}) } })).structuredContent as { latest: number }).latest;
  const older = await num("shalav_home");
  const newer = await num("shalav_home");
  expect(newer).toBeGreaterThan(older);
  expect(await latest(newer)).toBe(newer);
  expect(await latest(older)).toBe(newer); // the older card mounted again: still older
  await num("shalav_home"); // the newest card's own call (Back): its result is not a new card
  expect(await latest()).toBe(newer);
});
