import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { callStructured } from "@/core/claude/structured";
import { defineTool } from "@/core/claude/tools";
import { EXERCISES_DIR, TEACHER_DIR } from "@/constants";
import { type Convention, type ConventionsFile, ConventionsFileSchema, type FileIndex, type PlanJson } from "@/core/domain/dataSchemas";
import { readFileIndex, writeFileIndex } from "@/core/domain/ingest/indexStore";
import { createIndexQueue } from "@/core/domain/ingest/queue";
import { reconcileConventions } from "@/core/domain/ingest/reconcile";
import type { PageSource } from "@/core/domain/ingest/types";
import { setDeviceId } from "@/core/lib/device";
import { readJsonFile } from "@/core/lib/fs/atomicWrite";
import { fs, setFs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { CliGateway } from "./cliGateway";

/**
 * M72 semantic eval (real model, CONVENTIONS_PLAN Verification A): each fixture's files are scanned through the real queue,
 * reconciled into a registry, and every case row is judged against the learned conventions. `FIXTURE=law,programming` runs only those.
 * The judge is eval-only (M73 replaces it with the real grader): it sees one convention's rule and use case, never its conflicts,
 * so teacher superiority (`winner`) is checked on the registry instead: the losing convention must name the winner in `conflicts`.
 */
type Role = "exercises" | "teacher";
type Row = { question: string; answer: string; triggered: boolean; met: boolean | null; winner?: string; note?: string };
type Expect = { key: string; source?: "teacher" | "solutions"; run?: string; match: string; level?: string; rows: Row[]; alsoCheckRowsAt?: string[] };
type Cases = {
  lang: "he" | "en"; matchOn?: "rule"; plan: { course: string; stages: { title: string; concepts: string[] }[] };
  files: { path: string; role: Role }[]; runs?: { name: string; files: string[] }[];
  expect?: Expect[]; forbid?: { key: string; match: string; source?: "teacher" | "solutions" }[]; inconsistent?: { key: string; run: string; match: string }[];
  lifecycle?: { step: string; files?: { path: string; role: Role }[]; add?: { path: string; role: Role }[]; remove?: string[]; expect: Record<string, string> }[];
  lifecycleMatch?: Record<string, { match: string; source?: "teacher" | "solutions" }>;
};
const MAIN = "main";
const ALL = ["counting/absences", "counting/spread", "counting/random", "counting/split", "programming", "calculus", "law"];
const FIXTURES = ALL.filter((f) => !process.env.FIXTURE || process.env.FIXTURE.split(",").includes(f));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

const judgeTool = defineTool(
  "submit_judgement",
  "Submit, for every numbered case, whether the convention applies and whether the answer meets it.",
  z.object({ rows: z.array(z.object({ n: z.number(), triggered: z.boolean(), met: z.boolean().nullable(), why: z.string() })) }),
);
const judgeSystem = `You grade answers against ONE course convention. Judge every numbered case on its own.
triggered: the convention's situation holds for this case (check the trigger against what it names: the question, the answer, or either; a case matching a "not when" line is not triggered; a "level: whole" convention applies only to a whole multi-part answer, "part" to each part).
met: null when not triggered; otherwise whether the answer does what the rule says (use the "verify" line).
The course may be set in a fictional or foreign jurisdiction or use its own notation: never check names, section numbers or facts against your own outside knowledge; take them as correct unless the case itself shows them wrong. Call the tool once with every case.`;
const judgeMessage = (c: Convention, rows: Row[]) =>
  [`Rule: ${c.rule}`, `Trigger (checked on ${c.useCase.on}): ${c.useCase.trigger}`, `Not when: ${c.useCase.notWhen.join(" | ") || "-"}`, `Verify: ${c.useCase.verify}`, `Level: ${c.useCase.level}`, "",
    ...rows.map((r, i) => `Case ${i + 1}\nQuestion: ${r.question}\nAnswer: ${r.answer}`)].join("\n");

const gw = new CliGateway();
setFs(memFs());
setDeviceId("eval");
useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });

