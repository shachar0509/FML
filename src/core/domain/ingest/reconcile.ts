import type { z } from "zod";
import { conventionMapPrompt, conventionMergePrompt, mapMessage, mergeMessage, separationMessage, separationPrompt, useCaseMessage, useCasePrompt } from "@/core/claude/prompts/conventions";
import { callStructured } from "@/core/claude/structured";
import { submitUseCaseClusters, submitUseCaseConventions, submitUseCaseMerge, submitUseCaseSeparation, type Tool } from "@/core/claude/tools";
import type { ClaudeGateway } from "@/core/claude/types";
import { type Convention, type ConventionsFile, ConventionsFileSchema, EventSchema, PlanJsonSchema, type PlanJson } from "@/core/domain/dataSchemas";
import { type Candidates, type Draft, type Judged, type Occurrence, candidatesOf, conventionId, judgeUseCase, ordered, pruneSources, separable, shouldRetire } from "@/core/domain/knowledge/conventions";
import { appendEvent } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { sha256Hex } from "@/core/lib/hash";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { listFileIndexes } from "./indexStore";
import { pool } from "./index";

/**
 * M72 reconcile (CONVENTIONS_PLAN §4, §5b): map (clusters per chunk, parallel) → merge (one job over summaries) → per use case (parallel,
 * incremental) → separation of similar pairs → deterministic apply. The model only proposes; judgeUseCase / separable / shouldRetire decide.
 */
const CHUNK = 60;
const WIDE = 4;
const KEEP_INCONSISTENT = 50;

type Item = { id: string; sha: string; fileName: string; text: string; unit: number; useCase: string; practice: string; absence: boolean };
type Cluster = { key: string; useCase: string; ids: string[]; practices: string[] };
type Ok = Extract<Judged, { ok: true }>;
/** an accepted draft; trigger/on/notWhen may be sharpened by a separation before it is applied */
type Pick = { ok: Ok; draft: Draft; idx: number; uc: UseCase; existing: Convention | null; trigger: string; on: Draft["on"]; notWhen: string[]; dist: { from: Pick; difference: string }[]; dropped: boolean; id: string };
type UseCase = { useCase: string; ids: Set<string>; key: string; hash: string; evidence: boolean; run: boolean; picks: Pick[]; contradicts: { convention: number; existing: number; resolution: string }[] };
type Counts = { added: number; refined: number; retired: number; conflicts: number; skipped: boolean };

/** server repair: unknown ids dropped, an id listed twice keeps its first place */
const fresh = (ids: string[], ok: (id: string) => boolean, seen: Set<string>) => ids.filter((id) => ok(id) && !seen.has(id) && (seen.add(id), true));
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function itemsOf(c: Candidates, plan: PlanJson): Item[] {
  const unitOf = (stages: string[]) => {
    const u = plan.units.findIndex((x) => stages[0] !== undefined && x.stageIds.includes(stages[0]));
    return u < 0 ? plan.units.length : u;
  };
  const occ = (x: Occurrence, absence: boolean): Item => ({
    id: x.id, sha: x.sha, fileName: x.fileName, unit: unitOf(x.stageIds), useCase: x.useCase, practice: x.practice, absence,
    text: `${x.id} | ${x.fileName} · ${x.label} | ${absence ? "ABSENT, situation" : "situation"}: ${x.useCase} | ${absence ? "practice NOT followed" : "practice"}: ${x.practice} | stages: ${x.stageIds.join(", ") || "-"}`,
  });
  return [
    ...c.occurrences.map((x) => occ(x, false)),
    ...c.absences.map((x) => occ(x, true)),
    ...c.teacher.map(({ id, sha, fileName, kind, item: t }): Item => ({
      id, sha, fileName, unit: unitOf(t.stageIds), useCase: t.when, practice: t.rule, absence: false,
      text: `${id} | ${fileName} (${kind}) | teacher ${t.type} | rule: ${t.rule} | the teacher wrote: "${t.quote}" | situation: ${t.when} | part: ${t.exercise ?? "?"} | level: ${t.level} | stages: ${t.stageIds.join(", ") || "-"}`,
    })),
  ];
}

