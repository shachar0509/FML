import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memFs } from "@/test/memfs";
import { setFs, fs } from "@/core/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { type Conversation, type Entry, addEntry, checkpoint, createConv, deleteConvs, listConvs, loadConv, saveState, transcript, updateConv } from "./history";
import { writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { isConflictCopy } from "@/core/lib/fs/conflicts";
import { appendJsonl, readJsonl } from "@/core/lib/fs/jsonl";

beforeEach(() => {
  setFs(memFs());
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r" } }));
});

it("saves conversations under the data root, newest first; a deleted one stays deleted", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
  const a = await createConv("01", { kind: "lesson", type: "lesson", title: "S001 · Limits", stageId: "S001" });
  vi.setSystemTime(new Date("2026-10-01T11:00:00Z"));
  const b = await createConv("01", { kind: "lesson", type: "lesson", title: "S002" });
  await createConv("01", { kind: "practice", type: "test", title: "t" });
  expect(await fs().exists(`/r/.chat_history/01/${a.id}.json`)).toBe(true);
  expect((await listConvs("01", "lesson")).map((c) => c.id)).toEqual([b.id, a.id]);
  // an action moves it to the top; slides and button presses arriving together both land
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  await Promise.all([
    addEntry("01", a.id, { who: "tutor", kind: "step", text: "Limits", card: { view: "step", titleMd: "Limits" } }),
    addEntry("01", a.id, { who: "student", kind: "request", text: "Continue" }),
  ]);
  expect((await listConvs("01", "lesson"))[0]).toMatchObject({ id: a.id, updatedAt: "2026-10-01T12:00:00.000Z", stageId: "S001" });
  const c = (await loadConv("01", a.id)) as Conversation;
  expect(c.entries).toHaveLength(2);
  expect(checkpoint(c)?.card).toMatchObject({ titleMd: "Limits" });
  expect(transcript(c)).toBe("[Tutor · step] Limits\n[Student · request] Continue");
  await deleteConvs("01", [a.id]);
  expect(await addEntry("01", a.id, { who: "student", kind: "request", text: "late" })).toBeNull();
  expect(await loadConv("01", a.id)).toBeNull();
  // practice state: created on first save, replaced after
  await saveState("01", "p1", { type: "normal", title: "all" }, { n: 1 });
  await saveState("01", "p1", { type: "normal", title: "all" }, { n: 2 });
  expect((await loadConv("01", "p1"))?.state).toEqual({ n: 2 });
  vi.useRealTimers();
});

it("keeps the newest part of a long transcript", async () => {
  const c = await createConv("01", { kind: "lesson", type: "lesson", title: "x" });
  for (let i = 0; i < 50; i++) await addEntry("01", c.id, { who: "tutor", kind: "step", text: `step ${i} ${"x".repeat(50)}` });
  const t = transcript((await loadConv("01", c.id)) as Conversation, 1000);
  expect(t.startsWith("(earlier part left out)")).toBe(true);
  expect(t).toContain("step 49");
  expect(t).not.toContain("step 0 ");
});

