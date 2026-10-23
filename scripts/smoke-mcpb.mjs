// Unpack dist/shalav.mcpb and talk to the server over stdio like Claude Desktop would. Fails (exit 1) on any problem.
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const dir = mkdtempSync(join(tmpdir(), "shalav-mcpb-"));
execFileSync("npx", ["mcpb", "unpack", "dist/shalav.mcpb", dir], { stdio: "inherit", shell: process.platform === "win32" });
const env = { ...process.env, SHALAV_CONFIG_DIR: join(dir, "cfg"), SHALAV_CACHE_DIR: join(dir, "cache"), SHALAV_DATA_FOLDER: join(dir, "data"), SHALAV_LANGUAGE: "en" };
const client = new Client({ name: "smoke", version: "0" });
await client.connect(new StdioClientTransport({ command: "node", args: [join(dir, "server/server.mjs")], env }));
const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };

const tools = (await client.listTools()).tools.map((t) => t.name);
ok(["shalav_home", "shalav_next_job", "shalav_submit_job", "shalav_settings"].every((n) => tools.includes(n)), `tools: ${tools}`);
const home = await client.callTool({ name: "shalav_home", arguments: {} });
ok(home.structuredContent?.view === "home" && home.structuredContent.language === "en", "home card data");
const card = await client.readResource({ uri: "ui://shalav/cards.html" });
ok(card.contents[0].text.includes("<html"), "cards.html resource");
const settings = await client.callTool({ name: "shalav_settings", arguments: {} });
ok(settings.structuredContent?.dataRoot === join(dir, "data"), "data folder from env");
// M79: TikZ is drawn by the bundled TeX engine (its files staged next to server.mjs), and the biology library resolves
const tikz = await client.callTool({ name: "figure_render", arguments: { kind: "tikz", source: "\\begin{circuitikz}\n\\draw (0,0) to[R, l=$R_1$] (2,0); % @1\n\\end{circuitikz}" } });
ok(!tikz.isError && /data-beat="1"/.test(tikz.structuredContent?.svg ?? ""), `tikz render: ${JSON.stringify(tikz).slice(0, 600)}`);
const bio = await client.callTool({ name: "figure_render", arguments: { kind: "bio", source: '<svg viewBox="0 0 9 9"><use href="#nucleus" width="9" height="9"/></svg>' } });
ok(!bio.isError && bio.structuredContent?.svg.includes('data-part="nucleus"'), "bio render");
// M80: Graphviz (WebAssembly inside the bundle) and Vega-Lite
const gv = await client.callTool({ name: "figure_render", arguments: { kind: "graphviz", source: "digraph {\n a -> b; // @1\n}" } });
ok(!gv.isError && /class="edge" data-beat="1"/.test(gv.structuredContent?.svg ?? ""), `graphviz render: ${JSON.stringify(gv).slice(0, 300)}`);
const vlt = await client.callTool({ name: "figure_render", arguments: { kind: "vegalite", source: JSON.stringify({ data: { values: [{ x: 1 }] }, mark: "point", encoding: { x: { field: "x", type: "quantitative" } } }) } });
ok(!vlt.isError && vlt.structuredContent?.svg.startsWith("<svg"), `vega-lite render: ${JSON.stringify(vlt).slice(0, 300)}`);
await client.close();
console.log(`smoke ok (${tools.length} tools)`);
