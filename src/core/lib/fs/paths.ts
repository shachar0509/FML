import { EXERCISES_DIR, MATERIALS_DIR, TEACHER_DIR } from "@/constants";

export const nfc = (s: string): string => s.normalize("NFC");
export const join = (...parts: string[]): string =>
  parts.join("/").replace(/\/{2,}/g, "/").replace(/(?<=.)\/$/, "");
export const dirname = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf("/")));

export const shalavJsonPath = (root: string) => join(root, "shalav.json");
export const coursesDir = (root: string) => join(root, "courses");
/** M60: saved lessons and practice sessions, `<id>.json` per course folder */
export const chatHistory = (root: string) => join(root, ".chat_history");

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
    teacher: join(c, TEACHER_DIR),
    /** M70: shas of the files "Find materials online" wrote (their solutions are Shalav's own, never course conventions) */
    webFiles: join(s, "web-files.json"),
    /** M72: the course conventions registry (ConventionsFileSchema) */
    conventions: join(s, "conventions.json"),
    shalav: s,
    events: join(s, "events"),
    eventsFile: (deviceId: string) => join(s, "events", `${deviceId}.jsonl`),
    learnSessions: (stageId: string) => join(s, "sessions", "learn", stageId),
    learnSessionFile: (stageId: string, deviceId: string) =>
      join(s, "sessions", "learn", stageId, `${deviceId}.jsonl`),
    practiceSessions: join(s, "sessions", "practice"),
    practiceSessionFile: (deviceId: string) => join(s, "sessions", "practice", `${deviceId}.jsonl`),
    attachments: join(s, "attachments"),
    /** M57: the homework / single question being solved (`current.json`), and ended ones by id */
    homework: join(s, "homework"),
    indexFiles: join(s, "index", "files"),
    indexFile: (sha256: string) => join(s, "index", "files", `${sha256}.json`),
    crops: join(s, "index", "crops"),
    generatedFile: (deviceId: string) => join(s, "generated", `${deviceId}.json`),
    history: join(s, "history"),
    briefs: join(s, "briefs"),
  };
};
