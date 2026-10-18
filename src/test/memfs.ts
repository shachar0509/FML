import type { Fs } from "@/lib/fs/fs";

/** In-memory Fs for tests. Directories are implicit from file paths + explicit mkdir. */
export function memFs(): Fs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const children = (p: string) => {
    const pre = p.replace(/\/$/, "") + "/";
    const out = new Map<string, boolean>();
    for (const k of [...files.keys(), ...dirs]) {
      if (!k.startsWith(pre)) continue;
      const rest = k.slice(pre.length);
      const i = rest.indexOf("/");
      out.set(i < 0 ? rest : rest.slice(0, i), i >= 0 || dirs.has(k));
    }
    return out;
  };
  return {
    files,
    async readText(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async writeText(p, d, o) {
      files.set(p, o?.append ? (files.get(p) ?? "") + d : d);
    },
    async rename(a, b) {
      files.set(b, await this.readText(a));
      files.delete(a);
    },
    async exists(p) {
      return files.has(p) || dirs.has(p) || children(p).size > 0;
    },
    async mkdir(p) {
      dirs.add(p);
    },
    async readDir(p) {
      return [...children(p)].map(([name, isDirectory]) => ({ name, isDirectory, isFile: !isDirectory }));
    },
    async remove(p) {
      for (const k of [...files.keys()]) if (k === p || k.startsWith(p + "/")) files.delete(k);
      dirs.delete(p);
    },
  };
}
