// Stage the extension (manifest + bundled server + cards + canvas binaries) and zip it with mcpb. Output: dist/shalav.mcpb
import { execFileSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
const out = "build/mcpb";

run("pnpm", ["build:cards"]);
run("pnpm", ["build:server"]);

await rm(out, { recursive: true, force: true });
await mkdir(join(out, "server/node_modules/@napi-rs"), { recursive: true });
await cp("mcpb/manifest.json", join(out, "manifest.json"));
await cp("mcpb/icon.png", join(out, "icon.png"));
await cp("THIRD_PARTY_NOTICES.md", join(out, "THIRD_PARTY_NOTICES.md"));
for (const f of ["server.mjs", "cards.html", "pdf.worker.mjs"]) await cp(join("dist", f), join(out, "server", f));

await cp("dist/standard_fonts", join(out, "server/standard_fonts"), { recursive: true });
for (const d of ["tikz", "biolib"]) await cp(join("dist", d), join(out, "server", d), { recursive: true });

// @napi-rs/canvas is external: ship the loader plus the macOS and Windows binaries (installed via supportedArchitectures).
const { version } = JSON.parse(await (await import("node:fs/promises")).readFile("node_modules/@napi-rs/canvas/package.json", "utf8"));
for (const d of await readdir("node_modules/.pnpm")) {
  const m = d.match(/^@napi-rs\+(canvas(?:-(?:darwin-arm64|darwin-x64|win32-x64-msvc))?)@(.+)$/);
  if (m && m[2] === version) await cp(join("node_modules/.pnpm", d, "node_modules/@napi-rs", m[1]), join(out, "server/node_modules/@napi-rs", m[1]), { recursive: true });
}

// playwright-core (Moodle import) is external too: pure JS; its cli.js downloads Shalav's own Chromium on the first import (browser.ts).
await cp("node_modules/playwright-core", join(out, "server/node_modules/playwright-core"), { recursive: true, dereference: true });

run("npx", ["mcpb", "validate", join(out, "manifest.json")]);
run("npx", ["mcpb", "pack", out, "dist/shalav.mcpb"]);
