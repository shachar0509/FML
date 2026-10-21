import { callStructured } from "@/core/claude/structured";
import { enrichPrompt, refinePrompt, revisionFixMsg } from "@/core/claude/prompts/refine";
import { ClaudeError } from "@/core/claude/errors";
import type { ClaudeGateway, Message } from "@/core/claude/types";
import { PlanJsonSchema, type CourseJson, type FileIndex, type PlanJson, type Stage, type Unit } from "@/core/domain/dataSchemas";
import { pool } from "@/core/domain/ingest/index";
import { listFileIndexes, readFileIndex, writeFileIndex } from "@/core/domain/ingest/indexStore";
import { appendEvent, recomputeProgress } from "@/core/domain/progress/store";
import { readJsonFile, writeJsonAtomic, writeTextAtomic } from "@/core/lib/fs/atomicWrite";
import { coursePaths } from "@/core/lib/fs/paths";
import { stageId, unitId } from "@/core/lib/ids";
import { nowIso } from "@/core/lib/time";
import { useSettings } from "@/stores/settings";
import { detailUnit, type PlanProgress, type UnitDetails } from "./generate";
import { outlineText, renderPlanMd, validatePlan } from "./plan";
import { submitPlanRevision, submitStageAdditions, type PlanRevision, type StageAdditions } from "./refineTool";

const SYSTEM = "You are an expert university curriculum designer.";

/** Rule check on the model's revision (4.6); returns correction lines. */
export function revisionErrors(old: PlanJson, rev: PlanRevision): string[] {
  const known = new Set(old.stages.map((s) => s.id));
  const parts = new Map<string, number>();
  for (const s of rev.units.flatMap((u) => u.stages)) if (s.sourceId) parts.set(s.sourceId, (parts.get(s.sourceId) ?? 0) + 1);
  const errs: string[] = [];
  for (const id of parts.keys()) if (!known.has(id)) errs.push(`Unknown sourceId ${id}.`);
  for (const [id, n] of parts) if (n > 3) errs.push(`Stage ${id} is split into ${n} parts; at most 3.`);
  const missing = [...known].filter((id) => !parts.has(id));
  if (missing.length) errs.push(`Stages must never be deleted or merged; missing sourceIds: ${missing.join(", ")}.`);
  return errs;
}

/**
 * Pure: assign ids (first part keeps the original, the rest get next unused numbers), orders and units.
 * `fresh` = new or split stages (need Pass B; their detail fields are placeholders). idMap: original -> LAST part.
 */
export function applyRevision(old: PlanJson, rev: PlanRevision) {
  const byId = new Map(old.stages.map((s) => [s.id, s]));
  let nextNo = Math.max(0, ...old.stages.map((s) => Number(s.id.slice(1)))) + 1;
  const seen = new Set<string>();
  const total = new Map<string, number>();
  const flat = rev.units.flatMap((u, ui) => u.stages.map((s) => ({ s, ui })));
  for (const { s } of flat) if (s.sourceId) total.set(s.sourceId, (total.get(s.sourceId) ?? 0) + 1);
  const ids = flat.map(({ s }) => {
    if (s.sourceId && !seen.has(s.sourceId)) return seen.add(s.sourceId), s.sourceId;
    return stageId(nextNo++);
  });
  const idMap: Record<string, string | null> = {};
  flat.forEach(({ s }, i) => {
    if (s.sourceId) idMap[s.sourceId] = ids[i] as string;
  });
  const fresh = new Set<string>();
  const units: Unit[] = rev.units.map((u, ui) => ({ id: unitId(ui + 1), title: u.title, summary: u.summary, stageIds: [] }));
  const stages: Stage[] = flat.map(({ s, ui }, i) => {
    const id = ids[i] as string;
    const unit = units[ui] as Unit;
    unit.stageIds.push(id);
    const prerequisites = [...new Set(s.prerequisites)].filter((p) => p >= 1 && p < i + 1).map((p) => ids[p - 1] as string);
    const o = s.sourceId && total.get(s.sourceId) === 1 ? byId.get(s.sourceId) : undefined;
    if (!o) fresh.add(id);
    return {
      objectives: [], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 20,
      ...o, id, unitId: unit.id, order: i + 1, title: s.title, summary: s.summary, kind: s.kind, prerequisites,
    };
  });
  return { units, stages, fresh, idMap };
}

