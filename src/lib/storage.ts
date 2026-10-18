// plugin-store inside Tauri; localStorage in a plain browser (pnpm dev, tests).
const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readJson(file: string): Promise<unknown> {
  try {
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
    if (isTauri()) {
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
  if (!isTauri()) return "Shalav";
  const { documentDir, join } = await import("@tauri-apps/api/path");
  return join(await documentDir(), "Shalav");
}
