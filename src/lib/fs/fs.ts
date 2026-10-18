// Minimal filesystem port. Tauri plugin-fs in the app; swap with setFs() in tests.
export type DirEntry = { name: string; isDirectory: boolean; isFile: boolean };

export interface Fs {
  readText(path: string): Promise<string>;
  writeText(path: string, data: string, opts?: { append?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>; // recursive
  readDir(path: string): Promise<DirEntry[]>;
  remove(path: string): Promise<void>;
}

const tauriFs: Fs = {
  async readText(p) {
    return (await import("@tauri-apps/plugin-fs")).readTextFile(p);
  },
  async writeText(p, data, opts) {
    await (await import("@tauri-apps/plugin-fs")).writeTextFile(p, data, { append: opts?.append });
  },
  async rename(a, b) {
    await (await import("@tauri-apps/plugin-fs")).rename(a, b);
  },
  async exists(p) {
    return (await import("@tauri-apps/plugin-fs")).exists(p);
  },
  async mkdir(p) {
    await (await import("@tauri-apps/plugin-fs")).mkdir(p, { recursive: true });
  },
  async readDir(p) {
    return (await import("@tauri-apps/plugin-fs")).readDir(p);
  },
  async remove(p) {
    await (await import("@tauri-apps/plugin-fs")).remove(p, { recursive: true });
  },
};

let current: Fs = tauriFs;
export const fs = (): Fs => current;
export const setFs = (f: Fs): void => {
  current = f;
};
