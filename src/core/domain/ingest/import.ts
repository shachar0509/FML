import type { FileIndex } from "@/core/domain/dataSchemas";
import { fs } from "@/core/lib/fs/fs";
import { coursePaths, join, nfc } from "@/core/lib/fs/paths";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { listFileIndexes, readFileIndex, writeFileIndex } from "./indexStore";
import { PasswordProtectedError, TooManyPagesError, type OpenSource } from "./types";

export type Role = FileIndex["role"];
export type ImportOutcome =
  | { path: string; status: "added" | "duplicate"; sha256: string }
  | { path: string; status: "unsupported" | "tooLarge" | "heicWindows" | "tooManyPages" | "failed"; error?: string };

/** Everything that touches the OS; replaced in tests. */
export type Native = {
  sha256(path: string): Promise<string>;
  size(path: string): Promise<number>;
  /** last modification time (ms) */
  modified(path: string): Promise<number>;
  copy(src: string, destDir: string): Promise<string>;
  heicToJpeg(src: string): Promise<string>;
  trash(path: string): Promise<void>;
};
export type Deps = { native: Native; open: OpenSource; enqueue(course: string, sha256: string): void; platform: "macos" | "windows" };

export const MAX_BYTES = 200 * 1024 * 1024;
export const MEDIA: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", txt: "text/plain", md: "text/markdown",
};
export const PICKER_EXTENSIONS = [...Object.keys(MEDIA), "heic"];
export const extOf = (p: string) => /\.([^./]+)$/.exec(p)?.[1]?.toLowerCase() ?? "";
const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1);

const stampOf = async (abs: string, d: Pick<Deps, "native">) => `${await d.native.size(abs)}:${await d.native.modified(abs)}`;
const paths = (course: string) => coursePaths(useSettings.getState().settings.dataRoot, course);
const roleDir = (course: string, role: Role) => (role === "material" ? paths(course).materials : paths(course).exercises);

/** Steps 3 (dup check) and 5-6 for a file that already sits in its role folder. */
async function register(course: string, role: Role, abs: string, sha256: string, d: Deps, stamp?: string): Promise<ImportOutcome> {
  const ext = extOf(abs);
  const rec: FileIndex = {
    schema: 1, sha256, fileName: nfc(baseName(abs)), relPath: nfc(abs.slice(paths(course).course.length + 1)), role,
    mediaType: MEDIA[ext] ?? "application/octet-stream", pageCount: 1, addedAt: nowIso(), stamp: stamp ?? (await stampOf(abs, d)), status: "pending", error: null,
    indexedAt: null, indexModel: null, planVersion: null, materialPages: [], exercises: [],
  };
  try {
    const src = await d.open({ path: abs, mediaType: rec.mediaType, sha256 });
    rec.pageCount = src.pageCount;
    src.close();
  } catch (e) {
    if (e instanceof TooManyPagesError) return { path: abs, status: "tooManyPages" };
    if (!(e instanceof PasswordProtectedError)) return { path: abs, status: "failed", error: String(e) };
    rec.status = "failed";
    rec.error = e.message;
  }
  await writeFileIndex(course, rec);
  if (rec.status === "pending") d.enqueue(course, sha256);
  return { path: abs, status: "added", sha256 };
}

/** 5.2: files from the picker / drop. Returns one outcome per input path. */
export async function importFiles(course: string, role: Role, files: string[], d: Deps): Promise<ImportOutcome[]> {
  const out: ImportOutcome[] = [];
  const known = await listFileIndexes(course);
  for (let src of files) {
    const orig = src;
    const ext = extOf(src);
    if (ext !== "heic" && !MEDIA[ext]) { out.push({ path: orig, status: "unsupported" }); continue; }
    if ((await d.native.size(src)) > MAX_BYTES) { out.push({ path: orig, status: "tooLarge" }); continue; }
    try {
      if (ext === "heic") {
        if (d.platform === "windows") { out.push({ path: orig, status: "heicWindows" }); continue; }
        src = await d.native.heicToJpeg(src);
      }
      const sha256 = await d.native.sha256(src);
      if (known.some((r) => r.sha256 === sha256 && r.role === role) || out.some((o) => "sha256" in o && o.sha256 === sha256)) {
        out.push({ path: orig, status: "duplicate", sha256 });
        continue;
      }
      const dest = await d.native.copy(src, roleDir(course, role));
      const r = await register(course, role, dest, sha256, d);
      if (r.status === "tooManyPages") await fs().remove(dest).catch(() => undefined);
      out.push({ ...r, path: orig });
    } catch (e) {
      out.push({ path: orig, status: "failed", error: String(e) });
    }
  }
  return out;
}

