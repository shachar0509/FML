// Node wiring for what the Tauri app got from plugins: dirs, first run, catalog.
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { technionSource, type CatalogSource } from "@/domain/catalog/catalog";
import { setFs } from "@/lib/fs/fs";
import { nodeDirs } from "@/lib/platform";
import { ensureDataRoot, ensureDevice } from "@/lib/firstRun";
import { setDeviceId } from "@/lib/device";
import { useSettings } from "@/stores/settings";
import { enableNodeCanvas } from "./canvas";
import { nodeFs } from "./nodeFs";

/** Per-user app dirs (config = device-local state, like Tauri's appConfigDir). */
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
  await useSettings.getState().load();
  const deviceId = await ensureDevice(dirs.config);
  setDeviceId(deviceId);
  const dataRoot = useSettings.getState().settings.dataRoot;
  await ensureDataRoot(dataRoot);
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
