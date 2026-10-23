import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { memFs } from "@/test/memfs";
import { setFs } from "./fs";
import { readJsonFile, writeJsonAtomic } from "./atomicWrite";
import { isConflictCopy } from "./conflicts";
import { appendJsonl, mergeById, readJsonl, readJsonlDir } from "./jsonl";
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

describe("jsonl parse cache (R4)", () => {
  type Row = { id: string; ts: string };
  /** Reference reader that bypasses the cache: today's readJsonlDir, file by file. */
  const fresh = async (dir: string) =>
    mergeById(
      (
        await Promise.all(
          (await m.readDir(dir)).filter((e) => e.isFile && e.name.endsWith(".jsonl") && !isConflictCopy(e.name)).map((e) => readJsonl<Row>(`${dir}/${e.name}`)),
        )
      ).flat(),
    );
  const line = (o: object) => JSON.stringify(o) + "\n";

  it("a hit returns equal data, the same objects, a fresh array", async () => {
    for (const r of [{ id: "a", ts: "1" }, { id: "b", ts: "2" }, { id: "c", ts: "3" }]) await appendJsonl("/c1/D1.jsonl", r);
    const r1 = await readJsonlDir<Row>("/c1");
    const r2 = await readJsonlDir<Row>("/c1");
    expect(r2).toEqual(r1);
    expect(r2[0]).toBe(r1[0]);
    expect(r2).not.toBe(r1);
    expect(r1).toEqual(await fresh("/c1"));
    expect(Object.isFrozen(r1[0])).toBe(true); // vitest only: a caller that mutates a cached event throws
  });

  it("another device's append is seen", async () => {
    await appendJsonl("/c2/D1.jsonl", { id: "a", ts: "1" });
    await readJsonlDir<Row>("/c2");
    m.files.set("/c2/D1.jsonl", (m.files.get("/c2/D1.jsonl") ?? "") + line({ id: "z", ts: "9" }));
    const r = await readJsonlDir<Row>("/c2");
    expect(r).toEqual(await fresh("/c2"));
    expect(r.map((x) => x.id)).toEqual(["a", "z"]);
  });

  it("a same-length rewrite is seen (no mtime involved)", async () => {
    m.files.set("/c3/D1.jsonl", line({ id: "a", ts: "1" }) + line({ id: "b", ts: "2" }));
    expect((await readJsonlDir<Row>("/c3")).map((x) => x.id)).toEqual(["a", "b"]);
    m.files.set("/c3/D1.jsonl", line({ id: "a", ts: "3" }) + line({ id: "b", ts: "2" }));
    const r = await readJsonlDir<Row>("/c3");
    expect(r).toEqual(await fresh("/c3"));
    expect(r.map((x) => x.id)).toEqual(["b", "a"]);
  });

  it("a partial last line is skipped, then read once completed", async () => {
    await appendJsonl("/c4/D1.jsonl", { id: "a", ts: "1" });
    await readJsonlDir<Row>("/c4");
    m.files.set("/c4/D1.jsonl", (m.files.get("/c4/D1.jsonl") ?? "") + '{"id":"p","ts');
    const half = await readJsonlDir<Row>("/c4");
    expect(half).toEqual(await fresh("/c4"));
    expect(half.map((x) => x.id)).toEqual(["a"]);
    m.files.set("/c4/D1.jsonl", (m.files.get("/c4/D1.jsonl") ?? "") + '":"5"}\n');
    const full = await readJsonlDir<Row>("/c4");
    expect(full).toEqual(await fresh("/c4"));
    expect(full.map((x) => x.id)).toEqual(["a", "p"]);
  });

  it("a truncated file is parsed again in full", async () => {
    m.files.set("/c5/D1.jsonl", line({ id: "a", ts: "1" }) + line({ id: "b", ts: "2" }));
    await readJsonlDir<Row>("/c5");
    m.files.set("/c5/D1.jsonl", line({ id: "a", ts: "1" }));
    const r = await readJsonlDir<Row>("/c5");
    expect(r).toEqual(await fresh("/c5"));
    expect(r.map((x) => x.id)).toEqual(["a"]);
  });

  it("two courses never share entries", async () => {
    m.files.set("/c6a/e/D1.jsonl", line({ id: "a1", ts: "1" }));
    m.files.set("/c6b/e/D1.jsonl", line({ id: "b1", ts: "1" }));
    expect(await readJsonlDir<Row>("/c6a/e")).toEqual(await fresh("/c6a/e"));
    expect(await readJsonlDir<Row>("/c6b/e")).toEqual(await fresh("/c6b/e"));
    expect((await readJsonlDir<Row>("/c6a/e")).map((x) => x.id)).toEqual(["a1"]);
  });

  it("a schema read and a plain read of one file are kept apart", async () => {
    const S = z.object({ id: z.string(), ts: z.string(), n: z.number() });
    m.files.set("/c7/D1.jsonl", line({ id: "v", ts: "1", n: 1 }) + line({ id: "w", ts: "2", n: "x" }));
    const typed = await readJsonlDir("/c7", S);
    const plain = await readJsonlDir<Row>("/c7");
    expect(typed.map((x) => x.id)).toEqual(["v"]);
    expect(plain.map((x) => x.id)).toEqual(["v", "w"]);
    expect(typed).toEqual(await readJsonl("/c7/D1.jsonl", S));
    expect(plain).toEqual(await readJsonl("/c7/D1.jsonl"));
    expect(await readJsonlDir("/c7", S)).toEqual(typed); // the plain read replaced the entry; a typed read after it is still right
  });

  it("a conflict copy is still skipped", async () => {
    m.files.set("/c8/D1.jsonl", line({ id: "a", ts: "1" }));
    m.files.set("/c8/D1 (conflicted copy).jsonl", line({ id: "x", ts: "0" }));
    const r = await readJsonlDir<Row>("/c8");
    expect(r.map((x) => x.id)).toEqual(["a"]);
    expect(r).toEqual(await fresh("/c8"));
  });
});
