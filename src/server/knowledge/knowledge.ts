import { join } from "node:path";
import * as z from "zod";
import type { CourseJson, Event, PlanJson, ProgressJson } from "@/core/domain/dataSchemas";
import { isCustom } from "@/core/universities";
import { priorOf, knowledgeOf, rawStars, shownStars, effective, type Knowledge } from "@/core/domain/knowledge/control";
import { engineNames, graphOf, nodesOfStages, type Graph } from "@/core/domain/knowledge/graph";
import { loadCtx } from "@/core/domain/practice/exercises";
import { mapEvents, normalizeTag } from "@/core/domain/progress/reduce";
import { onEvent } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { getDeviceId } from "@/core/lib/device";
import { useSettings } from "@/stores/settings";
import type { Engine } from "./engine";

/**
 * The student's knowledge graph per course (M61): Shalav's event log is the truth; the engine (tutor-mcp) is a derived model that
 * adds forgetting (FSRS retention), a focus concept and misconceptions. Each device keeps its own engine dir
 * (`<course>/.shalav/knowledge/<device>/`): two engines writing one synced SQLite file would corrupt it, and the log rebuilds it.
 * No engine (offline install, unsupported platform, a crash): everything still works from the log alone, without forgetting.
 */
const MapSchema = z.object({
  domainId: z.string().nullable(),
  names: z.record(z.string(), z.string()),
  sent: z.array(z.string()),
  stars: z.number().nullable(),
});
type MapFile = z.infer<typeof MapSchema>;

export type Summary = {
  graph: Graph;
  k: Knowledge;
  prior: number;
  retention: Map<string, number>;
  /** 0..5, half steps, with hysteresis */
  stars: number;
  raw: number;
  /** share of core/common nodes the student controls (≥ 0.9 after forgetting) */
  examReady: number;
  focus: string | null;
  misconceptions: { id: string; label: string; type: string; detail: string; count: number }[];
  engine: boolean;
};

const RELEVANCE = { core: 1, common: 0.7, occasional: 0.4 } as const;
const relevanceOf = (plan: PlanJson, g: Graph) => {
  const stage = new Map(plan.stages.map((s) => [s.id, s]));
  const byNode = new Map(g.nodes.map((n) => [n.id, n]));
  return (id: string) => {
    const n = byNode.get(id);
    const s = n?.stageIds[0] && stage.get(n.stageIds[0]);
    return s ? RELEVANCE[s.examRelevance] : 0.9; // a course-wide skill the tutor found matters for every answer
  };
};

/** Engine calls for one evidence event: one per node it tested. */
export function interactions(e: Event, g: Graph, names: Record<string, string>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (id: string, score: number, activity: string, extra: Record<string, unknown> = {}) => {
    const concept = names[id];
    if (!concept) return;
    const success = score >= 0.7;
    out.push({
      concept, activity_type: activity, success, response_time_seconds: 60, confidence: Math.round(score * 100) / 100,
      ...(success ? {} : { error_type: "KNOWLEDGE_GAP" }), ...extra,
    });
  };
  const of = (nodes: { id: string; score: number }[] | undefined, stageIds: string[], score: number) =>
    nodes?.length ? nodes : nodesOfStages(g, stageIds).map((n) => ({ id: n.id, score }));
  if (e.type === "check_answered") {
    for (const n of of(e.nodes, [e.stageId], e.score / 100)) push(n.id, n.score, e.kind === "mcq" ? "RECALL_EXERCISE" : "FEYNMAN_PROMPT");
  } else if (e.type === "attempt_graded" && e.verdict !== "unreadable") {
    const tag = e.mistakes[0];
    for (const n of of(e.nodes, e.stageIds, e.score / 100)) {
      const s = Math.max(0, e.solutionRevealedBefore ? Math.min(n.score - 0.1 * e.hintsUsed, 0.6) : n.score - 0.1 * e.hintsUsed);
      push(n.id, s, "PRACTICE", {
        hints_requested: e.hintsUsed,
        ...(s < 0.7 && e.mistakes.length ? { error_type: "LOGIC_ERROR" } : {}),
        ...(s < 0.7 && tag ? { misconception_type: tag.tag, misconception_detail: tag.note } : {}),
      });
    }
  } else if (e.type === "node_observed") push(e.nodeId, e.score, "PRACTICE", { notes: e.why });
  return out;
}

/** This device's knowledge files of a course (the engine's data dir is `engine/` inside). */
export const knowledgeDir = (n: string) => join(coursePaths(useSettings.getState().settings.dataRoot, n).shalav, "knowledge", getDeviceId());

