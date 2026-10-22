import type { Event, NodeKind, PlanJson } from "@/core/domain/dataSchemas";

/**
 * The student's knowledge graph (M61): seeded from the plan (each stage's concepts, theorems, techniques, edge cases),
 * grown by the tutor/grader (node_added / node_linked events: skills, course conventions, misconceptions).
 * Pure: rebuilt from the plan and the event log, so replay always gives the same graph.
 */
export type GraphNode = { id: string; kind: NodeKind; label: string; stageIds: string[]; origin: "plan" | "tutor" | "grader" | "index"; why?: string };
export type Graph = { nodes: GraphNode[]; requires: Record<string, string[]> };

/** FNV-1a, 32 bit, base36: works for any script (a slug would turn Hebrew labels into nothing). */
const fnv1a = (s: string) => {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0) as number;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
};
export const normLabel = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
/** `S003/concept/1x2y3z`; a node of no stage (a course-wide skill) is `G/skill/…`. */
export const nodeId = (stageId: string | null, kind: NodeKind, label: string) => `${stageId ?? "G"}/${kind}/${fnv1a(normLabel(label))}`;
export const stageOf = (id: string) => (/^S\d{3}\//.test(id) ? id.slice(0, 4) : null);

export function planGraph(plan: PlanJson): Graph {
  const nodes: GraphNode[] = [];
  const requires: Record<string, string[]> = {};
  const byStage = new Map<string, GraphNode[]>();
  const seen = new Set<string>();
  for (const s of plan.stages) {
    const own: GraphNode[] = [];
    const add = (kind: NodeKind, label: string) => {
      const id = nodeId(s.id, kind, label);
      if (!label.trim() || seen.has(id)) return;
      seen.add(id);
      own.push({ id, kind, label: label.trim(), stageIds: [s.id], origin: "plan" });
    };
    s.newConcepts.forEach((c) => add("concept", c));
    s.theorems.forEach((t) => add("theorem", t.name));
    s.techniques.forEach((t) => add("technique", t));
    s.edgeCases.forEach((e) => add("edge", e));
    if (!own.length) add("concept", s.title); // a stage with no listed concepts is one concept: itself
    byStage.set(s.id, own);
    nodes.push(...own);
  }
  for (const s of plan.stages) {
    const own = byStage.get(s.id) ?? [];
    const base = own.filter((n) => n.kind === "concept");
    const before = s.prerequisites.flatMap((p) => byStage.get(p) ?? []).map((n) => n.id);
    for (const n of own) {
      // theorems, techniques and edge cases build on the stage's concepts; everything builds on the prerequisite stages
      const inStage = n.kind === "concept" ? [] : base.map((b) => b.id);
      const r = [...new Set([...before, ...inStage])];
      if (r.length) requires[n.id] = r;
    }
  }
  return { nodes, requires };
}

/** The plan's graph plus what the tutor/grader added. Events must already be mapped (mapEvents). */
export function graphOf(plan: PlanJson, events: Event[]): Graph {
  const g = planGraph(plan);
  const ids = new Set(g.nodes.map((n) => n.id));
  const stages = new Set(plan.stages.map((s) => s.id));
  for (const e of events) {
    if (e.type === "node_added" && !ids.has(e.nodeId)) {
      ids.add(e.nodeId);
      g.nodes.push({ id: e.nodeId, kind: e.kind, label: e.label, stageIds: e.stageIds.filter((s) => stages.has(s)), origin: e.origin, why: e.why });
      const r = e.requires.filter((x) => ids.has(x));
      if (r.length) g.requires[e.nodeId] = r;
    } else if (e.type === "node_linked" && ids.has(e.from) && ids.has(e.to) && e.from !== e.to) {
      g.requires[e.from] = [...new Set([...(g.requires[e.from] ?? []), e.to])];
    }
  }
  return g;
}

/** The nodes of these stages (what a stage-level answer from before M62 tested). */
export const nodesOfStages = (g: Graph, stageIds: string[]) => {
  const want = new Set(stageIds);
  return g.nodes.filter((n) => n.stageIds.some((s) => want.has(s)));
};

/**
 * The engine names a concept by its display label, so labels must be unique: a repeated label gets its stage title.
 * `taken` keeps the names already given (map.json), so a name never changes once the engine has it.
 */
export function engineNames(g: Graph, plan: PlanJson, taken: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = { ...taken };
  const used = new Set(Object.values(out));
  const stageTitle = new Map(plan.stages.map((s) => [s.id, s.title]));
  const cap = (s: string) => (s.length > 80 ? `${s.slice(0, 79)}…` : s);
  for (const n of g.nodes) {
    if (out[n.id]) continue;
    let name = cap(n.label);
    if (used.has(name)) name = cap(`${n.label} · ${stageTitle.get(n.stageIds[0] ?? "") ?? n.kind}`);
    for (let k = 2; used.has(name); k++) name = cap(`${n.label} (${k})`);
    out[n.id] = name;
    used.add(name);
  }
  return out;
}