const hashOf = (items: Item[], reg: ConventionsFile) =>
  sha256Hex(JSON.stringify([items.map((i) => i.id + i.text).sort(), reg.conventions.filter((x) => x.status === "active").map((x) => x.id).sort()]));

const mergeSources = (a: Convention["sources"], b: Convention["sources"]) => {
  const by = new Map(a.map((s) => [s.sha, { ...s }]));
  for (const s of b) {
    const o = by.get(s.sha);
    if (o) o.refs = [...new Set([...o.refs, ...s.refs])];
    else by.set(s.sha, { ...s });
  }
  return [...by.values()];
};

export async function reconcileConventions(o: { gw: ClaudeGateway; n: string; plan: PlanJson; lang: "he" | "en" }): Promise<Counts> {
  const { gw, n, lang } = o;
  const root = useSettings.getState().settings.dataRoot;
  const p = coursePaths(root, n);
  const L = lang === "he" ? "Hebrew" : "English";
  const now = nowIso();
  const stored = await readJsonFile(p.conventions, ConventionsFileSchema);
  const c = candidatesOf(await listFileIndexes(n));
  const reg = pruneSources(stored ?? { schema: 1, conventions: [], hashes: {}, inconsistent: [], updatedAt: now }, c.shas);
  const items = itemsOf(c, o.plan);
  const savePruned = async () => {
    if (JSON.stringify(reg.conventions) !== JSON.stringify(stored?.conventions ?? [])) await writeJsonAtomic(p.conventions, { ...reg, updatedAt: now });
  };
  const skip: Counts = { added: 0, refined: 0, retired: 0, conflicts: 0, skipped: true };

  if (!items.length) return await savePruned(), await mirror(n, reg.conventions), skip;
  const top = await hashOf(items, reg);
  if (top === reg.hashes["*"]) {
    await savePruned();
    await mirror(n, reg.conventions);
    await conventionEvidence(n, reg.conventions, c);
    return skip;
  }

  const ask = async <T extends z.ZodType>(tool: Tool<T>, system: string, content: string) =>
    (await callStructured(gw, tool, { task: "index", courseNumber: n, system, messages: [{ role: "user", content }] })).value;
  const item = new Map(items.map((i) => [i.id, i]));

  // MAP: related cases (same unit, same file) stay in one chunk
  const sorted = [...items].sort((a, b) => a.unit - b.unit || a.fileName.localeCompare(b.fileName));
  const chunks = Array.from({ length: Math.ceil(sorted.length / CHUNK) }, (_, i) => sorted.slice(i * CHUNK, (i + 1) * CHUNK));
  const system = conventionMapPrompt(L);
  const clusters = (
    await pool(chunks.map((chunk, i) => ({ chunk, i })), WIDE, async ({ chunk, i }) => {
      const v = await ask(submitUseCaseClusters, system, mapMessage(chunk.map((x) => x.text)));
      const seen = new Set<string>();
      const inChunk = new Set(chunk.map((x) => x.id));
      const out: Cluster[] = v.clusters.map((k, j) => ({ key: `${i + 1}.${j + 1}`, useCase: k.useCase, practices: k.practices, ids: fresh(k.ids, (id) => inChunk.has(id), seen) })).filter((k) => k.ids.length);
      for (const x of chunk) if (!seen.has(x.id)) out.push({ key: `${i + 1}.m-${x.id}`, useCase: x.useCase, practices: [x.practice], ids: [x.id] }); // an item the model left out stays alone
      return out;
    })
  ).flat();

  // MERGE: one job over the summaries; `slots` keeps the model's numbering for `similar`
  const byKey = new Map(clusters.map((k) => [k.key, k]));
  const summary = (k: Cluster) => `${k.key} | ${k.useCase} | practices: ${k.practices.join("; ")} | ${k.ids.length} items in ${new Set(k.ids.map((id) => item.get(id)?.sha)).size} files`;
  const merged = await ask(submitUseCaseMerge, conventionMergePrompt(L), mergeMessage(clusters.map(summary)));
  const seenKeys = new Set<string>();
  const slots: ({ useCase: string; ids: string[] } | null)[] = merged.useCases.map((u) => {
    const ks = fresh(u.clusters, (k) => byKey.has(k), seenKeys);
    return ks.length ? { useCase: u.useCase, ids: ks.flatMap((k) => byKey.get(k)?.ids ?? []) } : null;
  });
  for (const k of clusters) if (!seenKeys.has(k.key)) slots.push({ useCase: k.useCase, ids: k.ids });

  const active = ordered(reg.conventions);
  const listed = active.map((x, i) => `${i + 1}. [${x.source}] ${x.rule} — trigger: ${x.useCase.trigger} — from: ${[...new Set(x.sources.map((s) => s.fileName))].join(", ") || "(its files are gone)"}`);
  const ucOf = new Map<{ useCase: string; ids: string[] }, UseCase>();
  for (const s of slots) {
    if (!s) continue;
    const sortedIds = [...s.ids].sort();
    const key = await sha256Hex(sortedIds.join(","));
    const hash = await sha256Hex(sortedIds.map((id) => item.get(id)?.text).join("\n"));
    // nothing to follow without an occurrence or a teacher item; an unchanged use case keeps its conventions as they are
    const evidence = s.ids.some((id) => !item.get(id)?.absence);
    ucOf.set(s, { useCase: s.useCase, ids: new Set(s.ids), key, hash, evidence, run: evidence && reg.hashes[key] !== hash, picks: [], contradicts: [] });
  }
  const ucs = [...ucOf.values()];
  const ucAt = (k: number) => { const s = slots[k - 1]; return s ? ucOf.get(s) : undefined; };
  // a similar pair is separated only between fresh picks: when one side runs, the unchanged side runs too
  for (const { a, b } of merged.similar) {
    const ua = ucAt(a), ub = ucAt(b);
    if (ua && ub && (ua.run || ub.run)) for (const u of [ua, ub]) u.run ||= u.evidence;
  }
  const kept = new Set(active.filter((x) => ucs.some((u) => !u.run && x.sources.some((s) => s.refs.some((r) => u.ids.has(r))))).map((x) => x.id));
  const inconsistent: ConventionsFile["inconsistent"] = [];
  const logged = (u: UseCase, practices: string[], refs: string[]) => inconsistent.push({ useCase: u.useCase, practices, refs: refs.filter((r) => u.ids.has(r)), at: now });

  // PER USE CASE: ids the job put in it are the only ones the server counts
  await pool(ucs.filter((u) => u.run), WIDE, async (u) => {
    const lines = [...u.ids].map((id) => item.get(id)?.text ?? id);
    const v = await ask(submitUseCaseConventions, useCasePrompt(L), useCaseMessage(u.useCase, lines, listed));
    const judged = judgeUseCase(v.conventions, u.ids, c);
    judged.forEach((j, i) => {
      if (!j.ok) return void (j.why.startsWith("inconsistent") && logged(u, [j.draft.rule], j.draft.followed));
      const d = j.draft;
      u.picks.push({ ok: j, draft: d, idx: i + 1, uc: u, existing: d.sameAs ? (active[d.sameAs - 1] ?? null) : null, trigger: d.trigger, on: d.on, notWhen: d.notWhen, dist: [], dropped: false, id: "" });
    });
    for (const x of v.inconsistent) logged(u, x.practices, x.ids);
    u.contradicts = v.contradicts;
  });

  // SEPARATION: similar use cases with different practices must be told apart by a context, or the solutions-only side goes
  const pairs: { x: Pick; y: Pick; resolution: string }[] = [];
  const jobs: [Pick, Pick][] = [];
  const seenPair = new Set<string>();
  for (const { a, b } of merged.similar) {
    const ua = ucAt(a), ub = ucAt(b);
    if (!ua || !ub || ua === ub) continue;
    for (const x of ua.picks)
      for (const y of ub.picks) {
        const at = `${a}|${b}|${x.idx}|${y.idx}`;
        if (same(x.draft.rule, y.draft.rule) || seenPair.has(at)) continue;
        seenPair.add(at);
        jobs.push([x, y]);
      }
  }
  await pool(jobs, WIDE, async ([x, y]) => {
    if (x.dropped || y.dropped) return;
    const ids = [...new Set([...x.ok.sources, ...y.ok.sources].flatMap((s) => s.refs))];
    const desc = (k: Pick) => `source: ${k.ok.source}\nrule: ${k.draft.rule}\ntrigger: ${k.trigger}\nnotWhen: ${k.notWhen.join("; ") || "-"}`;
    const run = async (overlap: string[]) => {
      const v = await ask(submitUseCaseSeparation, separationPrompt(L), separationMessage(desc(x), desc(y), ids.map((id) => item.get(id)?.text ?? id), overlap));
      // an item the job left unlabeled counts as satisfying both: it is not told apart
      const labels = ids.map((id) => v.labels.find((l) => l.id === id) ?? { id, a: true, b: true });
      return { v, labels, verdict: separable(labels, x.ok.source, y.ok.source), both: labels.filter((l) => l.a && l.b).map((l) => l.id) };
    };
    let r = await run([]);
    if (r.verdict === "overlap") r = await run(r.both); // one retry with the overlapping ids sent back
    if (r.verdict === "overlap") {
      for (const k of [x, y]) {
        if (k.ok.source !== "solutions") continue;
        k.dropped = true;
        logged(k.uc, [k.draft.rule], k.draft.followed);
      }
      if (x.ok.source === "teacher" && y.ok.source === "teacher") pairs.push({ x, y, resolution: "both triggers can hold for one answer and the rules differ (two teacher rules): unresolved" });
      return;
    }
    for (const [k, s, from, side] of [[x, r.v.a, y, "a"], [y, r.v.b, x, "b"]] as const) {
      Object.assign(k, { trigger: s.trigger, on: s.on, notWhen: [...new Set([...k.notWhen, ...s.notWhen])] });
      k.dist.push({ from, difference: r.v.difference });
      if (k.ok.source !== "solutions") continue;
      // the sharpened trigger is counted again from the labels: only its own items that still satisfy it
      const sources = k.ok.sources.map((q) => ({ ...q, refs: q.refs.filter((id) => r.labels.some((l) => l.id === id && l[side])) })).filter((q) => q.refs.length);
      if (sources.length < 2 || sources.reduce((a, q) => a + q.refs.length, 0) < 3) {
        k.dropped = true;
        logged(k.uc, [k.draft.rule], k.draft.followed);
      } else k.ok = { ...k.ok, sources };
    }
    if (x.dropped || y.dropped) return;
    if (r.verdict === "teacher-wins") pairs.push({ x, y, resolution: `${r.v.difference}; where both trigger → the teacher's` });
  });

  // APPLY (deterministic); stage ids are filtered against the plan as it is NOW (refinePlan runs in parallel and only adds stages)
  const known = new Set(((await readJsonFile(p.planJson, PlanJsonSchema)) ?? o.plan).stages.map((s) => s.id));
  const convs = new Map(reg.conventions.map((x) => [x.id, x]));
  const taken = new Set(reg.conventions.filter((x) => x.status === "active").map((x) => x.id)); // a retired id is free: the same convention may come back
  const accepted = new Set<string>(), touched = new Set<string>(), newIds: string[] = [], retiredNow: [string, string][] = [];
  let refined = 0, conflicts = 0;
  for (const k of ucs.flatMap((u) => u.picks)) {
    if (k.dropped) continue;
    const d = k.draft;
    const stageIds = d.stageIds.filter((s) => known.has(s));
    const useCase = { trigger: k.trigger, on: k.on, notWhen: k.notWhen, examples: d.examples.slice(0, 4), verify: d.verify, level: d.level, stageIds, hints: { answerForms: d.answerForms, questionTypes: d.questionTypes } };
    const old = k.existing && !touched.has(k.existing.id) ? convs.get(k.existing.id) : undefined;
    if (old) {
      touched.add(old.id);
      refined++;
      k.id = old.id;
      // a solutions draft never rewrites a teacher convention: it only adds its sources
      convs.set(old.id, old.source === "teacher" && k.ok.source === "solutions"
        ? { ...old, sources: mergeSources(old.sources, k.ok.sources), updatedAt: now }
        : { ...old, rule: d.rule, source: k.ok.source, useCase: { ...useCase, distinguishes: old.useCase.distinguishes }, sources: mergeSources(old.sources, k.ok.sources), updatedAt: now });
    } else {
      k.id = conventionId(d.rule, stageIds, k.trigger, taken);
      const clash = taken.has(k.id) ? convs.get(k.id) : undefined; // rule and rule|trigger both taken: never overwrite, only add sources
      if (clash) {
        convs.set(k.id, { ...clash, sources: mergeSources(clash.sources, k.ok.sources), updatedAt: now });
        accepted.add(k.id);
        continue;
      }
      taken.add(k.id);
      newIds.push(k.id);
      convs.set(k.id, { id: k.id, rule: d.rule, source: k.ok.source, useCase: { ...useCase, distinguishes: [] }, sources: k.ok.sources, status: "active", conflicts: [], addedAt: now, updatedAt: now });
    }
    accepted.add(k.id);
  }
  const conflict = (a: string, b: string, resolution: string) => {
    let isNew = false;
    for (const [x, y] of [[a, b], [b, a]] as const) {
      const cv = convs.get(x);
      if (!cv) continue;
      isNew ||= !cv.conflicts.some((q) => q.with === y);
      convs.set(x, { ...cv, conflicts: [...cv.conflicts.filter((q) => q.with !== y), { with: y, resolution }], updatedAt: now });
    }
    if (isNew) conflicts++;
  };
  for (const k of ucs.flatMap((u) => u.picks)) {
    const cv = convs.get(k.id);
    if (!cv || k.dropped) continue;
    const dist = [...cv.useCase.distinguishes];
    for (const { from, difference } of k.dist) if (from.id && !from.dropped && !dist.some((q) => q.from === from.id)) dist.push({ from: from.id, difference });
    convs.set(k.id, { ...cv, useCase: { ...cv.useCase, distinguishes: dist } });
  }
  for (const { x, y, resolution } of pairs) if (!x.dropped && !y.dropped && x.id && y.id) conflict(x.id, y.id, resolution);

  const repeating = (v: Convention) => accepted.has(v.id) || (v.sources.length > 0 && (v.source === "teacher" || kept.has(v.id)));
  const retire = (v: Convention, by: Convention) => (convs.set(v.id, { ...v, status: "retired", retiredAt: now, retiredBy: by.id, updatedAt: now }), retiredNow.push([v.id, by.rule]));
  for (const u of ucs) for (const k of u.contradicts) {
    const y = u.picks.find((q) => q.idx === k.convention && !q.dropped);
    const ex = active[k.existing - 1];
    const X = ex && convs.get(ex.id), Y = y && convs.get(y.id);
    if (!X || !Y || X.id === Y.id || X.status !== "active" || Y.status !== "active") continue;
    if (shouldRetire(X, Y, repeating(Y))) retire(X, Y);
    else if (shouldRetire(Y, X, repeating(X))) retire(Y, X);
    else conflict(X.id, Y.id, k.resolution);
  }
  // a stored conflict is a contradiction too: X's files deleted while Y's use case is unchanged (skipped) must still retire X
  for (const id of [...convs.keys()])
    for (const q of convs.get(id)?.conflicts ?? []) {
      const X = convs.get(id) as Convention, Y = convs.get(q.with);
      if (Y && shouldRetire(X, Y, repeating(Y))) retire(X, Y);
    }

  const conventions = [...convs.values()];
  const next: ConventionsFile = {
    schema: 1, conventions, updatedAt: now,
    hashes: { "*": "", ...Object.fromEntries(ucs.map((u) => [u.key, u.hash])) },
    inconsistent: [...reg.inconsistent, ...inconsistent].filter((e, i, all) => all.findIndex((q) => JSON.stringify([q.useCase, q.practices, q.refs]) === JSON.stringify([e.useCase, e.practices, e.refs])) === i).slice(-KEEP_INCONSISTENT),
  };
  next.hashes["*"] = await hashOf(items, next);
  await writeJsonAtomic(p.conventions, next);

  await mirror(n, conventions);
  await conventionEvidence(n, conventions, c);
  return { added: newIds.length, refined, retired: retiredNow.length, conflicts, skipped: false };
}

