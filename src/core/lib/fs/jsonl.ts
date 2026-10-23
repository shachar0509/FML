import type { ZodType } from "zod";
import { isConflictCopy } from "./conflicts";
import { fs } from "./fs";
import { dirname } from "./paths";

export async function appendJsonl(path: string, obj: unknown): Promise<void> {
  await fs().mkdir(dirname(path));
  await fs().writeText(path, JSON.stringify(obj) + "\n", { append: true });
}

/** Lines that fail to parse (e.g. a crash-truncated trailing line) are skipped. */
function parseLines<T>(text: string, schema?: ZodType<T>): T[] {
  const out: T[] = [];
  for (const line of text.split("\n")) {
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

export async function readJsonl<T = unknown>(path: string, schema?: ZodType<T>): Promise<T[]> {
  if (!(await fs().exists(path))) return [];
  return parseLines(await fs().readText(path), schema);
}

/**
 * R4: each file's parsed lines, keyed by its exact text. An unchanged file is not parsed again; an appended one parses
 * only what follows the old text's last "\n". Content, not mtime: another device's sync, our own append and a
 * same-size rewrite are all seen. `head` = the items of text[0, cut), cut = just after the last "\n".
 */
type Parsed = { schema: unknown; text: string; cut: number; head: unknown[]; items: unknown[] };
// ponytail: one entry per events file ever read, never evicted (a few per course); add eviction if the server ever reads thousands of dirs.
const parsed = new Map<string, Parsed>();
/** Tests only: a caller that mutates a shared cached event throws instead of silently changing later reads. */
const FREEZE = typeof process !== "undefined" && !!process.env.VITEST;
const freeze = (v: unknown): void => {
  if (!v || typeof v !== "object" || Object.isFrozen(v)) return;
  Object.freeze(v);
  for (const x of Object.values(v)) freeze(x);
};

async function readJsonlCached<T>(path: string, schema?: ZodType<T>): Promise<T[]> {
  if (!(await fs().exists(path))) return [];
  const text = await fs().readText(path);
  const old = parsed.get(path);
  if (old && old.schema === schema && old.text === text) return old.items as T[];
  const keep = old && old.schema === schema && text.startsWith(old.text.slice(0, old.cut)) ? old : null;
  const from = keep ? keep.cut : 0;
  const cut = text.lastIndexOf("\n") + 1; // >= from: text starts with old text up to and including a "\n"
  const head = [...(keep ? keep.head : []), ...parseLines(text.slice(from, cut), schema)];
  const items = [...head, ...parseLines(text.slice(cut), schema)];
  if (FREEZE) items.forEach(freeze);
  parsed.set(path, { schema, text, cut, head, items });
  return items as T[];
}

/** Read every *.jsonl in a folder, concatenate, sort by (ts,id), de-dup by id (§3.6/§3.8). */
export async function readJsonlDir<T extends { id: string; ts: string }>(
  dir: string,
  schema?: ZodType<T>,
): Promise<T[]> {
  if (!(await fs().exists(dir))) return [];
  const all: T[] = [];
  for (const e of await fs().readDir(dir))
    if (e.isFile && e.name.endsWith(".jsonl") && !isConflictCopy(e.name)) all.push(...(await readJsonlCached(`${dir}/${e.name}`, schema)));
  return mergeById(all);
}

export function mergeById<T extends { id: string; ts: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items
    .filter((x) => !seen.has(x.id) && !!seen.add(x.id))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
