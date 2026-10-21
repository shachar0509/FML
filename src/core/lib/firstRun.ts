import { DeviceJsonSchema, ShalavJsonSchema } from "@/core/domain/dataSchemas";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { coursesDir, join, shalavJsonPath } from "@/core/lib/fs/paths";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { setUniversity, UNIVERSITY_IDS, type UniversityId } from "@/core/universities";

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

/** Loads the stored university into memory. Data from v1 (courses but no choice) is Technion data, so it is locked in as such. */
export async function loadUniversity(dataRoot: string): Promise<UniversityId | null> {
  const p = shalavJsonPath(dataRoot);
  const j = await readJsonFile(p, ShalavJsonSchema);
  let id = j?.university ?? null;
  if (!id && j && (await fs().readDir(coursesDir(dataRoot))).some((e) => e.isDirectory)) {
    id = "technion";
    await writeJsonAtomic(p, { ...j, university: id });
  }
  setUniversity(id);
  return id;
}

/** One-way: the choice is written once; a different value is refused (reset the app = delete the data folder). */
export async function chooseUniversity(dataRoot: string, id: UniversityId): Promise<void> {
  if (!UNIVERSITY_IDS.includes(id)) throw new Error("Unknown university.");
  const p = shalavJsonPath(dataRoot);
  const j = await readJsonFile(p, ShalavJsonSchema);
  if (!j) throw new Error("The data folder is not set up.");
  if (j.university && j.university !== id) throw new Error("The university is locked. To change it, reset Shalav completely (delete the data folder).");
  if (!j.university) await writeJsonAtomic(p, { ...j, university: id });
  setUniversity(id);
}