/**
 * The graph mirrors the registry, idempotently from the log: an active convention without its node gets node_added, a retired one still in
 * the graph gets node_retired. Run on every reconcile, so a crash between the registry write and the events heals on the next build.
 */
async function mirror(n: string, convs: Convention[]): Promise<void> {
  const inGraph = new Set<string>();
  for (const e of await readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema))
    if (e.type === "node_added") inGraph.add(e.nodeId);
    else if (e.type === "node_retired") inGraph.delete(e.nodeId);
  const by = new Map(convs.map((x) => [x.id, x]));
  for (const x of convs) {
    if (x.status === "active" && !inGraph.has(x.id))
      await appendEvent(n, { type: "node_added", nodeId: x.id, kind: "convention", label: x.rule.slice(0, 80), why: x.useCase.trigger.slice(0, 300), stageIds: x.useCase.stageIds, requires: [], origin: x.source === "teacher" ? "teacher" : "index", refId: x.sources[0]?.sha ?? "" });
    else if (x.status === "retired" && inGraph.has(x.id))
      await appendEvent(n, { type: "node_retired", nodeId: x.id, why: `Its files are gone and a repeating convention contradicts it: ${by.get(x.retiredBy ?? "")?.rule ?? ""}`.slice(0, 300) });
  }
}