export function createKnowledge(engineFor: ((course: string) => Engine) | null) {
  const queues = new Map<string, Promise<unknown>>();
  const cache = new Map<string, { at: number; s: Summary }>();
  let downUntil = 0;
  const mapPath = (n: string) => join(knowledgeDir(n), "map.json");
  const serial = <T>(n: string, f: () => Promise<T>): Promise<T> => {
    const run = (queues.get(n) ?? Promise.resolve()).then(f, f);
    queues.set(n, run.catch(() => undefined));
    return run;
  };

  /** Bring the engine up to date: plan + tutor nodes as concepts, then every answer it has not seen. */
  async function syncEngine(e: Engine, plan: PlanJson, g: Graph, events: Event[], course: { courseNumber: string; nameHe: string }, m: MapFile) {
    const names = engineNames(g, plan, m.names);
    const fresh = g.nodes.filter((x) => !m.names[x.id]);
    const prereq = (ids: string[]) => Object.fromEntries(ids.flatMap((id) => (g.requires[id]?.length ? [[names[id], g.requires[id].map((r) => names[r]).filter(Boolean)]] : [])));
    const rel = relevanceOf(plan, g);
    if (!m.domainId) {
      const r = await e.call("init_domain", { name: `${course.courseNumber} ${course.nameHe}`.slice(0, 120), concepts: g.nodes.map((x) => names[x.id]), prerequisites: prereq(g.nodes.map((x) => x.id)) });
      m.domainId = String(r.domain_id);
    } else if (fresh.length) {
      const snap = (await e.call("get_curriculum_snapshot", { domain_id: m.domainId })).snapshot as { version: number };
      await e.call("add_concepts", { domain_id: m.domainId, expected_version: snap.version, concepts: fresh.map((x) => names[x.id]), prerequisites: prereq(fresh.map((x) => x.id)), provenance: { source_type: "learner", rationale: "Shalav study plan and the tutor's observations of this student" } });
    }
    if (fresh.length) await e.call("set_goal_relevance", { domain_id: m.domainId, relevance: Object.fromEntries(fresh.map((x) => [names[x.id], rel(x.id)])) });
    m.names = names;
    const sent = new Set(m.sent);
    for (const ev of events) {
      if (sent.has(ev.id)) continue;
      for (const args of interactions(ev, g, names)) await e.call("record_interaction", { domain_id: m.domainId, ...args });
      sent.add(ev.id);
    }
    m.sent = [...sent];
  }

  async function compute(n: string): Promise<Summary> {
    const ctx = await loadCtx(n);
    const events = mapEvents(ctx.events);
    const g = graphOf(ctx.plan, events);
    const prior = priorOf(ctx.course);
    const k = knowledgeOf(g, events, prior);
    const m: MapFile = (await readJsonFile(mapPath(n), MapSchema)) ?? { domainId: null, names: {}, sent: [], stars: null };
    const retention = new Map<string, number>();
    let focus: string | null = null;
    let misconceptions: Summary["misconceptions"] = [];
    let engine = false;
    if (engineFor && Date.now() > downUntil) {
      try {
        const e = engineFor(n);
        await syncEngine(e, ctx.plan, g, events, ctx.course, m);
        const byName = new Map(Object.entries(m.names).map(([id, name]) => [name, id]));
        const olm = await e.call("get_olm_snapshot", { domain_id: m.domainId });
        for (const [name, st] of Object.entries((olm.mastery_stages ?? {}) as Record<string, { retention_estimate?: number }>)) {
          const id = byName.get(name);
          if (id && typeof st.retention_estimate === "number") retention.set(id, st.retention_estimate);
        }
        focus = byName.get(String(olm.focus_concept ?? "")) ?? null;
        const mis = (await e.call("get_misconceptions", { domain_id: m.domainId })).misconceptions as { concept: string; misconception_type: string; last_error_detail?: string; count: number; status: string }[] | undefined;
        const label = new Map(g.nodes.map((x) => [x.id, x.label]));
        misconceptions = (mis ?? []).filter((x) => x.status === "active").flatMap((x) => {
          const id = byName.get(x.concept);
          return id ? [{ id, label: label.get(id) ?? x.concept, type: x.misconception_type, detail: x.last_error_detail ?? "", count: x.count }] : [];
        });
        engine = true;
      } catch (err) {
        downUntil = Date.now() + 10 * 60_000; // try again later; meanwhile the log alone
        console.error("knowledge engine unavailable:", err instanceof Error ? err.message : err);
      }
    }
    const rel = relevanceOf(ctx.plan, g);
    const raw = rawStars(g, k, retention, rel);
    const stars = shownStars(m.stars, raw);
    const exam = g.nodes.filter((x) => rel(x.id) >= 0.7);
    const examReady = exam.length ? exam.filter((x) => effective(k, x.id, retention) >= 0.9).length / exam.length : 0;
    await writeJsonAtomic(mapPath(n), { ...m, stars }); // also keeps what reached the engine before a failure (no answer is sent twice)
    return { graph: g, k, prior, retention, stars, raw, examReady, focus, misconceptions, engine };
  }

  /** The course's knowledge now (cached briefly; any new answer refreshes it). */
  async function summary(n: string): Promise<Summary> {
    const c = cache.get(n);
    if (c && Date.now() - c.at < 30_000) return c.s;
    const s = await serial(n, () => compute(n));
    cache.set(n, { at: Date.now(), s });
    return s;
  }

  // every new answer reaches the engine soon (and the next summary sees it)
  const off = onEvent((n) => {
    cache.delete(n);
    void serial(n, () => compute(n)).then((s) => cache.set(n, { at: Date.now(), s })).catch(() => undefined);
  });

  return { summary, invalidate: (n: string) => cache.delete(n), dispose: off };
}
export type KnowledgeService = ReturnType<typeof createKnowledge>;

