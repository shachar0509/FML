import { z } from "zod";
import type { PlanJson } from "@/core/domain/dataSchemas";
import type { Event } from "@/core/domain/dataSchemas";
import { mapEvents } from "@/core/domain/progress/reduce";
import { appendEvent } from "@/core/domain/progress/store";
import { graphOf, nodeId, normLabel, type Graph, type GraphNode } from "./graph";

/**
 * Node-tagged evidence (M62). A grader or the tutor sees the candidate nodes as short local numbers ("3. [concept] גבול"),
 * answers by number, and may add a node the graph lacks (a skill, a course convention, a misconception). The server maps
 * numbers back to ids and drops unknown ones: the model never writes an id.
 */
const MAX_LIST = 40;
/** The course graph from the raw event log. */
export const courseGraph = (plan: PlanJson, events: Event[]) => graphOf(plan, mapEvents(events));
/** tutor/grader-written nodes per course */
export const MAX_DYNAMIC = 300;

/** The nodes an answer about these stages can test: the course-wide ones (skills, conventions; room kept so they never fall off), then theirs. */
export function candidates(g: Graph, stageIds: string[]): GraphNode[] {
  const want = new Set(stageIds);
  const own = g.nodes.filter((n) => n.stageIds.some((s) => want.has(s)));
  const wide = g.nodes.filter((n) => !n.stageIds.length);
  return [...wide.slice(0, 15), ...own].slice(0, MAX_LIST);
}

export const listText = (c: GraphNode[], control?: Map<string, number>) =>
  c.map((n, i) => `${i + 1}. [${n.kind}] ${n.label}${control ? ` — control ${Math.round((control.get(n.id) ?? 0) * 100)}%` : ""}`).join("\n") || "(none yet)";

const score = z.number().min(0).max(1);
export const newNodeSchema = z.object({
  kind: z.enum(["skill", "convention", "misconception"]),
  label: z.string().min(2).max(80),
  why: z.string().min(5).max(300),
  /** empty = the whole course */
  stageIds: z.array(z.string()).max(3),
  /** the number of a listed node that is the same thing: then it is only evidence on that node */
  sameAs: z.number().int().min(1).optional(),
  score,
});
export type NewNode = z.infer<typeof newNodeSchema>;
/** Added to a grading tool's result. Defaults keep older results (and test stubs) valid. */
export const nodeFields = {
  nodeResults: z.array(z.object({ n: z.number().int().min(1), score })).max(MAX_LIST).default([]),
  newNodes: z.array(newNodeSchema).max(3).default([]),
};

export const nodeRules = (lang: string) => `Knowledge graph nodes:
- nodeResults: for each listed node this answer tested, its number and how well the answer shows it (0..1, partial credit). Leave out nodes it does not touch.
- newNodes: when you took points off for something no listed node covers — an answer-writing skill or a convention of this course seen in its example solutions or material (e.g. citing the statute and section number, stating units, checking a theorem's conditions before using it) or a recurring misconception — add it: kind, a short general label in ${lang}, why (what in this answer showed it), stageIds (empty when it applies to the whole course), score (how well this answer shows it). If it is the same as a listed node, set sameAs to that number instead. At most 3; none when the listed nodes cover it.`;

/**
 * Turns a model's node answer into evidence ids, writing `node_added` for genuinely new nodes.
 * Trust boundary: unknown numbers and stages are dropped; a label already in the graph (any kind, normalized) is that node, never a second one.
 */
export async function applyNodes(
  courseNumber: string, plan: PlanJson, g: Graph, cands: GraphNode[],
  r: { nodeResults: { n: number; score: number }[]; newNodes: NewNode[] }, refId: string, origin: "tutor" | "grader",
): Promise<{ id: string; score: number }[]> {
  const out = new Map<string, number>();
  for (const x of r.nodeResults) {
    const n = cands[x.n - 1];
    if (n) out.set(n.id, x.score);
  }
  const byLabel = new Map(g.nodes.map((n) => [normLabel(n.label), n.id]));
  const stages = new Set(plan.stages.map((s) => s.id));
  let dynamic = g.nodes.filter((n) => n.origin !== "plan").length;
  for (const x of r.newNodes) {
    const same = x.sameAs ? cands[x.sameAs - 1]?.id : undefined;
    const known = same ?? byLabel.get(normLabel(x.label));
    if (known) {
      out.set(known, x.score);
      continue;
    }
    if (dynamic >= MAX_DYNAMIC || !x.label.trim() || !x.why.trim()) continue;
    const st = x.stageIds.filter((s) => stages.has(s));
    const id = nodeId(st[0] ?? null, x.kind, x.label);
    await appendEvent(courseNumber, { type: "node_added", nodeId: id, kind: x.kind, label: x.label.trim(), why: x.why.trim(), stageIds: st, requires: [], origin, refId });
    byLabel.set(normLabel(x.label), id);
    dynamic++;
    out.set(id, x.score);
  }
  return [...out].map(([id, s]) => ({ id, score: s }));
}
