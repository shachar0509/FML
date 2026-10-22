import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

/**
 * The student-model engine (M61): tutor-mcp (MIT, github.com/ArnaudGuiovanna/tutor-mcp), one Go binary, downloaded once per
 * device into the config dir and checked against the release's SHA256SUMS (pinned below, so a changed asset is refused).
 * ponytail: pinned v0.6.1; to upgrade, bump VERSION and paste the new SHA256SUMS.
 */
export const ENGINE_VERSION = "v0.6.1";
const SUMS: Record<string, string> = {
  "tutor-mcp_darwin_arm64.tar.gz": "5efbfa59592b912477cccb03d8087212b1b8da46bc3d07a0e82c97f9c797608b",
  "tutor-mcp_darwin_amd64.tar.gz": "fd70dcb1aac4cbc366057d239e52c2e54e2cd9d394d32a9559de424ac89abac8",
  "tutor-mcp_linux_arm64.tar.gz": "fd12ab026a43cc82a197e742dd61acd1be83eb6d0e6c223ee745be76a7331036",
  "tutor-mcp_linux_amd64.tar.gz": "e5c47872580d9ebdc5b473155569c8cb18349b794da56f0132f721d8072683c4",
  "tutor-mcp_windows_arm64.zip": "663aa3bd38142638cb2138ae4b9153c65ec7023afe4adfacc4acd4b1aa307363",
  "tutor-mcp_windows_amd64.zip": "dcd8e455a8e7c3400b12a3c5769c4ca6ec97bc2baaf887eb020306662a4c1d66",
};

export function engineAsset(os: string = process.platform, arch: string = process.arch): string | null {
  const o = os === "win32" ? "windows" : os === "darwin" || os === "linux" ? os : null;
  const a = arch === "arm64" ? "arm64" : arch === "x64" ? "amd64" : null;
  if (!o || !a) return null;
  const name = `tutor-mcp_${o}_${a}.${o === "windows" ? "zip" : "tar.gz"}`;
  return name in SUMS ? name : null;
}

const sha256 = async (file: string) => {
  const h = createHash("sha256");
  await pipeline(createReadStream(file), h);
  return h.digest("hex");
};

/** Path of the engine binary in `dir`, downloading it first when missing. */
export async function ensureEngine(dir: string, onProgress: (pct: number) => void = () => undefined): Promise<string> {
  const asset = engineAsset();
  if (!asset) throw new Error(`No student-model engine for ${process.platform}/${process.arch}.`);
  const home = join(dir, `tutor-mcp-${ENGINE_VERSION}`);
  const bin = join(home, process.platform === "win32" ? "tutor-mcp.exe" : "tutor-mcp");
  if (existsSync(join(home, "INSTALLATION_COMPLETE")) && existsSync(bin)) return bin;

  onProgress(0);
  await mkdir(home, { recursive: true });
  const archive = join(dir, asset);
  try {
    const url = `https://github.com/ArnaudGuiovanna/tutor-mcp/releases/download/${ENGINE_VERSION}/${asset}`;
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
    await pipeline(body, createWriteStream(archive));
    if ((await sha256(archive)) !== SUMS[asset]) throw new Error("The student-model engine download does not match its checksum.");
    // bsdtar (macOS, Windows 10+) reads .zip too; Linux assets are .tar.gz
    await promisify(execFile)("tar", ["-xf", archive, "-C", home]);
    if (!existsSync(bin)) throw new Error("The student-model engine was not installed.");
    await writeFile(join(home, "INSTALLATION_COMPLETE"), ""); // only after a verified, full extract
  } finally {
    await rm(archive, { force: true });
  }
  return bin;
}
