import type { ZodType } from "zod";
import { fs } from "./fs";
import { dirname } from "./paths";

// Spec §3.1: UTF-8, 2-space indent, write <name>.tmp then rename.
export async function writeTextAtomic(path: string, text: string): Promise<void> {
  const f = fs();
  await f.mkdir(dirname(path));
  const tmp = `${path}.tmp`;
  await f.writeText(tmp, text);
  await f.rename(tmp, path);
}

export const writeJsonAtomic = (path: string, value: unknown) =>
  writeTextAtomic(path, JSON.stringify(value, null, 2) + "\n");

/** Returns null if the file is missing or fails to parse/validate. */
export async function readJsonFile<T>(path: string, schema: ZodType<T>): Promise<T | null> {
  try {
    if (!(await fs().exists(path))) return null;
    const r = schema.safeParse(JSON.parse(await fs().readText(path)));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}
