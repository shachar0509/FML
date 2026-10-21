import { EXERCISES_DIR, MATERIALS_DIR } from "@/constants";

export const nfc = (s: string): string => s.normalize("NFC");
export const join = (...parts: string[]): string =>
  parts.join("/").replace(/\/{2,}/g, "/").replace(/(?<=.)\/$/, "");
export const dirname = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf("/")));

export const shalavJsonPath = (root: string) => join(root, "shalav.json");
export const coursesDir = (root: string) => join(root, "courses");

// Spec §3.2 course tree. `c` is the course folder.
export const coursePaths = (root: string, courseNumber: string) => {
  const c = join(coursesDir(root), courseNumber);
  const s = join(c, ".shalav");
  return {
    course: c,
    courseJson: join(c, "course.json"),
    planJson: join(c, "plan.json"),
    planMd: join(c, "plan.md"),
    progressJson: join(c, "progress.json"),
    progressMd: join(c, "progress.md"),
    materials: join(c, MATERIALS_DIR),
    exercises: join(c, EXERCISES_DIR),
    shalav: s,
    events: join(s, "events"),
    eventsFile: (deviceId: string) => join(s, "events", `${deviceId}.jsonl`),
    learnSessions: (stageId: string) => join(s, "sessions", "learn", stageId),
    learnSessionFile: (stageId: string, deviceId: string) =>
      join(s, "sessions", "learn", stageId, `${deviceId}.jsonl`),
    practiceSessions: join(s, "sessions", "practice"),
    practiceSessionFile: (deviceId: string) => join(s, "sessions", "practice", `${deviceId}.jsonl`),
    attachments: join(s, "attachments"),
    indexFiles: join(s, "index", "files"),
    indexFile: (sha256: string) => join(s, "index", "files", `${sha256}.json`),
    crops: join(s, "index", "crops"),
    generatedFile: (deviceId: string) => join(s, "generated", `${deviceId}.json`),
    history: join(s, "history"),
    briefs: join(s, "briefs"),
  };
};
