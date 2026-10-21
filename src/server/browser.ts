import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Shalav's own Chromium for the Moodle login (M39): downloaded once into `dir`, then launched by path.
 * Playwright reads PLAYWRIGHT_BROWSERS_PATH when it loads, so the install and the path lookup run in a child process.
 * The server runs on Claude Desktop's Electron Node: ELECTRON_RUN_AS_NODE makes process.execPath a plain node.
 */
export async function ensureChromium(dir: string, onProgress: (pct: number) => void): Promise<string> {
  const pkg = dirname(createRequire(import.meta.url).resolve("playwright-core/package.json"));
  const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: dir, ELECTRON_RUN_AS_NODE: "1" };
  const run = (args: string[], onLine?: (l: string) => void) =>
    new Promise<string>((resolve, reject) => {
      const p = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const take = (b: Buffer) => {
        out += b;
        for (const l of String(b).split(/[\r\n]+/)) if (l) onLine?.(l);
      };
      p.stdout.on("data", take);
      p.stderr.on("data", take);
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve(out) : reject(new Error(out.trim().split("\n").at(-1) || `exit ${code}`))));
    });
  const path = await run(["-e", `process.stdout.write(require(${JSON.stringify(pkg)}).chromium.executablePath())`]);
  if (existsSync(path)) return path;
  let chrome = true; // the install also fetches ffmpeg afterwards: only Chrome's download moves the bar
  await run([join(pkg, "cli.js"), "install", "--no-shell", "chromium"], (l) => {
    if (/FFmpeg/.test(l)) chrome = false;
    const pct = installPct(l);
    if (chrome && pct !== null) onProgress(pct);
  });
  if (!existsSync(path)) throw new Error("Chromium was not installed.");
  return path;
}

/** "|■■■■     |  20% of 185.8 MiB" → 20 */
export const installPct = (line: string): number | null => {
  const m = /\|\s*(\d{1,3})% of /.exec(line);
  return m ? Number(m[1]) : null;
};
