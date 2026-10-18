import type { ZodType } from "zod";
import { fs } from "./fs";
import { dirname } from "./paths";

export async function appendJsonl(path: string, obj: unknown): Promise<void> {
  await fs().mkdir(dirname(path));
  await fs().writeText(path, JSON.stringify(obj) + "\n", { append: true });
}

/** Lines that fail to parse (e.g. a crash-truncated trailing line) are skipped. */
export async function readJsonl<T = unknown>(path: string, schema?: ZodType<T>): Promise<T[]> {
  if (!(await fs().exists(path))) return [];
  const out: T[] = [];
  for (const line of (await fs().readText(path)).split("\n")) {
    if (!line.trim()) continue;
    try {
      const v: unknown = JSON.parse(line);
      if (!schema) out.push(v as T);
      else {
        const r = schema.safeParse(v);
        if (r.success) out.push(r.data);
      }
    } catch {
      /* partial line */
    }
  }
  return out;
}

/** Read every *.jsonl in a folder, concatenate, sort by (ts,id), de-dup by id (§3.6/§3.8). */
export async function readJsonlDir<T extends { id: string; ts: string }>(
  dir: string,
  schema?: ZodType<T>,
): Promise<T[]> {
  if (!(await fs().exists(dir))) return [];
  const all: T[] = [];
  for (const e of await fs().readDir(dir))
    if (e.isFile && e.name.endsWith(".jsonl")) all.push(...(await readJsonl(`${dir}/${e.name}`, schema)));
  return mergeById(all);
}

export function mergeById<T extends { id: string; ts: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items
    .filter((x) => !seen.has(x.id) && !!seen.add(x.id))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
