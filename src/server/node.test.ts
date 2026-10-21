// @vitest-environment node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openSource } from "@/domain/ingest/pageSource";
import { setFs } from "@/lib/fs/fs";
import { nodeDirs } from "@/lib/platform";
import { readJson, writeJson } from "@/lib/storage";
import { enableNodeCanvas } from "./canvas";
import { nodeFs } from "./nodeFs";
import { importCopy, numberedName, sha256 } from "./native";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "shalav-m1-"));
  setFs(nodeFs());
  enableNodeCanvas();
  nodeDirs.config = join(dir, "cfg");
  nodeDirs.cache = join(dir, "cache");
});
afterAll(async () => {
  delete nodeDirs.config;
  delete nodeDirs.cache;
  await rm(dir, { recursive: true, force: true });
});

const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 20 40 Td (Hello Shalav) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`;

describe("nodeFs", () => {
  it("round-trips text, append, bytes, dirs, rename, remove", async () => {
    const f = nodeFs();
    const d = join(dir, "a", "b");
    await f.mkdir(d);
    await f.writeText(join(d, "x.txt"), "one\n");
    await f.writeText(join(d, "x.txt"), "two\n", { append: true });
    expect(await f.readText(join(d, "x.txt"))).toBe("one\ntwo\n");
    await f.writeBytes(join(d, "y.bin"), new Uint8Array([1, 2, 3]));
    expect([...(await f.readBytes(join(d, "y.bin")))]).toEqual([1, 2, 3]);
    await f.rename(join(d, "y.bin"), join(d, "z.bin"));
    expect((await f.readDir(d)).map((e) => e.name).sort()).toEqual(["x.txt", "z.bin"]);
    expect(await f.exists(join(d, "y.bin"))).toBe(false);
    await f.remove(join(dir, "a"));
    expect(await f.exists(d)).toBe(false);
  });
});

describe("native", () => {
  it("sha256 matches the known vector", async () => {
    const p = join(dir, "abc.txt");
    await writeFile(p, "abc");
    expect(await sha256(p)).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("numbered names and importCopy collisions (two spaces, like the Rust version)", async () => {
    expect(numberedName("a.pdf", 1)).toBe("a.pdf");
    expect(numberedName("a.pdf", 2)).toBe("a  (2).pdf");
    expect(numberedName("a.b.pdf", 3)).toBe("a.b  (3).pdf");
    expect(numberedName("noext", 2)).toBe("noext  (2)");
    expect(numberedName(".hidden", 2)).toBe(".hidden  (2)");
    const src = join(dir, "f.txt");
    await writeFile(src, "abc");
    const out = join(dir, "out");
    const names = [await importCopy(src, out), await importCopy(src, out), await importCopy(src, out)];
    expect(names.map((n) => n.slice(out.length + 1))).toEqual(["f.txt", "f  (2).txt", "f  (3).txt"]);
    expect(await readFile(names[2] as string, "utf8")).toBe("abc");
  });
});

describe("settings storage", () => {
  it("persists JSON under the config dir; missing file reads undefined", async () => {
    expect(await readJson("settings.json")).toBeUndefined();
    await writeJson("settings.json", { language: "en" });
    expect(await readJson("settings.json")).toEqual({ language: "en" });
  });
});

describe("pdf in Node", () => {
  it("reads text and renders a page to JPEG (and caches it)", async () => {
    const p = join(dir, "t.pdf");
    await writeFile(p, PDF);
    const src = await openSource({ path: p, mediaType: "application/pdf", sha256: "deadbeef" });
    expect(src.pageCount).toBe(1);
    expect(await src.text(1)).toContain("Hello Shalav");
    const img = await src.image(1);
    expect(img.mediaType).toBe("image/jpeg");
    const bytes = Buffer.from(img.base64, "base64");
    expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
    expect(await nodeFs().exists(join(dir, "cache", "pages", "deadbeef", "p1.jpg"))).toBe(true);
    src.close();
  });
});

describe("initNode", () => {
  it("creates device.json, data root and shalav.json under env-provided dirs", async () => {
    const { initNode } = await import("./platform");
    Object.assign(process.env, { SHALAV_CONFIG_DIR: join(dir, "c2"), SHALAV_CACHE_DIR: join(dir, "k2"), SHALAV_DOCUMENTS_DIR: join(dir, "docs") });
    const r = await initNode();
    expect(r.dataRoot).toBe(join(dir, "docs", "Shalav"));
    expect(await nodeFs().exists(join(r.dataRoot, "shalav.json"))).toBe(true);
    expect(await nodeFs().exists(join(dir, "c2", "device.json"))).toBe(true);
    expect((await initNode()).deviceId).toBe(r.deviceId);
  });
});

describe("MCPB user_config env", () => {
  it("data folder overrides, language seeds only the first run, unresolved ${...} is ignored", async () => {
    const { initNode } = await import("./platform");
    const { useSettings } = await import("@/stores/settings");
    Object.assign(process.env, { SHALAV_CONFIG_DIR: join(dir, "c3"), SHALAV_DATA_FOLDER: join(dir, "mine"), SHALAV_LANGUAGE: "en" });
    expect((await initNode()).dataRoot).toBe(join(dir, "mine"));
    expect(useSettings.getState().settings.language).toBe("en");
    useSettings.getState().update({ language: "he" });
    await new Promise((r) => setTimeout(r, 100)); // update() persists without awaiting
    Object.assign(process.env, { SHALAV_DATA_FOLDER: "${user_config.data_folder}", SHALAV_LANGUAGE: "en" });
    expect((await initNode()).dataRoot).toBe(join(dir, "mine")); // saved value kept
    expect(useSettings.getState().settings.language).toBe("he");
    delete process.env.SHALAV_DATA_FOLDER;
    delete process.env.SHALAV_LANGUAGE;
  });
});