const rejected = new Map<string, string>(); // path → stamp of a folder file that cannot be added (unreadable, too big): not opened again on every scan until it changes

/** Patches a record as it is on disk now (the index queue may have written it since the scan listed it). */
async function patch(course: string, sha256: string, p: Partial<FileIndex>) {
  const cur = await readFileIndex(course, sha256);
  if (cur) await writeFileIndex(course, { ...cur, ...p });
}

/**
 * Watcher / sync-arrival pass: register unknown files in place, follow renames, drop records of deleted files.
 * An edited file (same path, other content) is the old version removed and a new file added: it waits for the next Build / Update plan.
 * `removed`: the shas whose file is gone or changed (the caller stops reading them, like a removal in the card).
 */
export async function scanCourse(course: string, d: Deps): Promise<{ added: number; removed: string[] }> {
  const recs = await listFileIndexes(course);
  const p = paths(course);
  let added = 0;
  const removed: string[] = [];
  for (const role of ["material", "exercises"] as const) {
    const dir = roleDir(course, role);
    if (!(await fs().exists(dir))) continue;
    for (const e of await fs().readDir(dir)) {
      if (!e.isFile || e.name.startsWith(".") || !MEDIA[extOf(e.name)]) continue;
      const abs = join(dir, e.name);
      const rel = nfc(abs.slice(p.course.length + 1));
      const known = recs.find((r) => r.relPath === rel);
      const size = await d.native.size(abs);
      const stamp = `${size}:${await d.native.modified(abs)}`;
      if (known ? known.stamp === stamp : rejected.get(abs) === stamp) continue; // unchanged since the last scan
      if (size > MAX_BYTES) { rejected.set(abs, stamp); continue; }
      const sha256 = await d.native.sha256(abs);
      if ((await d.native.size(abs)) !== size) continue; // still being copied in or saved: the next scan takes it whole
      if (known) {
        if (known.sha256 === sha256) { await patch(course, sha256, { stamp }); continue; } // touched only, or first seen since stamps
        recs.splice(recs.indexOf(known), 1); // edited: the old version's index goes
        await dropIndex(course, known);
        removed.push(known.sha256);
      }
      const same = recs.find((r) => r.sha256 === sha256 && r.role === role);
      if (same) {
        if (!(await fs().exists(join(p.course, same.relPath)))) {
          const moved = { relPath: rel, fileName: nfc(e.name), stamp }; // renamed or moved: keeps its scan
          Object.assign(same, moved);
          await patch(course, sha256, moved);
        }
        continue;
      }
      const r = await register(course, role, abs, sha256, d, stamp);
      if (r.status !== "added") rejected.set(abs, stamp);
      if (r.status === "added") { added++; recs.push((await listFileIndexes(course)).find((x) => x.sha256 === sha256) as FileIndex); }
    }
  }
  for (const r of recs) {
    if (await fs().exists(join(p.course, r.relPath))) continue;
    await dropIndex(course, r);
    removed.push(r.sha256);
  }
  return { added, removed };
}

async function dropIndex(course: string, r: FileIndex) {
  const p = paths(course);
  await fs().remove(p.indexFile(r.sha256));
  for (const x of r.exercises) for (const c of x.figureCrops) await fs().remove(join(p.course, c.file)).catch(() => undefined);
}

/** Menu "Remove": file to OS trash, record + crops deleted. */
export async function removeFile(course: string, r: FileIndex, d: Pick<Deps, "native">) {
  await d.native.trash(join(paths(course).course, r.relPath)).catch(() => undefined);
  await dropIndex(course, r);
}

/** Menu "Re-index" / "Retry". */
export async function reindex(course: string, r: FileIndex, d: Pick<Deps, "enqueue">) {
  await writeFileIndex(course, { ...r, status: "pending", error: null, indexedAt: null, indexModel: null, planVersion: null, materialPages: [], exercises: [] });
  d.enqueue(course, r.sha256);
}