/** Pure: ids present in `next` but not in `prev` (UI "New" badge). */
export const newStageIds = (prev: PlanJson, next: PlanJson): Set<string> => {
  const had = new Set(prev.stages.map((s) => s.id));
  return new Set(next.stages.map((s) => s.id).filter((id) => !had.has(id)));
};

/** Pure: remap an index record made under an older plan version through idMap (4.6). */
export function remapIndex(rec: FileIndex, idMap: Record<string, string | null>, version: number): FileIndex {
  if (rec.planVersion === null || rec.planVersion >= version) return rec;
  const m = (id: string) => idMap[id] ?? id;
  const list = (ids: string[]) => [...new Set(ids.map(m))];
  return {
    ...rec,
    planVersion: version,
    materialPages: rec.materialPages.map((p) => ({ ...p, stageIds: list(p.stageIds) })),
    exercises: rec.exercises.map((e) => ({ ...e, requiredStageIds: list(e.requiredStageIds), primaryStageId: m(e.primaryStageId) })),
  };
}

const STAGE_CHARS = 1500;
const UNCOVERED_CHARS = 8000;
const ENRICH_CHARS = 6000; // file lines per enrich job; a stage with more is checked in several parts, so no line is cut

/** Takes lines round-robin across files until `budget` chars: a long file A never crowds out file B. */
function fair(byFile: Map<string, string[]>, budget: number): string[] {
  const out: string[] = [];
  let used = 0;
  const lists = [...byFile.values()];
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) {
      const line = l[i];
      if (line === undefined) continue;
      if (used + line.length > budget) return out;
      out.push(line);
      used += line.length + 1;
    }
  return out;
}

/**
 * Pure (M40): what every file says, grouped by stage, so a subject shared by several files is judged once with all its lines.
 * Lines repeated across files (same text) are kept once; lines no known stage claims go to `uncovered` (new stages come from there).
 */
export function stageEvidence(indexes: FileIndex[], known: Set<string>) {
  const by = new Map<string, Map<string, string[]>>();
  const seen = new Map<string, Set<string>>();
  const add = (stage: string, file: string, where: string, body: string) => {
    const key = body.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key) return;
    const s = seen.get(stage) ?? new Set<string>();
    if (s.has(key)) return;
    seen.set(stage, s.add(key));
    const files = by.get(stage) ?? new Map<string, string[]>();
    by.set(stage, files.set(file, [...(files.get(file) ?? []), `- ${file} ${where}: ${body}`]));
  };
  for (const r of indexes) {
    if (r.status !== "indexed") continue;
    // M41: traps, key points and page notes are lines of their own: short, each kept, never folded into a summary
    for (const m of r.materialPages) {
      const ids = m.stageIds.filter((id) => known.has(id));
      for (const id of ids.length ? ids : [""]) {
        add(id, r.fileName, `p${m.page}`, m.summary);
        for (const n of m.notes ?? []) add(id, r.fileName, `p${m.page}`, `note: ${n}`);
      }
    }
    for (const e of r.exercises) {
      // ponytail: gist (or the statement's first 300 chars); enough to name what the exercise is about.
      const ids = e.requiredStageIds.filter((id) => known.has(id));
      for (const id of ids.length ? ids : [""]) {
        add(id, r.fileName, e.label, `[${e.type}] ${e.gist || e.statementMd.replace(/\s+/g, " ").slice(0, 300)}`);
        for (const x of e.edgeCaseFocus) add(id, r.fileName, e.label, `trap: ${x}`);
        for (const x of e.keyPoints ?? []) add(id, r.fileName, e.label, `key point: ${x}`);
      }
    }
  }
  const lines = (id: string, budget: number) => fair(by.get(id) ?? new Map(), budget);
  return {
    stage: (id: string) => lines(id, STAGE_CHARS),
    /** Every line of the stage, no budget (enrich splits them into parts). */
    all: (id: string) => lines(id, Infinity),
    uncovered: lines("", UNCOVERED_CHARS),
  };
}

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const union = (a: string[], b: string[]) => [...a, ...b.filter((x, i) => norm(x) && !a.some((y) => norm(y) === norm(x)) && b.findIndex((y) => norm(y) === norm(x)) === i)];

