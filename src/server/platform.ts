// Node wiring: dirs, settings, first run, catalog.
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { technionSource, type CatalogSource } from "@/core/domain/catalog/catalog";
import { setFs } from "@/core/lib/fs/fs";
import { nodeDirs } from "@/core/lib/platform";
import { ensureDataRoot, ensureDevice, loadUniversity } from "@/core/lib/firstRun";
import { setDeviceId } from "@/core/lib/device";
import { readJson } from "@/core/lib/storage";
import { useSettings } from "@/stores/settings";
import { enableNodeCanvas } from "./canvas";
import { nodeFs } from "./nodeFs";

/** Per-user app dirs (config = device-local state). */
function appDirs(env = process.env) {
  const home = homedir();
  const os = platform();
  const config = env.SHALAV_CONFIG_DIR ?? (os === "win32" ? join(env.APPDATA ?? join(home, "AppData", "Roaming"), "Shalav") : os === "darwin" ? join(home, "Library", "Application Support", "il.shalav.app") : join(home, ".config", "shalav"));
  const cache = env.SHALAV_CACHE_DIR ?? (os === "win32" ? join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Shalav", "cache") : os === "darwin" ? join(home, "Library", "Caches", "il.shalav.app") : join(home, ".cache", "shalav"));
  return { config, cache, documents: env.SHALAV_DOCUMENTS_DIR ?? join(home, "Documents") };
}

/** Wire fs, canvas, dirs, settings and the data root. Safe to call once per process. */
export async function initNode(): Promise<{ deviceId: string; dataRoot: string }> {
  setFs(nodeFs());
  enableNodeCanvas();
  const dirs = appDirs();
  Object.assign(nodeDirs, dirs);
  const firstRun = (await readJson("settings.json")) === undefined;
  await useSettings.getState().load();
  // MCPB user_config arrives as env (manifest.json). The folder always wins; the language only seeds the first run, after that the settings card owns it.
  const env = (k: string) => { const v = process.env[k]?.trim(); return v && !v.includes("${") ? v : undefined; };
  const { settings } = useSettings.getState();
  const lang = env("SHALAV_LANGUAGE");
  useSettings.setState({ settings: { ...settings, dataRoot: env("SHALAV_DATA_FOLDER") ?? settings.dataRoot, ...(firstRun && (lang === "he" || lang === "en") ? { language: lang } : {}) } });
  if (firstRun) useSettings.getState().update({});
  const deviceId = await ensureDevice(dirs.config);
  setDeviceId(deviceId);
  const dataRoot = useSettings.getState().settings.dataRoot;
  await ensureDataRoot(dataRoot);
  await loadUniversity(dataRoot);
  return { deviceId, dataRoot };
}

export const nodeCatalog = (): CatalogSource =>
  technionSource({
    cacheDir: join(nodeDirs.cache ?? appDirs().cache, "catalog"),
    fetchText: async (url) => {
      const r = await fetch(url);
      return { status: r.status, text: r.status === 200 ? await r.text() : "" };
    },
  });
