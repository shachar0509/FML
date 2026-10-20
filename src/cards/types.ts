/** What the server puts in `structuredContent`; `view` picks the card view (plan v2 §8). */
export type HomeData = {
  view: "home";
  language: "he" | "en";
  theme: "system" | "light" | "dark";
  courses: { number: string; name: string; credits: number; pct: number; stage: string | null }[];
};
export type Base = { language: "he" | "en"; theme: "system" | "light" | "dark" };
export type AddData = Base & { view: "add" };
export type Stage = { id: string; title: string; summary: string; status: "locked" | "available" | "in_progress" | "completed" | "completed_override"; mastery: number };
export type CourseData = Base & {
  view: "course";
  number: string;
  name: string;
  credits: number;
  pct: number;
  stagesDone: number;
  stagesTotal: number;
  current: string | null;
  hasPlan: boolean;
  /** Set while a plan build is running or after it failed. */
  build: BuildStatus | null;
  canPractice: boolean;
  watch: { label: string; count: number; stageIds: string[] }[];
  units: { id: string; title: string; stages: Stage[] }[];
};
export type BuildStatus = { state: "none" | "running" | "done" | "failed"; step?: "folders" | "plan" | "validate" | "progress"; unit?: { k: number; n: number }; error?: string | null; pending?: number };
export type LookupResult =
  | { status: "invalid" | "notfound" | "offline" }
  | { status: "exists"; number: string }
  | { status: "found"; entry: { courseNumber: string; nameHe: string; credits: number; faculty: string; syllabusHe: string } };
export type FileRow = { sha: string; name: string; pages: number; status: "pending" | "indexing" | "indexed" | "failed"; error: string | null; exercises: number; done?: number; total?: number };
/** Files section of the course card (app-only `files_list`). */
export type FilesData = Base & {
  view: "files";
  number: string;
  materials: FileRow[];
  exercises: FileRow[];
  hasPlan: boolean;
  canIndex: boolean;
  canImprove: boolean;
  improving: { state: "running" | "failed"; error: string | null } | null;
};
export type CardData = HomeData | AddData | CourseData;

export type Host = {
  callTool(name: string, args?: Record<string, unknown>): Promise<{ structuredContent?: unknown; isError?: boolean }>;
  /** Puts a short user line into the chat (how card buttons ask the model for AI work). */
  say(text: string): Promise<void>;
  context(): { theme?: string; locale?: string };
  /** Replays the latest result to a new subscriber. */
  subscribe(onData: (d: unknown) => void, onContext: () => void): () => void;
};