/** Pure (M40): adds what the model found missing; existing items are never removed, repeats are no-ops. */
export function mergeAdditions(s: Stage, a: StageAdditions): Stage {
  return {
    ...s,
    techniques: union(s.techniques, a.techniques),
    edgeCases: union(s.edgeCases, a.edgeCases),
    theorems: [...s.theorems, ...a.theorems.filter((t, i) => norm(t.name) && !s.theorems.some((x) => norm(x.name) === norm(t.name)) && a.theorems.findIndex((x) => norm(x.name) === norm(t.name)) === i)],
  };
}

type EnrichPart = { id: string; lines: string[]; of?: { k: number; n: number } }[];

/** Pure (M41): packs every stage's file lines into enrich jobs of about ENRICH_CHARS; a stage with more lines spans several parts. */
export function enrichParts(xs: { s: Stage; lines: string[] }[], max = ENRICH_CHARS): EnrichPart[] {
  const chunks = xs.flatMap(({ s, lines }) => {
    const out: string[][] = [];
    let cur: string[] = [];
    let len = 0;
    for (const l of lines) {
      if (cur.length && len + l.length > max) {
        out.push(cur);
        cur = [];
        len = 0;
      }
      cur.push(l);
      len += l.length + 1;
    }
    if (cur.length) out.push(cur);
    return out.map((lines, k) => ({ id: s.id, lines, of: out.length > 1 ? { k: k + 1, n: out.length } : undefined }));
  });
  const parts: EnrichPart[] = [];
  let len = Infinity;
  for (const c of chunks) {
    const size = c.lines.join("\n").length;
    if (len + size > max) {
      parts.push([]);
      len = 0;
    }
    (parts.at(-1) as EnrichPart).push(c);
    len += size;
  }
  return parts;
}

type Opts = { gw: ClaudeGateway; course: CourseJson; lang: "he" | "en"; onProgress?: (p: PlanProgress) => void; signal?: AbortSignal };

