import { beforeEach, describe, expect, it, vi } from "vitest";
import { setFs } from "@/lib/fs/fs";
import { memFs } from "@/test/memfs";
import { cached, cachePath, openSource } from "./pageSource";

vi.mock("@tauri-apps/api/path", () => ({ appCacheDir: async () => "/cache" }));

let m: ReturnType<typeof memFs>;
beforeEach(() => {
  m = memFs();
  setFs(m);
});

describe("openSource", () => {
  it("txt is one never-image-needed page", async () => {
    m.bytes.set("/a.md", new TextEncoder().encode("# Hi\n\n  there "));
    const s = await openSource({ path: "/a.md", mediaType: "text/markdown", sha256: "h" });
    expect(s.pageCount).toBe(1);
    expect(await s.text(1)).toBe("# Hi there");
    expect(await s.imageNeeded(1, "exercises")).toBe(false);
  });
  it("page JPEG cache is written once then read", async () => {
    expect(await cachePath("abc", 3)).toBe("/cache/pages/abc/p3.jpg");
    const make = vi.fn(async () => Uint8Array.of(1, 2, 3));
    const a = await cached("abc", 3, make);
    const b = await cached("abc", 3, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(m.bytes.has("/cache/pages/abc/p3.jpg")).toBe(true);
  });
});
