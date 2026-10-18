import { DeviceJsonSchema, ShalavJsonSchema } from "@/domain/dataSchemas";
import { readJsonFile, writeJsonAtomic } from "@/lib/fs/atomicWrite";
import { fs } from "@/lib/fs/fs";
import { coursesDir, join, shalavJsonPath } from "@/lib/fs/paths";
import { setDeviceId } from "@/lib/device";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { useSettings } from "@/stores/settings";

// Spec §15.1. `configDir` = appConfigDir() (device-local), `dataRoot` = resolved data root.
export async function ensureDevice(configDir: string): Promise<string> {
  const path = join(configDir, "device.json");
  const existing = await readJsonFile(path, DeviceJsonSchema);
  if (existing) return existing.deviceId;
  const deviceId = newId();
  await writeJsonAtomic(path, { deviceId });
  return deviceId;
}

/** Creates the data root + shalav.json if missing; reuses an existing one (reinstall). */
export async function ensureDataRoot(dataRoot: string): Promise<void> {
  await fs().mkdir(coursesDir(dataRoot));
  const p = shalavJsonPath(dataRoot);
  if (await readJsonFile(p, ShalavJsonSchema)) return;
  await writeJsonAtomic(p, { formatVersion: 1, createdAt: nowIso() });
}

/** Browser/dev fallback has no filesystem, so first run is a no-op there. */
export async function firstRun(): Promise<{ deviceId: string; dataRoot: string } | null> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return null;
  const { appConfigDir } = await import("@tauri-apps/api/path");
  const deviceId = await ensureDevice(await appConfigDir());
  setDeviceId(deviceId);
  const dataRoot = useSettings.getState().settings.dataRoot;
  await ensureDataRoot(dataRoot);
  return { deviceId, dataRoot };
}
