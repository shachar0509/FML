import { beforeEach, describe, expect, it } from "vitest";
import { setFs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { importFiles, reindex, removeFile, scanCourse, type Deps } from "./import";
import { listFileIndexes } from "./indexStore";
import { PasswordProtectedError, TooManyPagesError } from "./types";

const C = "01040195";
let mem: ReturnType<typeof memFs>;
let queued: string[];
let sizes: Record<string, number>;
let hashes: Record<string, string>;
let pages: Record<string, number | Error>;
const deps = (platform: "macos" | "windows" = "macos"): Deps => ({
  platform,
  enqueue: (_c, sha) => void queued.push(sha),
  native: {
    sha256: async (p) => hashes[p] ?? `h:${p.slice(p.lastIndexOf("/") + 1)}`,
    size: async (p) => sizes[p] ?? 10,
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
  hashes = {};
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
    // same hash in the other role is not a duplicate
    expect((await importFiles(C, "exercises", ["/in/ok.pdf"], deps()))[0]?.status).toBe("added");
  });
});

describe("scanCourse / remove / reindex", () => {
  it("registers new files, follows renames, drops deleted ones", async () => {
    const p = coursePaths(root(), C);
    mem.files.set(`${p.materials}/new.pdf`, "x");
    mem.files.set(`${p.materials}/note.docx`, "x");
    expect(await scanCourse(C, deps())).toEqual({ added: 1, removed: 0 });
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: 0 });
    // rename: same hash, new name
    hashes[`${p.materials}/renamed.pdf`] = "h:new.pdf";
    mem.files.delete(`${p.materials}/new.pdf`);
    mem.files.set(`${p.materials}/renamed.pdf`, "x");
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: 0 });
    const [rec] = await listFileIndexes(C);
    expect(rec?.fileName).toBe("renamed.pdf");
    mem.files.delete(`${p.materials}/renamed.pdf`);
    expect(await scanCourse(C, deps())).toEqual({ added: 0, removed: 1 });
    expect(await listFileIndexes(C)).toEqual([]);
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
