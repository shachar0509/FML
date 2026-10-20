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
  const bad = await client.callTool({ name: "shalav_submit_job", arguments: { jobId: 5, text: "x" } });
  expect(bad.isError).toBe(true);
  expect((await client.listPrompts()).prompts.map((p) => p.title)).toEqual(["Shalav: my courses", "Shalav: continue learning"]);
  const r = await client.callTool({ name: "shalav_home", arguments: {} });
  expect(JSON.stringify(r.content)).toMatch(/No courses yet/);
  expect(r.structuredContent).toMatchObject({ view: "home", courses: [] });
  const home = (await client.listTools()).tools.find((t) => t.name === "shalav_home");
  expect(home?._meta).toMatchObject({ ui: { resourceUri: "ui://shalav/cards.html" } });
  expect((await client.listResources()).resources.map((x) => x.uri)).toContain("ui://shalav/cards.html");
  const html = await client.readResource({ uri: "ui://shalav/cards.html" });
  expect(html.contents[0]).toMatchObject({ mimeType: "text/html;profile=mcp-app" });
});
