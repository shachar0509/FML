import { TASK_IDS, type Settings } from "@/domain/schemas";

export { TASK_IDS };
export type TaskId = (typeof TASK_IDS)[number];

const OPUS = "claude-opus-5-5";
const SONNET = "claude-sonnet-5-5";

// Spec 9.2.
export const TASKS: Record<TaskId, { model: string; maxTokens: number }> = {
  plan: { model: OPUS, maxTokens: 16000 },
  index: { model: SONNET, maxTokens: 8000 },
  tutor: { model: SONNET, maxTokens: 4096 },
  grading: { model: OPUS, maxTokens: 8000 },
  generation: { model: OPUS, maxTokens: 8000 },
  hint: { model: SONNET, maxTokens: 1500 },
  summary: { model: SONNET, maxTokens: 3000 },
  retrieval: { model: SONNET, maxTokens: 2500 },
  ask: { model: SONNET, maxTokens: 2000 },
};

/** Dev builds only: VITE_SHALAV_DEV_MODEL forces every task onto one model. */
export const devModel = (): string | undefined =>
  import.meta.env.DEV ? (import.meta.env.VITE_SHALAV_DEV_MODEL as string | undefined) || undefined : undefined;

export function resolveModel(task: TaskId, settings: Pick<Settings, "models">): string {
  return devModel() ?? settings.models[task] ?? TASKS[task].model;
}

const FAMILIES = ["opus", "sonnet", "haiku"] as const;
const family = (id: string) => FAMILIES.find((f) => id.includes(f));

/**
 * If `model` is not in `available`, return the newest available model of the same family
 * (list order is newest-first, as `models.list()` returns it). `substituted` drives the one-time notice.
 */
export function pickAvailable(model: string, available: string[]): { model: string; substituted: boolean } {
  if (available.length === 0 || available.includes(model)) return { model, substituted: false };
  const f = family(model);
  const alt = f ? available.find((m) => m.includes(f)) : undefined;
  return alt ? { model: alt, substituted: true } : { model, substituted: false };
}

const DAY = 24 * 3600 * 1000;

/** models.list() cached 24 h in memory; a failing list yields [] (= trust the configured id). */
export function modelCatalog(fetchIds: () => Promise<string[]>, now: () => number = Date.now) {
  let cache: { at: number; ids: string[] } | undefined;
  return async (): Promise<string[]> => {
    if (cache && now() - cache.at < DAY) return cache.ids;
    try {
      cache = { at: now(), ids: await fetchIds() };
    } catch {
      return cache?.ids ?? [];
    }
    return cache.ids;
  };
}
