// @vitest-environment node
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { initNode } from "./platform";

// Claude Desktop's Electron utility process: pdf.js only runs as Node when process.type is unset (or "browser").
it("initNode makes an Electron utility process look like Node to pdf.js", async () => {
  const d = await mkdtemp(join(tmpdir(), "shalav-el-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DATA_FOLDER: join(d, "data") });
  Object.defineProperty(process.versions, "electron", { value: "38.2.0", configurable: true });
  Object.defineProperty(process, "type", { value: "utility", configurable: true, writable: true });
  try {
    await initNode();
    expect((process as { type?: string }).type).toBeUndefined();
  } finally {
    delete (process.versions as { electron?: string }).electron;
  }
});
