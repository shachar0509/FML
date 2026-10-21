import { DeviceJsonSchema, ShalavJsonSchema } from "@/core/domain/dataSchemas";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { coursesDir, join, shalavJsonPath } from "@/core/lib/fs/paths";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";

// Spec §15.1. `configDir` = device-local config folder, `dataRoot` = resolved data root.
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
