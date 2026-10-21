import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { memFs } from "@/test/memfs";
import { setFs } from "./fs";
import { readJsonFile, writeJsonAtomic } from "./atomicWrite";
import { appendJsonl, readJsonl, readJsonlDir } from "./jsonl";
import { coursePaths, join, nfc } from "./paths";

let m: ReturnType<typeof memFs>;
beforeEach(() => setFs((m = memFs())));

describe("paths", () => {
  it("joins and builds course tree", () => {
    expect(join("/a/", "/b", "c/")).toBe("/a/b/c");
    const p = coursePaths("/r", "01040195");
    expect(p.eventsFile("D1")).toBe("/r/courses/01040195/.shalav/events/D1.jsonl");
    expect(p.materials).toBe("/r/courses/01040195/חומרי לימוד");
  });
  it("nfc normalizes", () => expect(nfc("é")).toBe("é"));
});

describe("atomic json", () => {
  it("writes pretty json, leaves no tmp, validates on read", async () => {
    await writeJsonAtomic("/x/a.json", { n: 1 });
    expect(m.files.get("/x/a.json")).toBe('{\n  "n": 1\n}\n');
    expect([...m.files.keys()].some((k) => k.endsWith(".tmp"))).toBe(false);
    expect(await readJsonFile("/x/a.json", z.object({ n: z.number() }))).toEqual({ n: 1 });
    expect(await readJsonFile("/x/a.json", z.object({ n: z.string() }))).toBeNull();
    expect(await readJsonFile("/x/missing.json", z.any())).toBeNull();
  });
});

describe("jsonl", () => {
  it("ignores a trailing partial line", async () => {
    await appendJsonl("/e/D1.jsonl", { id: "1", ts: "t1" });
    m.files.set("/e/D1.jsonl", (m.files.get("/e/D1.jsonl") ?? "") + '{"id":"2","ts');
    expect(await readJsonl("/e/D1.jsonl")).toEqual([{ id: "1", ts: "t1" }]);
  });
  it("merges dir by (ts,id) and de-dups", async () => {
    await appendJsonl("/e/D1.jsonl", { id: "b", ts: "2" });
    await appendJsonl("/e/D1.jsonl", { id: "a", ts: "2" });
    await appendJsonl("/e/D2.jsonl", { id: "c", ts: "1" });
    await appendJsonl("/e/D2.jsonl", { id: "a", ts: "2" });
    const r = await readJsonlDir<{ id: string; ts: string }>("/e");
    expect(r.map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});
