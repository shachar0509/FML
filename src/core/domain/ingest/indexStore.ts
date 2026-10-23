import { FileIndexSchema, type FileIndex } from "@/core/domain/dataSchemas";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs, type Fs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";

const paths = (course: string) => coursePaths(useSettings.getState().settings.dataRoot, course);

export const readFileIndex = (course: string, sha256: string) => readJsonFile(paths(course).indexFile(sha256), FileIndexSchema);
export const writeFileIndex = (course: string, rec: FileIndex) => writeJsonAtomic(paths(course).indexFile(rec.sha256), rec);

/** R1: last parse of each index file (fs → index dir → file name), reused while its on-disk signature is unchanged. */
type Entry = { sig: string; rec: FileIndex };
const cache = new WeakMap<Fs, Map<string, Map<string, Entry>>>();
// ponytail: old data roots' dir maps stay until restart (bounded by what was listed); drop them on a root change if memory matters
/** A file changed this recently may change again under the same signature (FAT mtime 2 s, coarse ctime): parse it, don't keep it. */
const RACY_MS = 3000;

/** Copies plain JSON-shaped data (zod output): new objects and arrays, shared strings. Callers may mutate what they get. */
const copy = <T>(v: T): T =>
  (Array.isArray(v) ? v.map(copy) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) : v) as T;

async function cachedRead(course: string, name: string, seen: Map<string, Entry>): Promise<FileIndex | null> {
  const sha = name.slice(0, -5);
  let sig: string;
  let settled: boolean;
  try {
    const s = await fs().stat(paths(course).indexFile(sha)); // before the read: a change in between only costs one more parse later
    sig = `${s.size}:${s.mtimeMs}:${s.ctimeMs}:${s.ino}`;
    settled = Date.now() - Math.max(s.mtimeMs, s.ctimeMs) > RACY_MS;
  } catch {
    seen.delete(name);
    return readFileIndex(course, sha); // vanished or busy: today's read exactly (null drops it from the list)
  }
  const hit = seen.get(name);
  if (hit?.sig === sig) return hit.rec;
  const rec = await readFileIndex(course, sha);
  if (rec && settled) seen.set(name, { sig, rec });
  else seen.delete(name); // a null (missing, unreadable, invalid) is never kept: the next call reads again, as today
  return rec;
}

export async function listFileIndexes(course: string): Promise<FileIndex[]> {
  const dir = paths(course).indexFiles;
  const dirs = cache.get(fs()) ?? new Map<string, Map<string, Entry>>();
  cache.set(fs(), dirs);
  if (!(await fs().exists(dir))) {
    dirs.delete(dir);
    return [];
  }
  const names = (await fs().readDir(dir)).filter((e) => e.isFile && e.name.endsWith(".json")).map((e) => e.name);
  const seen = dirs.get(dir) ?? new Map<string, Entry>();
  dirs.set(dir, seen);
  const live = new Set(names);
  for (const k of [...seen.keys()]) if (!live.has(k)) seen.delete(k); // file gone: its entry goes
  const out = await Promise.all(names.map((n) => cachedRead(course, n, seen)));
  return copy(out.filter((r): r is FileIndex => !!r).sort((a, b) => a.addedAt.localeCompare(b.addedAt))); // never hand out the cache's own objects
}