describe("R7: header + append-only jsonl", () => {
  const H = "/r/.chat_history/01";
  const T = "2026-10-01T09:00:00.000Z";
  const at = (h: number, m = 0) => vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, h, m)));
  const e1: Entry = { at: T, who: "tutor", kind: "step", text: "Limits", card: { view: "step", titleMd: "Limits" } };
  const e2: Entry = { at: T, who: "student", kind: "request", text: "Continue" };
  const oldHeader = (id: string, entries: Entry[]) => ({ schema: 1, id, kind: "lesson", type: "lesson", courseNumber: "01", title: "t", createdAt: T, updatedAt: T, entries });
  const texts = async (id: string) => ((await loadConv("01", id)) as Conversation).entries.map((e) => e.text);
  afterEach(() => vi.useRealTimers());

  it("1. an old-format file loads and gets appended without moving its entries", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
    await writeJsonAtomic(`${H}/old.json`, oldHeader("old", [e1, e2]));
    expect(((await loadConv("01", "old")) as Conversation).entries).toEqual([e1, e2]);
    await addEntry("01", "old", { who: "tutor", kind: "step", text: "Epsilon" });
    expect(((await loadConv("01", "old")) as Conversation).entries).toEqual([e1, e2, { at: "2026-10-01T10:00:00.000Z", who: "tutor", kind: "step", text: "Epsilon" }]);
    const head = JSON.parse(await fs().readText(`${H}/old.json`)) as Conversation;
    expect(head.entries).toEqual([e1, e2]);
    expect(head.updatedAt).toBe("2026-10-01T10:00:00.000Z");
    expect(await readJsonl(`${H}/old.jsonl`)).toHaveLength(1);
  });

  it("2. both layouts give the same conversation: transcript, checkpoint, MCQ key, graded exercise", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
    const a = await createConv("01", { kind: "lesson", type: "lesson", title: "S001", stageId: "S001" });
    const seq: Omit<Entry, "at">[] = [
      { who: "tutor", kind: "step", text: "Limits", card: { view: "step", titleMd: "Limits" } },
      { who: "tutor", kind: "mcq", text: "Which?\nOptions: (1) x (2) y", card: { view: "mcq", questionMd: "Which?" }, extra: { checkId: "c1", correctIndex: 1, explanationMd: "since y" } },
      { who: "student", kind: "check", text: "Chose option 2 (correct).", extra: { checkId: "c1", selectedIndex: 1 } },
      // a graded lesson exercise, as exercises.onGraded → learnTools log writes it (exerciseTools.ts:97, learnTools.ts:552): no card, no extra
      { who: "tutor", kind: "grade", text: "Graded 85 (partially_correct). Missed the boundary case." },
      { who: "student", kind: "request", text: "Continue" },
    ];
    for (const [i, e] of seq.entries()) {
      at(10, i + 1);
      await addEntry("01", a.id, e);
    }
    const A = (await loadConv("01", a.id)) as Conversation;
    expect(A.entries.map((e) => e.kind)).toEqual(["step", "mcq", "check", "grade", "request"]);
    await writeJsonAtomic(`${H}/B.json`, { ...A, id: "B" }); // the pre-R7 layout: every entry inside the header, no B.jsonl
    expect(await fs().exists(`${H}/B.jsonl`)).toBe(false);
    const B = (await loadConv("01", "B")) as Conversation;
    expect(B.entries).toEqual(A.entries);
    expect(transcript(B)).toBe(transcript(A));
    expect(transcript(B, 60)).toBe(transcript(A, 60));
    expect(transcript(A)).toContain("[Tutor · grade] Graded 85 (partially_correct). Missed the boundary case.");
    expect(checkpoint(B)).toEqual(checkpoint(A));
    expect(checkpoint(A)?.kind).toBe("mcq"); // the grade entry has no card, so the resume point stays the MCQ
    const chose = (c: Conversation) => c.entries.findLast((y) => y.kind === "check" && (y.extra as { checkId?: string } | undefined)?.checkId === "c1");
    expect(chose(B)).toEqual(chose(A));
    expect(chose(A)?.extra).toEqual({ checkId: "c1", selectedIndex: 1 });
  });

  it("3. concurrent addEntry calls all land, in call order", async () => {
    const c = await createConv("01", { kind: "lesson", type: "lesson", title: "x" });
    await Promise.all([1, 2, 3, 4, 5].map((i) => addEntry("01", c.id, { who: "student", kind: "request", text: `m${i}` })));
    expect(await texts(c.id)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("4. addEntry after delete writes nothing, also when racing the delete", async () => {
    const c = await createConv("01", { kind: "lesson", type: "lesson", title: "x" });
    await addEntry("01", c.id, { who: "student", kind: "request", text: "one" });
    await deleteConvs("01", [c.id]);
    expect(await addEntry("01", c.id, { who: "student", kind: "request", text: "late" })).toBeNull();
    expect(await fs().exists(`${H}/${c.id}.json`)).toBe(false);
    expect(await fs().exists(`${H}/${c.id}.jsonl`)).toBe(false);
    expect((await listConvs("01", "lesson")).map((x) => x.id)).not.toContain(c.id);
    const d = await createConv("01", { kind: "lesson", type: "lesson", title: "y" });
    await Promise.all([deleteConvs("01", [d.id]), addEntry("01", d.id, { who: "student", kind: "request", text: "race" })]);
    expect(await fs().exists(`${H}/${d.id}.json`)).toBe(false);
  });

  it("5. listConvs orders by updatedAt and returns only the meta keys", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-01T10:00:00Z") });
    const a = await createConv("01", { kind: "lesson", type: "lesson", title: "a", stageId: "S001" });
    at(11);
    const b = await createConv("01", { kind: "lesson", type: "lesson", title: "b" });
    at(12);
    await addEntry("01", a.id, { who: "student", kind: "request", text: "x" });
    const l1 = await listConvs("01", "lesson");
    expect(l1.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(l1[0]).toEqual({ id: a.id, type: "lesson", title: "a", updatedAt: "2026-10-01T12:00:00.000Z", stageId: "S001" });
    expect(Object.keys(l1[1] as object).sort()).toEqual(["id", "title", "type", "updatedAt"]);
    at(13);
    await updateConv("01", b.id, (c) => c);
    expect((await listConvs("01", "lesson")).map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it("6. deleteConvs removes both files", async () => {
    const c = await createConv("01", { kind: "lesson", type: "lesson", title: "x" });
    await addEntry("01", c.id, { who: "student", kind: "request", text: "one" });
    expect(await fs().exists(`${H}/${c.id}.json`)).toBe(true);
    expect(await fs().exists(`${H}/${c.id}.jsonl`)).toBe(true);
    await deleteConvs("01", [c.id]);
    expect(await fs().exists(`${H}/${c.id}.json`)).toBe(false);
    expect(await fs().exists(`${H}/${c.id}.jsonl`)).toBe(false);
  });

  it("7. a conflict copy of the jsonl is ignored (and still reported as a copy)", async () => {
    const c = await createConv("01", { kind: "lesson", type: "lesson", title: "x" });
    await addEntry("01", c.id, { who: "student", kind: "request", text: "real" });
    await appendJsonl(`${H}/${c.id} (1).jsonl`, { at: T, who: "student", kind: "request", text: "ghost" });
    expect(await texts(c.id)).toEqual(["real"]);
    expect(await listConvs("01", "lesson")).toHaveLength(1);
    expect(isConflictCopy(`${c.id} (1).jsonl`)).toBe(true);
  });

  it("8. createConv with a given id drops a stale log", async () => {
    await appendJsonl(`${H}/p9.jsonl`, { at: T, who: "student", kind: "request", text: "orphan" }); // left by a pre-R7 delete
    await createConv("01", { id: "p9", kind: "practice", type: "normal", title: "x" });
    expect(((await loadConv("01", "p9")) as Conversation).entries).toEqual([]);
    expect(await fs().exists(`${H}/p9.jsonl`)).toBe(false);
  });

  it("9. a partial last line is skipped", async () => {
    const c = await createConv("01", { kind: "lesson", type: "lesson", title: "x" });
    await addEntry("01", c.id, { who: "student", kind: "request", text: "one" });
    await addEntry("01", c.id, { who: "student", kind: "request", text: "two" });
    await fs().writeText(`${H}/${c.id}.jsonl`, '{"at":"x","who":"tu', { append: true });
    expect(await texts(c.id)).toEqual(["one", "two"]);
  });

  it("10. CRLF line ends are tolerated", async () => {
    await writeJsonAtomic(`${H}/crlf.json`, oldHeader("crlf", []));
    await fs().writeText(`${H}/crlf.jsonl`, `${JSON.stringify(e2)}\r\n`);
    expect(((await loadConv("01", "crlf")) as Conversation).entries).toEqual([e2]);
  });
});