/**
 * The teacher's marks on a convention are evidence for its node (weight 2 as context "teacher"): a deduction scores 0, praise 1, a requirement nothing.
 * Once per (file sha, node): teacherEvidence already wrote other events with that refId at scan time, and a convention made by a later reconcile
 * still gets the earlier file's evidence.
 */
async function conventionEvidence(n: string, convs: Convention[], c: Candidates): Promise<void> {
  const teacher = new Map(c.teacher.map((t) => [t.id, t.item]));
  if (!convs.some((x) => x.status === "active" && x.sources.some((s) => s.kind === "graded"))) return;
  const events = await readJsonlDir(coursePaths(useSettings.getState().settings.dataRoot, n).events, EventSchema);
  const seen = new Set(events.flatMap((e) => (e.type === "node_observed" && e.refId ? [`${e.refId}|${e.nodeId}`] : [])));
  for (const x of convs) {
    if (x.status !== "active") continue;
    for (const s of x.sources) {
      const its = s.kind === "graded" ? s.refs.flatMap((r) => { const t = teacher.get(r); return t && t.type !== "requirement" ? [t] : []; }) : [];
      const at = `${s.sha}|${x.id}`;
      if (!its.length || seen.has(at)) continue;
      seen.add(at);
      const score = its.reduce((a, t) => a + (t.type === "praise" ? 1 : 0), 0) / its.length;
      await appendEvent(n, { type: "node_observed", nodeId: x.id, score, why: (its[0]?.quote ?? "").slice(0, 300), context: "teacher", refId: s.sha });
    }
  }
}
