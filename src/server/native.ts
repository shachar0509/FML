// TS ports of the v1 native commands (sha256, import_copy, heic_to_jpeg, trash_path).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, rename, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import type { Native } from "@/core/domain/ingest/import";

const run = promisify(execFile);

export async function sha256(path: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(path)) h.update(chunk as Buffer);
  return h.digest("hex");
}

/** "a.pdf", n>=2 -> "a  (2).pdf" (two spaces, spec 5.2). */
export function numberedName(name: string, n: number): string {
  if (n <= 1) return name;
  const ext = extname(name); // ".hidden" has no extension, like the Rust version
  return `${name.slice(0, name.length - ext.length)}  (${n})${ext}`;
}

/** Copies into destDir without overwriting; returns the new path. */
export async function importCopy(src: string, destDir: string): Promise<string> {
  await mkdir(destDir, { recursive: true });
  for (let n = 1; n < 10_000; n++) {
    const dest = join(destDir, numberedName(basename(src), n));
    try {
      await copyFile(src, dest, 1 /* COPYFILE_EXCL */);
      return dest;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
  }
  throw new Error("too many name collisions");
}

/** macOS only: converts HEIC to a temp JPEG with sips. */
export async function heicToJpeg(src: string): Promise<string> {
  if (process.platform !== "darwin") throw new Error("HEIC conversion is not supported on this platform");
  const out = join(tmpdir(), `shalav-${process.pid}-${basename(src, extname(src))}.jpg`);
  await run("sips", ["-s", "format", "jpeg", src, "--out", out]);
  return out;
}

/** Recycle bin / Trash, never a hard delete. */
export async function trash(path: string): Promise<void> {
  await stat(path);
  if (process.platform === "win32") {
    const ps = `Add-Type -AssemblyName Microsoft.VisualBasic; $p=$env:SHALAV_P; if (Test-Path -PathType Container $p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`;
    await run("powershell", ["-NoProfile", "-Command", ps], { env: { ...process.env, SHALAV_P: path } });
  } else {
    // ponytail: plain move into ~/.Trash (no "Put Back" info); upgrade to Finder via osascript if that matters.
    let dest = join(homedir(), ".Trash", basename(path));
    for (let n = 2; await stat(dest).then(() => true, () => false); n++) dest = join(homedir(), ".Trash", numberedName(basename(path), n));
    await rename(path, dest);
  }
}

export async function openFolder(path: string): Promise<void> {
  const [cmd, args] = process.platform === "win32" ? ["explorer", [path]] : process.platform === "darwin" ? ["open", [path]] : ["xdg-open", [path]];
  await run(cmd, args).catch((e) => {
    if (process.platform !== "win32") throw e; // explorer exits 1 even on success
  });
}

export const native: Native = {
  sha256,
  size: async (p) => (await stat(p)).size,
  modified: async (p) => (await stat(p)).mtimeMs,
  copy: importCopy,
  heicToJpeg,
  trash,
};