for (const name of FIXTURES) {
  describe(name, () => {
    const dir = join(__dirname, "fixtures/conventions", name);
    const cases = JSON.parse(readFileSync(join(dir, "cases.json"), "utf8")) as Cases;
    const failures: string[] = [];
    const fail = (s: string) => failures.push(s);

    beforeAll(async () => {
      // fixture sanity before any model call
      const all = [...cases.files, ...(cases.lifecycle ?? []).flatMap((s) => [...(s.files ?? []), ...(s.add ?? [])])];
      for (const f of all) if (!existsSync(join(dir, f.path))) throw new Error(`missing fixture file ${f.path}`);
      const regs = new Set([...(cases.runs?.map((r) => r.name) ?? [MAIN]), ...(cases.lifecycle?.map((s) => s.step) ?? [])]);
      for (const e of cases.expect ?? []) for (const r of [e.run ?? MAIN, ...(e.alsoCheckRowsAt ?? [])]) if (!regs.has(r)) throw new Error(`${e.key}: unknown run ${r}`);
      for (const x of [...(cases.expect ?? []), ...(cases.forbid ?? []), ...(cases.inconsistent ?? []), ...Object.values(cases.lifecycleMatch ?? {})]) new RegExp(x.match, "i");

      const roleOf = new Map(all.map((f) => [f.path, f.role]));
      const text = (path: string) => readFileSync(join(dir, path), "utf8");
      const stages = cases.plan.stages.map((s, i) => ({
        id: `S${String(i + 1).padStart(3, "0")}`, unitId: "U01", order: i + 1, title: s.title, summary: s.title, kind: "concept" as const, objectives: ["a", "b"], newConcepts: s.concepts,
        theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
      }));
      const plan = (n: string): PlanJson => ({ schema: 1, courseNumber: n, version: 1, generatedAt: "t", model: "m", courseKind: "mixed", units: [{ id: "U01", title: cases.plan.course, summary: "s", stageIds: stages.map((s) => s.id) }], stages });
      const source = (pages: string[]): PageSource => ({
        pageCount: pages.length, text: async (p) => pages[p - 1] ?? "", imageNeeded: async () => false,
        image: async () => { throw new Error("text fixture"); }, crop: async () => { throw new Error("text fixture"); }, close() {},
      });
      const bySha = new Map<string, string>();
      const q = createIndexQueue({
        gw: () => gw, open: async (x) => source(text(bySha.get(x.sha256) as string).split("---page---")), getPlan: async (n) => plan(n),
        course: async (n) => ({ courseNumber: n, nameHe: cases.plan.course }), lang: () => cases.lang, resolve: () => "/x",
      });
      // a file is scanned once per fixture; a later run gets a copy of its record, so runs differ only by reconcile
      const indexed = new Map<string, FileIndex>();
      const addFiles = async (n: string, paths: string[]) => {
        const todo: string[] = [];
        for (const path of paths) {
          const s = sha(text(path));
          bySha.set(s, path);
          const done = indexed.get(path);
          const role = roleOf.get(path) as Role;
          const fileName = path.split("/").pop() as string;
          await writeFileIndex(n, done ?? {
            schema: 1, sha256: s, fileName, relPath: `${role === "teacher" ? TEACHER_DIR : EXERCISES_DIR}/${fileName}`, role, mediaType: "text/markdown",
            pageCount: text(path).split("---page---").length, addedAt: new Date().toISOString(), status: "pending", error: null, indexedAt: null, indexModel: null, planVersion: null, materialPages: [], exercises: [],
          });
          if (!done) {
            todo.push(path);
            q.enqueue(n, s);
          }
        }
        await q.idle();
        for (const path of todo) {
          const r = await readFileIndex(n, sha(text(path)));
          if (r?.status !== "indexed") throw new Error(`${path}: ${r?.status} ${r?.error}`);
          indexed.set(path, r);
        }
      };
      const reconcile = async (n: string) => {
        await reconcileConventions({ gw, n, plan: plan(n), lang: cases.lang });
        return structuredClone((await readJsonFile(coursePaths("/r", n).conventions, ConventionsFileSchema)) ?? { schema: 1, conventions: [], hashes: {}, inconsistent: [], updatedAt: "" }) as ConventionsFile;
      };
      // fixed per fixture and run, so EVAL_CACHE replays hit (the course number is part of the requests)
      let seq = 0;
      const newCourse = () => `09${String(ALL.indexOf(name)).padStart(2, "0")}00${String(++seq).padStart(2, "0")}`;

      const registries = new Map<string, ConventionsFile>();
      for (const run of cases.runs ?? [{ name: MAIN, files: cases.files.map((f) => f.path) }]) {
        const n = newCourse();
        await addFiles(n, run.files);
        registries.set(run.name, await reconcile(n));
      }
      if (cases.lifecycle) {
        const n = newCourse();
        for (const s of cases.lifecycle) {
          for (const path of s.remove ?? []) await fs().remove(coursePaths("/r", n).indexFile(sha(text(path))));
          await addFiles(n, [...(s.files ?? []), ...(s.add ?? [])].map((f) => f.path));
          registries.set(s.step, await reconcile(n));
        }
      }

      // MATCHING: a case-insensitive regex over the rule (matchOn "rule") or the rule + trigger
      const subject = (c: Convention) => (cases.matchOn === "rule" ? c.rule : `${c.rule}\n${c.useCase.trigger}`);
      const matches = (reg: ConventionsFile, re: string, source?: string, status: Convention["status"] | null = "active") =>
        reg.conventions.filter((c) => (!status || c.status === status) && (!source || c.source === source) && new RegExp(re, "i").test(subject(c)));

      const verdicts: unknown[] = [];
      const judge = async (where: string, e: Expect, convs: Convention[]) => {
        const got = await Promise.all(convs.map(async (c) => {
          const v = await callStructured(gw, judgeTool, { task: "index", system: judgeSystem, messages: [{ role: "user", content: judgeMessage(c, e.rows) }] });
          return new Map(v.value.rows.map((r) => [r.n, r]));
        }));
        e.rows.forEach((row, i) => {
          const per = got.map((m) => m.get(i + 1));
          const on = per.filter((r) => r?.triggered);
          const triggered = on.length > 0;
          const met = triggered ? on.every((r) => r?.met === true) : null;
          const ok = triggered === row.triggered && (!row.triggered || met === row.met);
          verdicts.push({ where, key: e.key, row: i + 1, ok, expected: { triggered: row.triggered, met: row.met }, got: { triggered, met }, why: per.map((r) => r?.why), note: row.note });
          if (!ok) fail(`${where} ${e.key} row ${i + 1}: expected ${row.triggered}/${row.met}, got ${triggered}/${met} (${row.note ?? ""})`);
        });
      };

      const jobs: Promise<void>[] = [];
      for (const e of cases.expect ?? []) {
        for (const where of [e.run ?? MAIN, ...(e.alsoCheckRowsAt ?? [])]) {
          const reg = registries.get(where) as ConventionsFile;
          const convs = matches(reg, e.match, where === (e.run ?? MAIN) ? e.source : undefined);
          if (!convs.length) { fail(`${where}: no active convention for ${e.key}`); continue; }
          if (e.level && !convs.some((c) => c.useCase.level === e.level)) fail(`${where} ${e.key}: level ${convs.map((c) => c.useCase.level)} instead of ${e.level}`);
          jobs.push(judge(where, e, convs));
          // teacher superiority: on a row the winner owns, every matched convention of another key must name a winner convention in its conflicts
          for (const [i, row] of e.rows.entries()) {
            if (!row.winner || row.winner === e.key) continue;
            const w = cases.expect?.find((x) => x.key === row.winner && (x.run ?? MAIN) === where);
            const wIds = new Set(w ? matches(reg, w.match, w.source).map((c) => c.id) : []);
            for (const c of convs) if (!c.conflicts.some((x) => wIds.has(x.with))) fail(`${where} ${e.key} row ${i + 1}: ${c.id} has no conflict giving ${row.winner} precedence`);
          }
        }
      }
      await Promise.all(jobs);

      for (const [where, reg] of registries) {
        for (const f of cases.forbid ?? []) for (const c of matches(reg, f.match, f.source)) fail(`${where}: forbidden ${f.key} learned: ${c.rule}`);
        if (name === "counting/spread" && reg.conventions.some((c) => c.status === "active")) fail(`${where}: expected no convention, got ${reg.conventions.map((c) => c.rule).join(" | ")}`);
      }
      for (const x of cases.inconsistent ?? []) {
        const reg = registries.get(x.run) as ConventionsFile;
        if (!reg.inconsistent.some((i) => new RegExp(x.match, "i").test([i.useCase, ...i.practices].join("\n")))) fail(`${x.run}: ${x.key} not logged inconsistent`);
      }
      for (const s of cases.lifecycle ?? []) {
        const reg = registries.get(s.step) as ConventionsFile;
        for (const [key, want] of Object.entries(s.expect)) {
          const m = cases.lifecycleMatch?.[key] as { match: string; source?: string };
          const any = matches(reg, m.match, m.source, null);
          const active = any.filter((c) => c.status === "active");
          const teacherIds = new Set(reg.conventions.filter((c) => c.status === "active" && c.source === "teacher").map((c) => c.id));
          const ok = {
            active: active.length > 0,
            "active-teacher": active.some((c) => c.source === "teacher"),
            retired: !active.length && any.some((c) => c.status === "retired"),
            absent: !any.length,
            // relaxed (Progress M72): an active solutions practice is fine only when it yields to an active teacher convention
            "not-active": active.every((c) => c.source === "solutions" && c.conflicts.some((x) => teacherIds.has(x.with))),
          }[want];
          if (!ok) fail(`lifecycle "${s.step}": ${key} expected ${want}, got ${any.map((c) => `${c.status}/${c.source}: ${c.rule}`).join(" | ") || "none"}`);
        }
      }

      const report = join(process.env.EVAL_DIR ?? tmpdir(), `eval-conventions-${name.replace("/", "-")}.json`);
      writeFileSync(report, JSON.stringify({ calls: gw.calls, costUsd: gw.costUsd, failures, verdicts, registries: Object.fromEntries(registries), indexes: [...indexed.values()].map((r) => ({ file: r.fileName, patterns: r.patterns, teacherItems: r.teacherItems })) }, null, 1));
      console.log(`eval report: ${report} (${gw.calls} calls so far, $${gw.costUsd.toFixed(2)}, ${failures.length} failures)`);
    }, 3_600_000);

    it("every expected row, forbid, inconsistent and lifecycle check holds", () => expect(failures).toEqual([]));
  });
}
