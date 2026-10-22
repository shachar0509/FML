import { beforeEach, expect, it, vi } from "vitest";
import { memFs } from "@/test/memfs";
import { setFs, fs } from "@/core/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { type Conversation, addEntry, checkpoint, createConv, deleteConvs, listConvs, loadConv, saveState, transcript } from "./history";

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
