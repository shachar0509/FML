// plugin-store inside Tauri; JSON files under nodeDirs.config in the Node server; localStorage in a plain browser (pnpm dev, tests).
import { fs } from "@/lib/fs/fs";
import { nodeDirs } from "@/lib/platform";
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const nodePath = (file: string) => `${nodeDirs.config}/${file.replace(/[^\w.-]/g, "_")}`;

export async function readJson(file: string): Promise<unknown> {
  try {
    if (nodeDirs.config) return JSON.parse(await fs().readText(nodePath(file)));
    if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      return await (await load(file)).get("value");
    }
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
    } else if (isTauri()) {
      const { load } = await import("@tauri-apps/plugin-store");
      const s = await load(file);
      await s.set("value", value);
      await s.save();
    } else localStorage.setItem(file, JSON.stringify(value));
  } catch (e) {
    console.error("settings persist failed", e);
  }
}

export async function defaultDataRoot(): Promise<string> {
  if (nodeDirs.documents) return `${nodeDirs.documents}/Shalav`;
  if (!isTauri()) return "Shalav";
  const { documentDir, join } = await import("@tauri-apps/api/path");
  return join(await documentDir(), "Shalav");
}
