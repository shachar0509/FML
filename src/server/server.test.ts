// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
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
  await initNode();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer().connect(a), client.connect(b)]);
  expect(client.getInstructions()).toMatch(/shalav_next_job/);
  expect((await client.listTools()).tools.map((t) => t.name)).toContain("shalav_home");
  expect((await client.listPrompts()).prompts.map((p) => p.title)).toEqual(["Shalav: my courses", "Shalav: continue learning"]);
  const r = await client.callTool({ name: "shalav_home", arguments: {} });
  expect(JSON.stringify(r.content)).toMatch(/No courses yet/);
});
