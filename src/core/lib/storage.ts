// JSON files under nodeDirs.config in the Node server; localStorage in a plain browser (card dev page, tests).
import { fs } from "@/core/lib/fs/fs";
import { nodeDirs } from "@/core/lib/platform";

const nodePath = (file: string) => `${nodeDirs.config}/${file.replace(/[^\w.-]/g, "_")}`;

export async function readJson(file: string): Promise<unknown> {
  try {
    if (nodeDirs.config) return JSON.parse(await fs().readText(nodePath(file)));
    const raw = localStorage.getItem(file);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  try {
    if (nodeDirs.config) {
      await fs().mkdir(nodeDirs.config);
      await fs().writeText(nodePath(file), JSON.stringify(value, null, 2));
    } else localStorage.setItem(file, JSON.stringify(value));
  } catch (e) {
    console.error("settings persist failed", e);
  }
}

export async function defaultDataRoot(): Promise<string> {
  if (nodeDirs.documents) return `${nodeDirs.documents}/Shalav`;
  return "Shalav";
}
