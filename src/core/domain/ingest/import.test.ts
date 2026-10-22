import { beforeEach, describe, expect, it } from "vitest";
import { setFs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { importFiles, reindex, removeFile, scanCourse, type Deps } from "./import";
import type { FileIndex } from "@/core/domain/dataSchemas";
import { listFileIndexes, writeFileIndex } from "./indexStore";
import { PasswordProtectedError, TooManyPagesError } from "./types";

const C = "01040195";
let mem: ReturnType<typeof memFs>;
let queued: string[];
let sizes: Record<string, number>;
let mtimes: Record<string, number>;
let hashes: Record<string, string>;
let hashCalls = 0;
let pages: Record<string, number | Error>;
const deps = (platform: "macos" | "windows" = "macos"): Deps => ({
  platform,
  enqueue: (_c, sha) => void queued.push(sha),
  native: {
    sha256: async (p) => (hashCalls++, hashes[p] ?? `h:${p.slice(p.lastIndexOf("/") + 1)}`),
    size: async (p) => sizes[p] ?? 10,
    modified: async (p) => mtimes[p] ?? 0,
    copy: async (src, dir) => {
      const dest = `${dir}/${src.slice(src.lastIndexOf("/") + 1)}`;
      mem.files.set(dest, "x");
      return dest;
    },
    heicToJpeg: async (s) => s.replace(/\.heic$/, ".jpg"),
    trash: async (p) => void mem.files.delete(p),
  },
  open: async ({ path }) => {
    const n = pages[`/in/${path.slice(path.lastIndexOf("/") + 1)}`] ?? 1;
    if (n instanceof Error) throw n;
    return { pageCount: n, close() {} } as never;
  },
});
const root = () => useSettings.getState().settings.dataRoot;

beforeEach(() => {
  mem = memFs();
  setFs(mem);
  queued = [];
  sizes = {};
  mtimes = {};
  hashes = {};
  hashCalls = 0;
  pages = {};
});

describe("importFiles", () => {
  it("applies the 5.2 rules", async () => {
    sizes["/in/big.pdf"] = 300 * 1024 * 1024;
    pages["/in/pw.pdf"] = new PasswordProtectedError();
    pages["/in/huge.pdf"] = new TooManyPagesError(600);
    pages["/in/ok.pdf"] = 12;
    const files = ["/in/a.docx", "/in/big.pdf", "/in/pw.pdf", "/in/huge.pdf", "/in/ok.pdf", "/in/ok.pdf", "/in/p.heic"];
    const r = await importFiles(C, "material", files, deps());
    expect(r.map((x) => x.status)).toEqual(["unsupported", "tooLarge", "added", "tooManyPages", "added", "duplicate", "added"]);
    const recs = await listFileIndexes(C);
    expect(recs.find((x) => x.fileName === "pw.pdf")).toMatchObject({ status: "failed", error: "Password-protected PDF" });
    expect(recs.find((x) => x.fileName === "ok.pdf")).toMatchObject({ status: "pending", pageCount: 12, mediaType: "application/pdf" });
    expect(queued).toHaveLength(2); // ok.pdf + p.jpg; the failed one is not queued
    expect(mem.files.has(`${coursePaths(root(), C).materials}/huge.pdf`)).toBe(false); // rejected copy removed
    expect((await importFiles(C, "material", ["/in/p.heic"], deps("windows")))[0]?.status).toBe("heicWindows");
    // the same file for the other folder is a duplicate too: records are per content, a second one would overwrite the first
    expect((await importFiles(C, "exercises", ["/in/ok.pdf"], deps()))[0]?.status).toBe("duplicate");
    expect((await listFileIndexes(C)).find((x) => x.fileName === "ok.pdf")?.role).toBe("material");
  });
});

describe("scanCourse / remove / reindex", () => {
  it("registers new files, follows renames, drops deleted ones", async () => {
    const p = coursePaths(root(), C);
    mem.files.set(`${p.materials}/new.pdf`, "x");
    mem.files.set(`${p.materials}/note.docx`, "x");
    expect(await scanCourse(C, deps())).toEqual({ added: 1, removed: [] });
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: [] });
    // rename: same hash, new name
    hashes[`${p.materials}/renamed.pdf`] = "h:new.pdf";
    mem.files.delete(`${p.materials}/new.pdf`);
    mem.files.set(`${p.materials}/renamed.pdf`, "x");
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: [] });
    const [rec] = await listFileIndexes(C);
    expect(rec?.fileName).toBe("renamed.pdf");
    mem.files.delete(`${p.materials}/renamed.pdf`);
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: ["h:new.pdf"] });
    expect(await listFileIndexes(C)).toEqual([]);
  });

  it("the same file in both folders: one record that stays put (no flipping each scan); the copy takes over when the first goes", async () => {
    const p = coursePaths(root(), C);
    mem.files.set(`${p.materials}/conv.pdf`, "x");
    mem.files.set(`${p.exercises}/conv.pdf`, "x"); // same content (same hash)
    mem.files.set(`${p.exercises}/conv copy.pdf`, "x");
    hashes[`${p.exercises}/conv copy.pdf`] = "h:conv.pdf";
    expect(await scanCourse(C, deps())).toEqual({ added: 1, removed: [] });
    const hashed = hashCalls;
    for (let k = 0; k < 3; k++) expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: [] });
    expect((await listFileIndexes(C)).map((r) => [r.role, r.relPath])).toEqual([["material", "חומרי לימוד/conv.pdf"]]);
    expect(hashCalls).toBe(hashed); // the copies are not hashed again on every poll
    mem.files.delete(`${p.materials}/conv.pdf`);
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: ["h:conv.pdf"] });
    expect(await scanCourse(C, deps())).toEqual({ added: 1, removed: [] });
    expect((await listFileIndexes(C)).map((r) => r.role)).toEqual(["exercises"]);
  });

  it("an edited file is the old version removed and a new one added; a touched or renamed one keeps its scan", async () => {
    const f = `${coursePaths(root(), C).materials}/a.pdf`;
    mem.files.set(f, "x");
    await scanCourse(C, deps());
    const [old] = await listFileIndexes(C);
    await writeFileIndex(C, { ...(old as FileIndex), status: "indexed" });
    mtimes[f] = 1; // saved again, same bytes
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: [] });
    expect(await listFileIndexes(C)).toMatchObject([{ sha256: "h:a.pdf", status: "indexed", stamp: "10:1" }]);
    mtimes[f] = 2; // edited
    hashes[f] = "h:a2";
    expect(await scanCourse(C, deps())).toEqual({ added: 1, removed: ["h:a.pdf"] });
    expect(await listFileIndexes(C)).toMatchObject([{ sha256: "h:a2", fileName: "a.pdf", status: "pending" }]);
  });

  it("does not open an unreadable folder file again until it changes", async () => {
    const f = `${coursePaths(root(), C).materials}/broken.pdf`;
    mem.files.set(f, "x");
    let opens = 0;
    const d = { ...deps(), open: async () => (opens++, Promise.reject(new Error("bad pdf"))) };
    await scanCourse(C, d);
    await scanCourse(C, d);
    expect(opens).toBe(1);
    sizes[f] = 11; // replaced with another file
    await scanCourse(C, d);
    expect(opens).toBe(2);
  });

  it("skips a file still being copied in (its size changes while it is hashed), then takes it whole", async () => {
    const f = `${coursePaths(root(), C).materials}/copying.pdf`;
    mem.files.set(f, "x");
    let n = 0;
    const d = deps();
    const native = { ...d.native, size: async () => (n++ ? 20 : 10) }; // grows between the two reads
    expect(await scanCourse(C, { ...d, native })).toEqual({ added: 0, removed: [] });
    expect(await scanCourse(C, deps())).toEqual({ added: 1, removed: [] }); // copy done: same size before and after
  });

  it("removeFile trashes + deletes record; reindex resets and enqueues", async () => {
    await importFiles(C, "material", ["/in/r.pdf"], deps());
    const [rec] = await listFileIndexes(C);
    if (!rec) throw new Error("no record");
    await reindex(C, { ...rec, status: "failed", error: "x" }, deps());
    expect((await listFileIndexes(C))[0]).toMatchObject({ status: "pending", error: null });
    expect(queued.at(-1)).toBe(rec.sha256);
    await removeFile(C, rec, deps());
    expect(await listFileIndexes(C)).toEqual([]);
    expect(mem.files.has(`${coursePaths(root(), C).materials}/r.pdf`)).toBe(false);
  });
});
