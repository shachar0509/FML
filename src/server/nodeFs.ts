import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import type { Fs } from "@/lib/fs/fs";

export const nodeFs = (): Fs => ({
  readText: (p) => readFile(p, "utf8"),
  async writeText(p, data, opts) {
    await (opts?.append ? appendFile(p, data) : writeFile(p, data));
  },
  rename,
  exists: (p) => stat(p).then(() => true, () => false),
  async mkdir(p) {
    await mkdir(p, { recursive: true });
  },
  readBytes: async (p) => new Uint8Array(await readFile(p)),
  writeBytes: (p, data) => writeFile(p, data),
  async readDir(p) {
    return (await readdir(p, { withFileTypes: true })).map((e) => ({ name: e.name, isDirectory: e.isDirectory(), isFile: e.isFile() }));
  },
  remove: (p) => rm(p, { recursive: true }),
});
