import { EXERCISES_DIR, MATERIALS_DIR } from "@/constants";
import { fs } from "./fs";

/** Provider conflict copies (plan v2 §6.9): `x (1).json`, `x (conflicted copy).json`, `x (Case Conflict).json`. */
const COPY = /( \(\d+\)| \([^)]*(conflicted copy|case conflict)[^)]*\))(\.[^.]+)?$/i;
export const isConflictCopy = (name: string): boolean => COPY.test(name);

const SKIP = new Set([MATERIALS_DIR, EXERCISES_DIR, "attachments", "crops"]);

/** Data files (json/jsonl/md) under the data root that look like sync conflict copies, relative to the root. */
export async function findConflictCopies(root: string, dir = root): Promise<string[]> {
  if (!(await fs().exists(dir))) return [];
  const found: string[] = [];
  for (const e of await fs().readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (!SKIP.has(e.name)) found.push(...(await findConflictCopies(root, p)));
    } else if (e.isFile && /\.(jsonl?|md)$/.test(e.name) && isConflictCopy(e.name)) found.push(p.slice(root.length + 1));
  }
  return found;
}