/** Spec 4.6. Throws on failure; the old plan stays untouched until everything is validated. */
export async function refinePlan(opts: Opts): Promise<PlanJson> {
  const { gw, course, lang, onProgress, signal } = opts;
  const p = coursePaths(useSettings.getState().settings.dataRoot, course.courseNumber);
  const old = await readJsonFile(p.planJson, PlanJsonSchema);
  if (!old) throw new ClaudeError("invalid_output", "plan.json missing");
  const indexes = await listFileIndexes(course.courseNumber);
  const ev = stageEvidence(indexes, new Set(old.stages.map((s) => s.id)));
  const byId = new Map(old.stages.map((s) => [s.id, s]));
  const planText = old.units
    .map((u) => `${u.id} ${u.title}\n` + u.stageIds.map((id) => [`  ${id} [${byId.get(id)?.kind}] ${byId.get(id)?.title} — ${byId.get(id)?.summary}`, ...ev.stage(id).map((l) => `    ${l}`)].join("\n")).join("\n"))
    .join("\n");

  onProgress?.({ step: "plan" });
  let messages: Message[] = [{ role: "user", content: refinePrompt(course, planText, ev.uncovered.join("\n"), lang === "he" ? "Hebrew" : "English") }];
  let rev: PlanRevision;
  let model: string;
  for (let fix = 0; ; fix++) {
    const { value, response } = await callStructured(gw, submitPlanRevision, {
      task: "plan", courseNumber: course.courseNumber, system: SYSTEM, messages, signal,
    });
    const errs = revisionErrors(old, value);
    if (!errs.length) {
      rev = value;
      model = response.model;
      break;
    }
    if (fix >= 2) throw new ClaudeError("invalid_output", `plan revision invalid: ${errs.join(" ")}`);
    const use = response.content.find((b) => b.type === "tool_use") as { id: string } | undefined;
    const msg = revisionFixMsg(errs);
    messages = [
      ...messages,
      { role: "assistant", content: response.content },
      { role: "user", content: use ? [{ type: "tool_result", tool_use_id: use.id, content: msg, is_error: true }] : msg },
    ];
  }

  const { units, stages, fresh, idMap } = applyRevision(old, rev);
  // Pass B for new/split stages, and enrich for kept stages the files say something about; grouped by unit, max 3 in parallel.
  const text = outlineText(units, stages);
  const jobs = units.map((u) => ({ ...u, stageIds: u.stageIds.filter((id) => fresh.has(id)) })).filter((u) => u.stageIds.length);
  const byNew = new Map(stages.map((s) => [s.id, s]));
  const enrich = enrichParts(stages.filter((s) => !fresh.has(s.id)).map((s) => ({ s, lines: ev.all(s.id) })));
  const details = new Map<string, UnitDetails>();
  const additions = new Map<string, StageAdditions[]>();
  let done = 0;
  const n = jobs.length + enrich.length;
  const tick = () => onProgress?.({ step: "plan", unit: { k: ++done, n } });
  await pool<{ unit: Unit } | { part: EnrichPart }, unknown>([...jobs.map((unit) => ({ unit })), ...enrich.map((part) => ({ part }))], 3, async (j) => {
    if ("unit" in j) for (const [id, d] of await detailUnit(opts, text, j.unit)) details.set(id, d);
    else {
      const ids = j.part.map((x) => x.id);
      const body = j.part
        .map(({ id, lines, of }) => {
          const s = byNew.get(id) as Stage;
          const has = [`objectives (fixed): ${s.objectives.join("; ") || "none"}`, `techniques: ${s.techniques.join("; ") || "none"}`, `edge cases: ${s.edgeCases.join("; ") || "none"}`, `theorems: ${s.theorems.map((t) => t.name).join("; ") || "none"}`];
          return [`${id} ${s.title} — ${s.summary}`, ...has.map((h) => `  ${h}`), `  The course files say${of ? ` (part ${of.k} of ${of.n} of its lines)` : ""}:`, ...lines.map((l) => `    ${l}`)].join("\n");
        })
        .join("\n\n");
      try {
        const { value } = await callStructured(gw, submitStageAdditions, {
          task: "plan", courseNumber: course.courseNumber, system: SYSTEM, messages: [{ role: "user", content: enrichPrompt(course, body, lang === "he" ? "Hebrew" : "English") }], signal,
        });
        for (const a of value.stages) if (ids.includes(a.id)) additions.set(a.id, [...(additions.get(a.id) ?? []), a]);
      } catch (e) {
        if (signal?.aborted) throw e; // otherwise the stages keep their details: enriching is a bonus, not a reason to fail the build
      }
    }
    tick();
  });

  onProgress?.({ step: "validate" });
  const plan: PlanJson = {
    ...old,
    version: old.version + 1,
    generatedAt: nowIso(),
    model,
    courseKind: rev.courseKind,
    units,
    stages: stages.map((s) => {
      const d = details.get(s.id);
      if (d) return { ...s, ...d, estimatedMinutes: Math.min(45, Math.max(20, Math.round(d.estimatedMinutes))) };
      return (additions.get(s.id) ?? []).reduce(mergeAdditions, s);
    }),
  };
  const errs = validatePlan(plan, course.credits);
  if (errs.length) throw new ClaudeError("invalid_output", `plan invalid: ${errs.slice(0, 5).join("; ")}`);

  await writeJsonAtomic(`${p.history}/plan-v${old.version}.json`, old);
  await writeJsonAtomic(p.planJson, plan);
  await writeTextAtomic(p.planMd, renderPlanMd(course, plan));
  await writeJsonAtomic(p.courseJson, { ...course, courseKind: plan.courseKind, planVersion: plan.version, updatedAt: nowIso() });
  await appendEvent(course.courseNumber, { type: "plan_replaced", fromVersion: old.version, toVersion: plan.version, idMap });
  // Re-read at commit: a file removed during the AI work is not resurrected, and a record written meanwhile is not clobbered.
  for (const { sha256 } of indexes) {
    const r = await readFileIndex(course.courseNumber, sha256);
    const m = r && remapIndex(r, idMap, plan.version);
    if (m && m !== r) await writeFileIndex(course.courseNumber, m);
  }
  await recomputeProgress(course.courseNumber);
  return plan;
}
