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
  const r1 = JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content);
  expect(r1).toMatch(/shalav_start_lesson with stageId S003/);
  expect(r1).toMatch(/call shalav_next_job again/);
  expect(JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content)).toContain("B) 1/n");
  await client.callTool({ name: "shalav_request", arguments: { kind: "step", action: "question", text: "why 0+0=0?" } });
  expect(JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content)).toMatch(/asked about the last lesson step.*why 0\+0=0\?/);
  expect(JSON.stringify((await client.callTool({ name: "shalav_next_job", arguments: {} })).content)).toContain("No Shalav job");
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
});
