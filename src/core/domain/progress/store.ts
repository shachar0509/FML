import { CourseJsonSchema, EventSchema, PlanJsonSchema, ProgressJsonSchema, type Event } from "@/core/domain/dataSchemas";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { appendJsonl, readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { getDeviceId } from "@/core/lib/device";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { renderProgressMd } from "./render";
import { reduceProgress } from "./reduce";

type Distribute<T> = T extends unknown ? Omit<T, "id" | "ts" | "deviceId" | "courseNumber"> : never;
export type NewEvent = Distribute<Event>;

const paths = (n: string) => coursePaths(useSettings.getState().settings.dataRoot, n);

/** Append to this device's events file (3.6) and schedule a debounced recompute. */
export async function appendEvent(courseNumber: string, e: NewEvent): Promise<Event> {
  const full = { ...e, id: newId(), ts: nowIso(), deviceId: getDeviceId(), courseNumber } as Event;
  await appendJsonl(paths(courseNumber).eventsFile(full.deviceId), full);
  scheduleRecompute(courseNumber);
  return full;
}

/** Reduce all events and write progress.json / progress.md only when their content changed (8). */
export async function recomputeProgress(n: string): Promise<boolean> {
  const p = paths(n);
  const [course, plan] = await Promise.all([readJsonFile(p.courseJson, CourseJsonSchema), readJsonFile(p.planJson, PlanJsonSchema)]);
  if (!course || !plan) return false;
  const next = reduceProgress(plan, await readJsonlDir(p.events, EventSchema), nowIso());
  const prev = await readJsonFile(p.progressJson, ProgressJsonSchema);
  const same = (a: object, b: object) => JSON.stringify({ ...a, computedAt: 0 }) === JSON.stringify({ ...b, computedAt: 0 });
  let changed = false;
  if (!prev || !same(prev, next)) {
    await writeJsonAtomic(p.progressJson, next);
    changed = true;
  }
  const md = renderProgressMd(course, plan, next, useSettings.getState().settings.language);
  const oldMd = (await fs().exists(p.progressMd)) ? await fs().readText(p.progressMd) : null;
  if (oldMd !== md) {
    await writeTextAtomic(p.progressMd, md);
    changed = true;
  }
  return changed;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Debounced 500 ms per course; also call after a sync pull that brought events. */
export function scheduleRecompute(n: string): void {
  clearTimeout(timers.get(n));
  const fire = () => {
    timers.delete(n);
    void recomputeProgress(n).catch((e) => console.error("progress recompute failed", e));
  };
  timers.set(n, setTimeout(fire, 500));
}
