import { createWriteStream, existsSync } from "node:fs";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join, relative } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

type Exe = { directory: string; executablePath(): string; downloadURLs: string[] };
type Core = {
  registry: { registry: { findExecutable(name: string): Exe } };
  utils: { extractZip(zip: string, o: { dir: string }): Promise<void> };
};

/**
 * Shalav's own Chromium for the Moodle login (M39): downloaded once into `dir`, then launched by path.
 * In-process on purpose: Claude Desktop runs the server in an Electron utility process with the RunAsNode fuse off, so
 * spawning process.execPath (or Playwright's own forked downloader) would start Claude, not node.
 * ponytail: uses playwright-core's internal registry/extractZip (exported as lib/coreBundle); playwright-core is pinned, recheck on upgrade.
 */
export async function ensureChromium(dir: string, onProgress: (pct: number) => void): Promise<string> {
  const core = createRequire(import.meta.url)("playwright-core/lib/coreBundle") as Core;
  const exe = core.registry.registry.findExecutable("chromium");
  const home = join(dir, basename(exe.directory)); // chromium-<revision>
  const path = join(home, relative(exe.directory, exe.executablePath()));
  if (existsSync(join(home, "INSTALLATION_COMPLETE")) && existsSync(path)) return path;

  onProgress(0); // the card shows the download from the start, not "log in"
  await mkdir(dir, { recursive: true });
  const zip = join(dir, `${basename(exe.directory)}.zip`);
  try {
    let error: unknown = new Error("Chromium has no download for this platform.");
    for (const url of exe.downloadURLs) {
      try {
        const res = await fetch(url);
        if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${url}`);
        const total = Number(res.headers.get("content-length")) || 0;
        let got = 0;
        let last = -1;
        const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
        body.on("data", (c: Buffer) => {
          got += c.length;
          const pct = total ? Math.floor((100 * got) / total) : 0;
          if (pct !== last) onProgress((last = pct));
        });
        await pipeline(body, createWriteStream(zip));
        if (total && got !== total) throw new Error(`Download incomplete: ${got} of ${total} bytes.`);
        error = null;
        break;
      } catch (e) {
        error = e;
      }
    }
    if (error) throw error;
    await rm(home, { recursive: true, force: true });
    await core.utils.extractZip(zip, { dir: home });
    await chmod(path, 0o755);
    await writeFile(join(home, "INSTALLATION_COMPLETE"), ""); // only after a full extract: an interrupted install downloads again
  } finally {
    await rm(zip, { force: true });
  }
  if (!existsSync(path)) throw new Error("Chromium was not installed.");
  return path;
}
