import { beforeEach, expect, it } from "vitest";
import { memFs } from "@/test/memfs";
import { setFs } from "./fs/fs";
import { chooseUniversity, ensureDataRoot, ensureDevice, loadUniversity } from "./firstRun";
import { fs } from "./fs/fs";
import { university } from "@/core/universities";

let m: ReturnType<typeof memFs>;
beforeEach(() => setFs((m = memFs())));

it("device id is created once and reused", async () => {
  const a = await ensureDevice("/cfg");
  expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  expect(await ensureDevice("/cfg")).toBe(a);
});

it("data root creates shalav.json, keeps an existing one", async () => {
  await ensureDataRoot("/d");
  const first = m.files.get("/d/shalav.json") ?? "";
  expect(JSON.parse(first).formatVersion).toBe(1);
  await ensureDataRoot("/d");
  expect(m.files.get("/d/shalav.json")).toBe(first);
});

it("university: v1 data (courses, no choice) becomes technion; the choice is one-way", async () => {
  await ensureDataRoot("/d");
  expect(await loadUniversity("/d")).toBeNull();
  await fs().mkdir("/d/courses/01040195");
  expect(await loadUniversity("/d")).toBe("technion");
  expect(university()?.id).toBe("technion");
  await chooseUniversity("/d", "technion");
  await expect(chooseUniversity("/d", "huji")).rejects.toThrow(/locked/);
});
