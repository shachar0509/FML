import { SessionLineSchema, type SessionLine } from "@/domain/dataSchemas";
import { getDeviceId } from "@/lib/device";
import { appendJsonl, readJsonlDir } from "@/lib/fs/jsonl";
import { coursePaths } from "@/lib/fs/paths";
import { newId } from "@/lib/ids";
import { nowIso } from "@/lib/time";
import { useSettings } from "@/stores/settings";

type Distribute<T> = T extends unknown ? Omit<T, "id" | "ts" | "deviceId"> : never;
export type NewSessionLine = Distribute<SessionLine>;

const paths = (n: string) => coursePaths(useSettings.getState().settings.dataRoot, n);

/** Merged transcript of all devices, ordered by (ts, id) (3.8). */
export const loadSession = (course: string, stageId: string): Promise<SessionLine[]> =>
  readJsonlDir(paths(course).learnSessions(stageId), SessionLineSchema);

export async function appendLine(course: string, stageId: string, line: NewSessionLine): Promise<SessionLine> {
  const full = { ...line, id: newId(), ts: nowIso(), deviceId: getDeviceId() } as SessionLine;
  await appendJsonl(paths(course).learnSessionFile(stageId, full.deviceId), full);
  return full;
}

export const lastActivityTs = (lines: SessionLine[]): string | null => lines.at(-1)?.ts ?? null;
