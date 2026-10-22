// M60: every lesson and practice session saved under <dataRoot>/.chat_history/<course>/<id>.json (copy the data folder, take them along).
import * as z from "zod";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { chatHistory, join } from "@/core/lib/fs/paths";
import { newId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";

export const CONV_TYPES = ["lesson", "homework", "single", "test", "normal"] as const;
export type ConvType = (typeof CONV_TYPES)[number];
const EntrySchema = z.object({
  at: z.string(),
  who: z.enum(["tutor", "student"]),
  kind: z.string(),
  text: z.string(),
  /** the card shown (a checkpoint the student can come back to) */
  card: z.record(z.string(), z.unknown()).optional(),
  extra: z.unknown().optional(),
});
export type Entry = z.infer<typeof EntrySchema>;
const ConvSchema = z.object({
  schema: z.literal(1),
  id: z.string(),
  kind: z.enum(["lesson", "practice"]),
  type: z.enum(CONV_TYPES),
  courseNumber: z.string(),
  stageId: z.string().optional(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  entries: z.array(EntrySchema),
  state: z.unknown().optional(),
});
export type Conversation = z.infer<typeof ConvSchema>;
export type ConvMeta = Pick<Conversation, "id" | "type" | "title" | "updatedAt" | "stageId">;

const dir = (n: string) => join(chatHistory(useSettings.getState().settings.dataRoot), n);
const file = (n: string, id: string) => join(dir(n), `${id.replace(/[^\w-]/g, "")}.json`);

// One write at a time per file: a slide and a button press arriving together must both land.
const queues = new Map<string, Promise<unknown>>();
function serial<T>(key: string, f: () => Promise<T>): Promise<T> {
  const p = (queues.get(key) ?? Promise.resolve()).then(f, f);
  queues.set(key, p.catch(() => undefined));
  return p;
}

export async function createConv(n: string, c: Pick<Conversation, "kind" | "type" | "title"> & { id?: string; stageId?: string; state?: unknown }): Promise<Conversation> {
  const now = nowIso();
  const conv: Conversation = { schema: 1, id: c.id ?? newId(), kind: c.kind, type: c.type, courseNumber: n, title: c.title, createdAt: now, updatedAt: now, entries: [], ...(c.stageId ? { stageId: c.stageId } : {}), ...(c.state !== undefined ? { state: c.state } : {}) };
  await serial(file(n, conv.id), () => writeJsonAtomic(file(n, conv.id), conv));
  return conv;
}
export const loadConv = (n: string, id: string) => readJsonFile(file(n, id), ConvSchema);

/** Changes a saved conversation and moves its last-action time; does nothing once it was deleted. */
export function updateConv(n: string, id: string, f: (c: Conversation) => Conversation): Promise<Conversation | null> {
  return serial(file(n, id), async () => {
    const c = await loadConv(n, id);
    if (!c) return null;
    const next = { ...f(c), updatedAt: nowIso() };
    await writeJsonAtomic(file(n, id), next);
    return next;
  });
}
export const addEntry = (n: string, id: string, e: Omit<Entry, "at">) => updateConv(n, id, (c) => ({ ...c, entries: [...c.entries, { at: nowIso(), ...e }] }));
/** Saves a practice session's state, creating its conversation the first time. */
export async function saveState(n: string, id: string, meta: Pick<Conversation, "type" | "title">, state: unknown) {
  if (await updateConv(n, id, (c) => ({ ...c, ...meta, state }))) return;
  await createConv(n, { id, kind: "practice", ...meta, state });
}

export async function listConvs(n: string, kind: Conversation["kind"]): Promise<ConvMeta[]> {
  if (!(await fs().exists(dir(n)))) return [];
  const all = await Promise.all((await fs().readDir(dir(n))).filter((e) => e.isFile && e.name.endsWith(".json")).map((e) => loadConv(n, e.name.slice(0, -5))));
  return all
    .filter((c): c is Conversation => !!c && c.kind === kind)
    .map(({ id, type, title, updatedAt, stageId }) => ({ id, type, title, updatedAt, ...(stageId ? { stageId } : {}) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
export async function deleteConvs(n: string, ids: string[]) {
  for (const id of ids) await serial(file(n, id), async () => (await fs().exists(file(n, id))) && fs().remove(file(n, id)));
}

/** The last card shown: where the student comes back to. */
export const checkpoint = (c: Conversation) => c.entries.findLast((e) => e.card);
/** The conversation as text for the tutor, the newest part when it is long. */
export function transcript(c: Conversation, max = 12_000) {
  const lines = c.entries.map((e) => `[${e.who === "tutor" ? "Tutor" : "Student"} · ${e.kind}] ${e.text}`);
  let out = "";
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = `${lines[i]}\n`;
    if (out.length + l.length > max) return `(earlier part left out)\n${out}`;
    out = l + out;
  }
  return out.trim();
}
