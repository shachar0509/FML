// Minimal filesystem port. nodeFs() in the server; memfs in tests.
export type DirEntry = { name: string; isDirectory: boolean; isFile: boolean };

export interface Fs {
  readText(path: string): Promise<string>;
  writeText(path: string, data: string, opts?: { append?: boolean }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>; // recursive
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, data: Uint8Array): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  remove(path: string): Promise<void>;
  /** Throws if missing. R1: the index cache keys on these. */
  stat(path: string): Promise<{ size: number; mtimeMs: number; ctimeMs: number; ino: number }>;
}

let current: Fs | undefined; // set by initNode() (server) or setFs() (tests)
export const fs = (): Fs => {
  if (!current) throw new Error("Fs not initialised");
  return current;
};
export const setFs = (f: Fs): void => {
  current = f;
};
