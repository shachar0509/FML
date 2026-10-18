import { appendJsonl, readJsonl } from "@/lib/fs/jsonl";
import { join } from "@/lib/fs/paths";
import type { UsageEntry } from "@/claude/gateway";
import pricingJson from "@/claude/pricing.json";

export type Pricing = Record<
  string,
  { inputPerMTok: number; outputPerMTok: number; cacheWritePerMTok: number; cacheReadPerMTok: number }
>;
const PRICING = pricingJson as Pricing;

/** Device-local (never synced), spec 9.7. */
export const usagePath = (configDir: string) => join(configDir, "usage.jsonl");
export const logUsage = (configDir: string, e: UsageEntry) => appendJsonl(usagePath(configDir), e);
export const readUsage = (configDir: string) => readJsonl<UsageEntry>(usagePath(configDir));

/** USD estimate; undefined when the model has no pricing (UI then shows tokens only). */
export function costUsd(e: UsageEntry, pricing: Pricing = PRICING): number | undefined {
  const p = pricing[e.model];
  if (!p) return undefined;
  return (
    (e.input_tokens * p.inputPerMTok +
      e.output_tokens * p.outputPerMTok +
      e.cache_creation_input_tokens * p.cacheWritePerMTok +
      e.cache_read_input_tokens * p.cacheReadPerMTok) /
    1e6
  );
}

export type Totals = { input: number; output: number; cacheWrite: number; cacheRead: number; usd: number };
const zero = (): Totals => ({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 });

/** Month (local time, "YYYY-MM") totals overall, per task and per course. */
export function summarizeMonth(entries: UsageEntry[], month: string, pricing?: Pricing) {
  const total = zero();
  const byTask: Record<string, Totals> = {};
  const byCourse: Record<string, Totals> = {};
  for (const e of entries) {
    const d = new Date(e.ts);
    if (`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` !== month) continue;
    const usd = costUsd(e, pricing) ?? 0;
    for (const t of [total, (byTask[e.task] ??= zero()), (byCourse[e.courseNumber ?? "-"] ??= zero())]) {
      t.input += e.input_tokens;
      t.output += e.output_tokens;
      t.cacheWrite += e.cache_creation_input_tokens;
      t.cacheRead += e.cache_read_input_tokens;
      t.usd += usd;
    }
  }
  const inAll = total.input + total.cacheWrite + total.cacheRead;
  return { total, byTask, byCourse, cacheShare: inAll ? total.cacheRead / inAll : 0 };
}

/** Monthly cap (9.7): "ok" | "warn" (>=80 %, toast once) | "stop" (>=100 %, dialog before new requests). */
export const capState = (spentUsd: number, capUsd: number | null): "ok" | "warn" | "stop" =>
  capUsd === null || capUsd <= 0 ? "ok" : spentUsd >= capUsd ? "stop" : spentUsd >= capUsd * 0.8 ? "warn" : "ok";