/** M64: the stages the engine points at now: its focus concept, active misconceptions, and controlled nodes it says are fading. */
export function hotStages(s: Summary): string[] {
  const byId = new Map(s.graph.nodes.map((n) => [n.id, n]));
  const ids = [s.focus, ...s.misconceptions.map((m) => m.id), ...dueNodes(s)];
  return [...new Set(ids.flatMap((id) => (id && byId.get(id)?.stageIds) || []))];
}
/** Nodes the student controlled that the engine's forgetting model says need a review now. */
const dueNodes = (s: Summary) => [...s.retention].filter(([id, r]) => r < 0.7 && (s.k.control.get(id) ?? 0) >= 0.6).map(([id]) => id);

/** M64: the tutor's view of the student's graph: level, weakest nodes of what is learned, misconceptions, reviews due, the target. */
export function digest(s: Summary, o: { custom: boolean; stageIds: string[]; target: number; /** the stars the student sees (shownLevel) */ stars?: number }): string {
  const want = new Set(o.stageIds);
  const label = new Map(s.graph.nodes.map((n) => [n.id, n.label]));
  const pct = (id: string) => `${Math.round(effective(s.k, id, s.retention) * 100)}%`;
  const weakest = s.graph.nodes
    .filter((n) => !n.stageIds.length || n.stageIds.some((x) => want.has(x)))
    .filter((n) => effective(s.k, n.id, s.retention) < 0.9)
    .sort((a, b) => effective(s.k, a.id, s.retention) - effective(s.k, b.id, s.retention))
    .slice(0, 5);
  const items = (a: string[]) => (a.length ? a.join("; ") : "none");
  return [
    o.custom
      ? `- Level: the student is now at ${o.stars ?? s.stars}★ of 5 in this course (from their self-rated level up). Goal: 5★.`
      : `- Level: ${s.stars}★ of 5 of the whole course; exam-ready ${Math.round(s.examReady * 100)}% (core/common nodes at ≥ 90%). Goal: 100%.`,
    `- Weakest nodes of what was learned: ${items(weakest.map((n) => `${n.label} (${pct(n.id)})`))}`,
    `- Active misconceptions: ${items(s.misconceptions.slice(0, 4).map((m) => `${m.label}: ${m.type}${m.detail ? ` — ${m.detail}` : ""} (×${m.count})`))}`,
    `- Reviews due (known, now fading): ${items(dueNodes(s).slice(0, 4).map((id) => label.get(id) ?? id))}`,
    ...(s.focus ? [`- Suggested focus: ${label.get(s.focus) ?? s.focus}`] : []),
    `- Target: questions about 3★ hard for this student (assign_exercise difficulty ${o.target}/5, its default); one step harder after a success streak. Bring every node to full proficiency (100/100 exam answers); one or two misses are not a reason to step down.`,
  ].join("\n");
}

/** The summary if it comes within `ms` (a slow or failing engine never holds a card or a lesson up). */
export const quickSummary = (k: KnowledgeService | undefined, n: string, ms = 5000): Promise<Summary | null> =>
  k ? Promise.race([k.summary(n).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms).unref?.())]) : Promise.resolve(null);
/** M65: the stars a student sees; a custom course starts at its self-rated level and only goes up from there (gentle). */
export const shownLevel = (s: Summary, course: Pick<CourseJson, "type" | "level">) => (isCustom(course) ? Math.max(course.level ?? 1, s.stars) : s.stars);

/**
 * M67: what to watch out for, from the engine's active misconceptions (resolved ones drop off as the student gets them right),
 * one row per mistake tag with its stages. Null when the engine is off or sees none: the card keeps the progress mistakes.
 */
export function watchList(s: Summary, mistakes: ProgressJson["mistakes"], lang: string): { label: string; count: number; stageIds: string[] }[] | null {
  if (!s.engine || !s.misconceptions.length) return null;
  const stagesOf = new Map(s.graph.nodes.map((n) => [n.id, n.stageIds]));
  const rows = new Map<string, { label: string; count: number; stageIds: Set<string> }>();
  for (const m of s.misconceptions) {
    const tag = normalizeTag(m.type);
    const known = mistakes.find((x) => x.tag === tag);
    const r = rows.get(tag) ?? { label: known ? (lang === "he" ? known.labelHe : known.labelEn) : m.type, count: 0, stageIds: new Set<string>() };
    r.count += m.count;
    for (const id of stagesOf.get(m.id) ?? []) r.stageIds.add(id);
    rows.set(tag, r);
  }
  return [...rows.values()].sort((a, b) => b.count - a.count).slice(0, 5).map((r) => ({ ...r, stageIds: [...r.stageIds] }));
}
