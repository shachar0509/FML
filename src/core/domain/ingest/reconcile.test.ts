import { beforeEach, describe, expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import type { ClaudeRequest } from "@/core/claude/types";
import { type Convention, type ConventionsFile, ConventionsFileSchema, EventSchema, type FileIndex, type PlanJson, type TeacherItem } from "@/core/domain/dataSchemas";
import { useCasePrompt } from "@/core/claude/prompts/conventions";
import { nodeId } from "@/core/domain/knowledge/graph";
import { appendEvent } from "@/core/domain/progress/store";
import { setDeviceId } from "@/core/lib/device";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs, setFs } from "@/core/lib/fs/fs";
import { readJsonlDir } from "@/core/lib/fs/jsonl";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { writeFileIndex } from "./indexStore";
import { reconcileConventions } from "./reconcile";

const N = "01040195";
const stage = (i: number) => ({
  id: `S00${i}`, unitId: "U01", order: i, title: `t${i}`, summary: "s", kind: "concept" as const, objectives: ["a", "b"], newConcepts: [`c${i}`],
  theorems: [], techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core" as const, estimatedMinutes: 30,
});
const plan: PlanJson = { schema: 1, courseNumber: N, version: 1, generatedAt: "t", model: "m", courseKind: "mixed", units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001"] }], stages: [stage(1)] };
const A = "aaaaaaaa1111", B = "bbbbbbbb2222", C = "cccccccc3333", T = "tttttttt4444";
const P = coursePaths("/r", N);
const events = () => readJsonlDir(P.events, EventSchema).then((e) => e.slice(seeded));
const registry = async () => (await readJsonFile(P.conventions, ConventionsFileSchema)) as ConventionsFile;
const run = (gw: FakeClaudeGateway) => reconcileConventions({ gw, n: N, plan, lang: "en" });

const file = (sha: string, o: Partial<FileIndex> = {}): FileIndex => ({
  schema: 1, sha256: sha, fileName: `${sha.slice(0, 4)}.pdf`, relPath: `${sha}.pdf`, role: "exercises", mediaType: "application/pdf", pageCount: 1, addedAt: "t", status: "indexed",
  error: null, indexedAt: "t", indexModel: "m", planVersion: 1, materialPages: [], exercises: [], ...o,
});
/** `per` occurrences of each situation in the file (ids `<sha8>-o<n>`) */
const sol = (sha: string, situations: string[], per = 2) =>
  file(sha, { patterns: { absences: [], occurrences: situations.flatMap((s, i) => Array.from({ length: per }, (_, k) => ({ id: `${sha.slice(0, 8)}-o${i * per + k + 1}`, label: "1", useCase: s, practice: `cites ${s}` }))) } });
const item = (o: Partial<TeacherItem> = {}): TeacherItem => ({
  id: "tttttttt-t1", page: 1, type: "deduction", rule: "cite the section", quote: "missing section (-5)", points: -5, exercise: "2b", when: "S1", level: "any", answerForms: [], questionTypes: [],
  stageIds: ["S001"], nodes: [], concerns: null, mistake: null, ...o,
});
const teacherFile = (kind: "graded_work" | "rubric", items: TeacherItem[], sha = T) =>
  file(sha, { role: "teacher", materialPages: [{ page: 1, kind, stageIds: [], summary: "", hasFigure: false, text: "" }], teacherItems: items });
const conv = (o: Partial<Convention> = {}): Convention => ({
  id: "X", rule: "old rule", source: "solutions", useCase: { trigger: "t", on: "answer", notWhen: [], examples: [], verify: "v", distinguishes: [], level: "any", stageIds: [], hints: { answerForms: [], questionTypes: [] } },
  sources: [{ sha: "gone", fileName: "g", kind: "solution", refs: ["gone-o1"], quote: "q" }], status: "active", conflicts: [], addedAt: "2020-01-01T00:00:00.000Z", updatedAt: "2020-01-01T00:00:00.000Z", ...o,
});
const nodeOf = (x: Convention) => appendEvent(N, { type: "node_added", nodeId: x.id, kind: "convention", label: x.rule, why: "w", stageIds: [], requires: [], origin: "index", refId: "" });
/** a seeded registry as a real one: each active convention already has its node; events written here are cleared from `events()` */
const seed = async (cs: Convention[]) => {
  for (const x of cs) if (x.status === "active") await nodeOf(x);
  seeded = (await readJsonlDir(P.events, EventSchema)).length;
  await writeJsonAtomic(P.conventions, { schema: 1, conventions: cs, hashes: {}, inconsistent: [], updatedAt: "t" });
};
let seeded = 0;

// A scripted "model": by default one cluster per situation, one use case per cluster, one convention per use case citing every id; tests override single tools.
type Fn = (t: string, r: ClaudeRequest) => unknown;
const idsIn = (t: string) => [...t.matchAll(/^([0-9a-z]{8}-[oat]\d+) \|/gm)].map((m) => m[1] as string);
const defaults: Record<string, Fn> = {
  submit_use_case_clusters: (t) => {
    const g = new Map<string, string[]>();
    for (const line of t.split("\n")) {
      const id = /^([0-9a-z]{8}-[oat]\d+) \|/.exec(line)?.[1], s = /situation: (.+?) \|/.exec(line)?.[1];
      if (id && s) g.set(s, [...(g.get(s) ?? []), id]);
    }
    return { clusters: [...g].map(([useCase, ids]) => ({ useCase, ids, practices: ["p"] })) };
  },
  submit_use_case_merge: (t) => ({ useCases: [...t.matchAll(/^(\d+\.\S+) \| (.+?) \| practices/gm)].map((m) => ({ useCase: m[2], clusters: [m[1]] })) }),
  submit_use_case_conventions: (t) => {
    const uc = /^Use case: (.+)$/m.exec(t)?.[1] as string;
    const rule = `rule for ${uc}`;
    const ids = idsIn(t.split("Existing conventions")[0] as string);
    const same = new RegExp(`^(\\d+)\\. \\[\\w+\\] ${rule} —`, "m").exec(t)?.[1];
    return {
      conventions: [{ sameAs: same ? Number(same) : null, rule, trigger: `trigger ${uc}`, on: "answer", notWhen: [], examples: [], verify: "v", level: "any", stageIds: ["S001", "S999"], followed: ids.filter((i) => i.includes("-o")), teacher: ids.filter((i) => i.includes("-t")) }],
    };
  },
  // each item satisfies only the trigger of its own convention (by its situation)
  submit_use_case_separation: (t) => {
    const ucA = /^rule: rule for (\S+)$/m.exec(t)?.[1];
    const own = (id: string) => new RegExp(`^${id} \\|.*situation: ${ucA} \\|`, "m").test(t);
    return { a: { trigger: "Ta", on: "answer", notWhen: [] }, b: { trigger: "Tb", on: "answer", notWhen: [] }, difference: "the data is symbolic", labels: idsIn(t).map((id) => ({ id, a: own(id), b: !own(id) })) };
  },
};
const model = (o: Record<string, Fn> = {}) =>
  new FakeClaudeGateway(Array.from({ length: 30 }, () => (r: ClaudeRequest) => {
    const name = r.tools?.[0]?.name as string;
    return toolCall(name, ({ ...defaults, ...o }[name] as Fn)(r.messages[0]?.content as string, r));
  }));
const names = (gw: FakeClaudeGateway) => gw.calls.map((c) => c.tools?.[0]?.name);
const never = () => new FakeClaudeGateway([]); // any AI call throws

beforeEach(() => {
  setFs(memFs());
  seeded = 0;
  setDeviceId("dev1");
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
});

describe("reconcileConventions", () => {
  it("no candidates: no AI call; a convention whose files were deleted stays active with 0 sources", async () => {
    await seed([conv()]);
    const gw = never();
    expect(await run(gw)).toMatchObject({ skipped: true, added: 0, retired: 0 });
    expect(gw.calls).toHaveLength(0);
    expect((await registry()).conventions).toMatchObject([{ id: "X", status: "active", sources: [] }]);
  });

  it("learns a convention from two files (map → merge → use case), writes its node, and a rerun with the same inputs makes no AI call", async () => {
    await writeFileIndex(N, sol(A, ["S1"]));
    await writeFileIndex(N, sol(B, ["S1"]));
    const gw = model();
    expect(await run(gw)).toEqual({ added: 1, refined: 0, retired: 0, conflicts: 0, skipped: false });
    expect(names(gw)).toEqual(["submit_use_case_clusters", "submit_use_case_merge", "submit_use_case_conventions"]);
    const id = nodeId("S001", "convention", "rule for S1");
    const reg = await registry();
    expect(reg.conventions).toMatchObject([{ id, source: "solutions", status: "active", useCase: { trigger: "trigger S1", stageIds: ["S001"] }, sources: [{ sha: A, refs: ["aaaaaaaa-o1", "aaaaaaaa-o2"] }, { sha: B }] }]);
    expect(Object.keys(reg.hashes)).toHaveLength(2); // "*" and the one use case
    expect((await events()).filter((e) => e.type === "node_added")).toMatchObject([{ nodeId: id, kind: "convention", origin: "index", label: "rule for S1", why: "trigger S1", refId: A }]);

    const again = never();
    expect(await run(again)).toMatchObject({ skipped: true });
    expect(again.calls).toHaveLength(0);
  });

  it("rejects a draft followed 3 times in ONE file, whatever the model says", async () => {
    await writeFileIndex(N, sol(A, ["S1"], 3));
    expect(await run(model())).toMatchObject({ added: 0, skipped: false });
    expect((await registry()).conventions).toEqual([]);
    expect((await events()).filter((e) => e.type === "node_added")).toEqual([]);
  });

  it("incremental: a use case untouched by a new file is not sent again (only its own job runs, plus map and merge)", async () => {
    await writeFileIndex(N, sol(A, ["S1", "S2"]));
    await writeFileIndex(N, sol(B, ["S1", "S2"]));
    const first = model();
    expect(await run(first)).toMatchObject({ added: 2 });
    expect(names(first).filter((x) => x === "submit_use_case_conventions")).toHaveLength(2);

    await writeFileIndex(N, file(C, { patterns: { absences: [], occurrences: [{ id: "cccccccc-o1", label: "1", useCase: "S2", practice: "cites S2" }] } }));
    const second = model();
    expect(await run(second)).toMatchObject({ added: 0, refined: 1 });
    expect(names(second)).toEqual(["submit_use_case_clusters", "submit_use_case_merge", "submit_use_case_conventions"]);
    expect(second.calls[2]?.messages[0]?.content).toContain("Use case: S2");
    const reg = await registry();
    expect(reg.conventions).toHaveLength(2);
    expect(reg.conventions.find((x) => x.rule === "rule for S2")?.sources.map((s) => s.sha).sort()).toEqual([A, B, C]);
  });

  it("map repair: an id listed twice keeps its first cluster, an unknown id is dropped, a missing id becomes a singleton", async () => {
    await writeFileIndex(N, sol(A, ["S1"]));
    await writeFileIndex(N, sol(B, ["S1"]));
    const gw = model({ submit_use_case_clusters: () => ({ clusters: [{ useCase: "S1", ids: ["aaaaaaaa-o1", "aaaaaaaa-o2", "aaaaaaaa-o1", "zzzzzzzz-o9"], practices: ["p"] }] }) });
    await run(gw);
    const merge = gw.calls[1]?.messages[0]?.content as string;
    expect(merge).toContain("Local clusters (3)"); // the S1 cluster and two singletons for bbbbbbbb-o1/o2
    expect(merge).toContain("2 items in 1 files");
    expect(merge).not.toContain("zzzzzzzz");
    expect(merge.match(/1 items in 1 files/g)).toHaveLength(2);
  });

  describe("teacher", () => {
    it("a graded deduction becomes a teacher convention with node_observed 0 once per (sha, node), even after teacherEvidence wrote other events with that refId", async () => {
      await appendEvent(N, { type: "node_observed", nodeId: "other-node", score: 0.4, why: "graded by the teacher", context: "teacher", refId: T });
      await writeFileIndex(N, teacherFile("graded_work", [item()]));
      const gw = model();
      expect(await run(gw)).toMatchObject({ added: 1 });
      const id = nodeId("S001", "convention", "rule for S1");
      const reg = await registry();
      expect(reg.conventions).toMatchObject([{ id, source: "teacher", sources: [{ sha: T, kind: "graded", refs: ["tttttttt-t1"] }] }]);
      const mine = () => events().then((ev) => ev.filter((e) => e.type === "node_observed" && e.nodeId === id));
      expect(await mine()).toMatchObject([{ score: 0, context: "teacher", refId: T, why: "missing section (-5)" }]);
      expect((await events()).filter((e) => e.type === "node_added")).toMatchObject([{ origin: "teacher", refId: T }]);

      expect(await run(never())).toMatchObject({ skipped: true }); // unchanged: no AI, no second event
      await writeFileIndex(N, sol(A, ["S2"])); // changed inputs: reconcile runs again
      await writeFileIndex(N, sol(B, ["S2"]));
      await run(model());
      expect(await mine()).toHaveLength(1);
    });

    it("praise scores 1; a requirement gives no evidence", async () => {
      await writeFileIndex(N, teacherFile("graded_work", [item({ type: "praise" })]));
      await writeFileIndex(N, teacherFile("rubric", [item({ id: "rrrrrrrr-t1", when: "S2", type: "requirement" })], "rrrrrrrr5555"));
      await run(model());
      expect((await events()).filter((e) => e.type === "node_observed")).toMatchObject([{ score: 1, refId: T }]);
    });
  });

  describe("retire", () => {
    const contradicting: Fn = (t, r) => {
      const d = (defaults.submit_use_case_conventions as Fn)(t, r) as { conventions: object[] };
      return { ...d, contradicts: [{ convention: 1, existing: 1, resolution: "exact value → exact form; estimate → 2 decimals" }] };
    };
    beforeEach(async () => {
      await writeFileIndex(N, sol(A, ["S1"]));
      await writeFileIndex(N, sol(B, ["S1"]));
    });

    it("a solutions convention whose files are gone is retired by a new repeating contradictor", async () => {
      await seed([conv()]);
      const out = await run(model({ submit_use_case_conventions: contradicting }));
      expect(out).toMatchObject({ added: 1, retired: 1, conflicts: 0 });
      const y = nodeId("S001", "convention", "rule for S1");
      expect((await registry()).conventions).toMatchObject([{ id: "X", status: "retired", retiredBy: y, sources: [] }, { id: y, status: "active" }]);
      expect((await events()).filter((e) => e.type === "node_retired")).toMatchObject([{ nodeId: "X" }]);
    });

    it("a teacher convention with only a solutions contradictor stays; both get the conflict", async () => {
      await seed([conv({ source: "teacher" })]);
      const out = await run(model({ submit_use_case_conventions: contradicting }));
      expect(out).toMatchObject({ added: 1, retired: 0, conflicts: 1 });
      const y = nodeId("S001", "convention", "rule for S1");
      const cs = (await registry()).conventions;
      expect(cs.find((x) => x.id === "X")).toMatchObject({ status: "active", conflicts: [{ with: y, resolution: expect.stringContaining("exact form") }] });
      expect(cs.find((x) => x.id === y)).toMatchObject({ conflicts: [{ with: "X" }] });
      expect((await events()).some((e) => e.type === "node_retired")).toBe(false);
    });

    it("deletion only: X's last file goes while Y's use case is unchanged (skipped); the stored conflict retires X", async () => {
      await writeFileIndex(N, sol(C, ["S9"], 1));
      await run(model()); // S9 (one file) never qualifies alone: X is seeded on it below
      const y = nodeId("S001", "convention", "rule for S1");
      const reg = await registry();
      const x = conv({ id: "X", conflicts: [{ with: y, resolution: "r" }], sources: [{ sha: C, fileName: "c", kind: "solution", refs: ["cccccccc-o1"], quote: "q" }] });
      await nodeOf(x);
      await writeJsonAtomic(P.conventions, { ...reg, conventions: [x, ...reg.conventions.map((v) => ({ ...v, conflicts: [{ with: "X", resolution: "r" }] }))] });
      await fs().remove(P.indexFile(C));
      const gw = model();
      expect(await run(gw)).toMatchObject({ retired: 1 });
      expect(names(gw)).not.toContain("submit_use_case_conventions"); // Y's use case was skipped
      expect((await registry()).conventions.find((v) => v.id === "X")).toMatchObject({ status: "retired", retiredBy: y });
      expect((await events()).filter((e) => e.type === "node_retired")).toMatchObject([{ nodeId: "X" }]);
    });

    it("the graph heals from the registry: an active convention without its node gets node_added, a retired one still in it node_retired (also on the hash-skip path)", async () => {
      await run(model());
      const y = nodeId("S001", "convention", "rule for S1");
      const reg = await registry();
      await nodeOf(conv()); // X is retired in the registry but its node is still in the graph
      await writeJsonAtomic(P.conventions, { ...reg, conventions: [...reg.conventions, conv({ status: "retired", retiredBy: y, sources: [] })] });
      for (const f of await fs().readDir(P.events)) await fs().writeText(`${P.events}/${f.name}`, (await fs().readText(`${P.events}/${f.name}`)).split("\n").filter((l) => !l.includes(`"nodeId":"${y}"`) || !l.includes("node_added")).join("\n"));
      expect(await run(never())).toMatchObject({ skipped: true });
      const ev = await events();
      expect(ev.filter((e) => e.type === "node_added" && e.nodeId === y)).toHaveLength(1);
      expect(ev.filter((e) => e.type === "node_retired")).toMatchObject([{ nodeId: "X", why: expect.stringContaining("rule for S1") }]);
      await run(never()); // idempotent
      expect((await events()).length).toBe(ev.length);
    });

    it("a solutions draft sameAs a teacher convention keeps the teacher's rule and trigger, only adds its sources", async () => {
      await seed([conv({ rule: "rule for S1", source: "teacher", sources: [] })]);
      expect(await run(model())).toMatchObject({ added: 0, refined: 1 });
      expect((await registry()).conventions).toMatchObject([{ id: "X", source: "teacher", rule: "rule for S1", useCase: { trigger: "t" }, sources: [{ sha: A }, { sha: B }] }]);
    });

    it("an id taken twice (rule and rule|trigger) is never overwritten: the draft only adds its sources", async () => {
      const id1 = nodeId("S001", "convention", "rule for S1"), id2 = nodeId("S001", "convention", "rule for S1 | trigger S1");
      await seed([conv({ id: id1, rule: "a" }), conv({ id: id2, rule: "b", source: "teacher" })]);
      expect(await run(model())).toMatchObject({ added: 0 });
      const cs = (await registry()).conventions;
      expect(cs).toHaveLength(2);
      expect(cs.find((v) => v.id === id2)).toMatchObject({ rule: "b", source: "teacher", sources: [{ sha: A }, { sha: B }] });
      expect((await events()).filter((e) => e.type === "node_added")).toEqual([]);
    });

    it("a retired convention that is accepted again comes back with a new node_added", async () => {
      await seed([conv({ id: nodeId("S001", "convention", "rule for S1"), status: "retired", retiredBy: "Z", sources: [] })]);
      expect(await run(model())).toMatchObject({ added: 1 });
      expect((await registry()).conventions).toMatchObject([{ status: "active" }]);
      expect((await registry()).conventions[0]?.retiredBy).toBeUndefined();
      expect((await events()).filter((e) => e.type === "node_added")).toHaveLength(1);
    });
  });

  describe("separation of similar use cases", () => {
    const similar = { submit_use_case_merge: (t: string) => ({ useCases: [...t.matchAll(/^(\d+\.\S+) \| (.+?) \| practices/gm)].map((m) => ({ useCase: m[2], clusters: [m[1]] })), similar: [{ a: 1, b: 2 }] }) };
    const both: Fn = (t) => ({ ...(defaults.submit_use_case_separation as Fn)(t, null as never) as object, labels: idsIn(t).map((id) => ({ id, a: true, b: true })) });
    beforeEach(async () => {
      await writeFileIndex(N, sol(A, ["S1", "S2"]));
      await writeFileIndex(N, sol(B, ["S1", "S2"]));
    });

    it("ok: both triggers are sharpened and each names the other in distinguishes", async () => {
      const gw = model(similar);
      await run(gw);
      expect(names(gw).filter((x) => x === "submit_use_case_separation")).toHaveLength(1);
      const cs = (await registry()).conventions;
      expect(cs.map((x) => x.useCase.trigger).sort()).toEqual(["Ta", "Tb"]);
      expect(cs[0]?.useCase.distinguishes).toMatchObject([{ from: cs[1]?.id, difference: "the data is symbolic" }]);
      expect(cs[1]?.useCase.distinguishes).toMatchObject([{ from: cs[0]?.id }]);
    });

    it("overlap: retried once with the overlapping ids, then the solutions-only sides are dropped into inconsistent", async () => {
      const gw = model({ ...similar, submit_use_case_separation: both });
      expect(await run(gw)).toMatchObject({ added: 0 });
      const seps = gw.calls.filter((c) => c.tools?.[0]?.name === "submit_use_case_separation");
      expect(seps).toHaveLength(2);
      expect(seps[0]?.messages[0]?.content).not.toContain("BOTH triggers");
      expect(seps[1]?.messages[0]?.content).toContain("BOTH triggers");
      const reg = await registry();
      expect(reg.conventions).toEqual([]);
      expect(reg.inconsistent.map((x) => x.practices[0]).sort()).toEqual(["rule for S1", "rule for S2"]);
    });

    it("an unchanged use case runs again when its similar pair has a fresh side, so the pair is still separated", async () => {
      await run(model(similar));
      await writeFileIndex(N, file(C, { patterns: { absences: [], occurrences: [{ id: "cccccccc-o1", label: "1", useCase: "S2", practice: "cites S2" }] } }));
      const gw = model(similar);
      await run(gw);
      expect(names(gw).filter((x) => x === "submit_use_case_conventions")).toHaveLength(2);
      expect(names(gw).filter((x) => x === "submit_use_case_separation")).toHaveLength(1);
    });

    it("unlabeled items count as an overlap (no labels is not 'ok')", async () => {
      const gw = model({ ...similar, submit_use_case_separation: (t) => ({ ...(defaults.submit_use_case_separation as Fn)(t, null as never) as object, labels: [] }) });
      expect(await run(gw)).toMatchObject({ added: 0 });
      expect(names(gw).filter((x) => x === "submit_use_case_separation")).toHaveLength(2);
    });

    it("a sharpened trigger is counted again: a side left with one file's items is dropped", async () => {
      const gw = model({ ...similar, submit_use_case_separation: (t) => {
        const v = (defaults.submit_use_case_separation as Fn)(t, null as never) as { labels: { id: string; a: boolean; b: boolean }[] };
        return { ...v, labels: v.labels.map((l) => (l.id.startsWith("bbbbbbbb") && l.b ? { ...l, b: false } : l)) };
      } });
      expect(await run(gw)).toMatchObject({ added: 1 });
      const reg = await registry();
      expect(reg.conventions).toMatchObject([{ rule: "rule for S1", useCase: { distinguishes: [] } }]);
      expect(reg.inconsistent.map((x) => x.practices[0])).toEqual(["rule for S2"]);
    });

    it("teacher-wins: the overlap is stored as a conflict resolution 'both trigger → the teacher's'", async () => {
      await writeFileIndex(N, teacherFile("rubric", [item({ type: "requirement", when: "S1" })]));
      // S1 is now the teacher's (rule for S1, with the teacher item); S2 stays solutions-only
      const gw = model({
        ...similar,
        submit_use_case_separation: both,
        submit_use_case_merge: (t) => ({ useCases: [...t.matchAll(/^(\d+\.\S+) \| (.+?) \| practices/gm)].map((m) => ({ useCase: m[2], clusters: [m[1]] })).sort((a, b) => String(a.useCase).localeCompare(String(b.useCase))), similar: [{ a: 1, b: 2 }] }),
      });
      expect(await run(gw)).toMatchObject({ added: 2, conflicts: 1 });
      expect(names(gw).filter((x) => x === "submit_use_case_separation")).toHaveLength(1); // teacher-wins needs no retry
      const cs = (await registry()).conventions;
      expect(cs.map((x) => x.source).sort()).toEqual(["solutions", "teacher"]);
      for (const x of cs) expect(x.conflicts).toMatchObject([{ resolution: expect.stringContaining("both trigger → the teacher's") }]);
    });
  });

  it("an AI job error throws and writes nothing (empty replies are repaired to singletons; the use case job then finds the script exhausted)", async () => {
    await writeFileIndex(N, sol(A, ["S1"]));
    await writeFileIndex(N, sol(B, ["S1"]));
    await expect(run(new FakeClaudeGateway([toolCall("submit_use_case_clusters", { clusters: [] }), toolCall("submit_use_case_merge", { useCases: [] })]))).rejects.toThrow("script exhausted");
    expect(await readJsonFile(P.conventions, ConventionsFileSchema)).toBeNull();
  });
});

describe("use-case prompt (eval fixes)", () => {
  it("only rival practices are inconsistent; companions are separate conventions; triggers are actions, not topics", () => {
    const p = useCasePrompt("English");
    expect(p).toContain("One practice per rule"); // law cite + explain-the-test, programming trace + final result
    expect(p).toContain("Only rivals vary"); // split: units and rounding were logged inconsistent
    expect(p).toContain("2.70 is both"); // one practice described two ways is not a variation
    expect(p).toContain("never a topic");
  });
});
