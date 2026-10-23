import { beforeEach, expect, it } from "vitest";
import type { FileIndex } from "@/core/domain/dataSchemas";
import { setFs, type Fs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { removeFile } from "./import";
import { listFileIndexes, readFileIndex, writeFileIndex } from "./indexStore";

const N = "01040195";
const rec = (sha: string, o: Partial<FileIndex> = {}): FileIndex => ({
  schema: 1, sha256: sha, fileName: `${sha}.md`, relPath: `m/${sha}.md`, role: "material", mediaType: "text/markdown", pageCount: 1, addedAt: `t-${sha}`,
  status: "indexed", error: null, indexedAt: "t", indexModel: "m", planVersion: 1,
  materialPages: [{ page: 1, stageIds: ["S001"], summary: "s", hasFigure: false, text: "page text" }],
  exercises: [], ...o,
});
let mem: ReturnType<typeof memFs>;
let reads: string[];
beforeEach(() => {
  mem = memFs();
  reads = [];
  const counted: Fs = { ...mem, readText: (p) => (reads.push(p), mem.readText(p)) };
  setFs(counted);
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
});
const dir = () => coursePaths("/r", N).indexFiles;
const indexReads = () => reads.filter((p) => p.startsWith(dir()) && p.endsWith(".json")).length;
/** What today's code returns: every .json parsed again, uncached. */
const fresh = async (n = N) => {
  const d = coursePaths("/r", n).indexFiles;
  const all = await Promise.all((await mem.readDir(d)).filter((e) => e.isFile && e.name.endsWith(".json")).map((e) => readFileIndex(n, e.name.slice(0, -5))));
  return all.filter((r): r is FileIndex => !!r).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
};

it("lists what a fresh parse gives after writeFileIndex", async () => {
  await writeFileIndex(N, rec("a"));
  await writeFileIndex(N, rec("b"));
  expect(await listFileIndexes(N)).toEqual(await fresh());
  await writeFileIndex(N, rec("a", { status: "failed", error: "x" }));
  const l = await listFileIndexes(N);
  expect(l).toEqual(await fresh());
  expect(l.find((r) => r.sha256 === "a")?.status).toBe("failed");
});

it("unchanged files are not read again", async () => {
  await writeFileIndex(N, rec("a"));
  await writeFileIndex(N, rec("b"));
  await listFileIndexes(N);
  reads = [];
  const l = await listFileIndexes(N);
  expect(indexReads()).toBe(0);
  expect(l).toEqual(await fresh());
});

it("a removal through dropIndex is gone and pruned", async () => {
  await writeFileIndex(N, rec("a"));
  await writeFileIndex(N, rec("b"));
  await listFileIndexes(N);
  await removeFile(N, (await listFileIndexes(N))[0] as FileIndex, { native: { trash: async () => {} } as never });
  const l = await listFileIndexes(N);
  expect(l).toEqual(await fresh());
  expect(l).toHaveLength(1);
  reads = [];
  await writeFileIndex(N, rec("a"));
  await listFileIndexes(N);
  expect(indexReads()).toBeGreaterThanOrEqual(1);
});

it("an external overwrite of the same length is seen", async () => {
  await writeFileIndex(N, rec("a", { fileName: "x1.md" }));
  await listFileIndexes(N);
  const p = coursePaths("/r", N).indexFile("a");
  const old = mem.files.get(p) as string;
  const next = JSON.stringify(rec("a", { fileName: "x2.md" }), null, 2) + "\n";
  expect(next.length).toBe(old.length);
  mem.files.set(p, next);
  const l = await listFileIndexes(N);
  expect(l).toEqual(await fresh());
  expect(l[0]?.fileName).toBe("x2.md");
});

it("returned records are copies", async () => {
  await writeFileIndex(N, rec("a"));
  await listFileIndexes(N);
  await listFileIndexes(N);
  const r = (await listFileIndexes(N))[0] as FileIndex;
  r.fileName = "zz";
  (r.materialPages[0] as FileIndex["materialPages"][number]).text = "zz";
  r.materialPages[0]?.stageIds.push("S999");
  r.materialPages.push(r.materialPages[0] as never);
  const l = await listFileIndexes(N);
  expect(l).toEqual(await fresh());
  expect(l[0]?.fileName).toBe("a.md");
  expect(l[0]?.materialPages).toHaveLength(1);
  expect(l[0]?.materialPages[0]?.text).toBe("page text");
  expect(l[0]?.materialPages[0]?.stageIds).toEqual(["S001"]);
});

it("a stat failure falls back to today's read", async () => {
  await writeFileIndex(N, rec("a"));
  setFs({ ...mem, stat: async () => { throw new Error("EBUSY"); } });
  expect(await listFileIndexes(N)).toEqual(await fresh());
});

it("an invalid file is skipped and read again once fixed", async () => {
  const p = coursePaths("/r", N).indexFile("c");
  await writeFileIndex(N, rec("a"));
  mem.files.set(p, '{"bad":1}');
  expect((await listFileIndexes(N)).map((r) => r.sha256)).toEqual(["a"]);
  mem.files.set(p, JSON.stringify(rec("c")));
  expect((await listFileIndexes(N)).map((r) => r.sha256).sort()).toEqual(["a", "c"]);
});

it("two courses keep their own records", async () => {
  const M = "01040196";
  await writeFileIndex(N, rec("a", { fileName: "n.md" }));
  await writeFileIndex(M, rec("a", { fileName: "m.md" }));
  expect(await listFileIndexes(N)).toEqual(await fresh(N));
  expect(await listFileIndexes(M)).toEqual(await fresh(M));
  expect((await listFileIndexes(N))[0]?.fileName).toBe("n.md");
  expect((await listFileIndexes(M))[0]?.fileName).toBe("m.md");
});

it("a new fs starts with an empty cache", async () => {
  await writeFileIndex(N, rec("a", { fileName: "x1.md" }));
  await listFileIndexes(N);
  mem = memFs();
  setFs(mem);
  await writeFileIndex(N, rec("a", { fileName: "x2.md" }));
  expect((await listFileIndexes(N))[0]?.fileName).toBe("x2.md");
});
