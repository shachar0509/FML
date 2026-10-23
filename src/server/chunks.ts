import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/** Largest base64 chunk a card may send: the cards send 2 MB raw (~2.7 MB base64), and tool arguments must stay under 4 MB. */
export const CHUNK_B64_MAX = 4 * 1024 * 1024;
const IDLE_MS = 10 * 60_000;

type Up = { dir: string; path: string; next: number; total: number; at: number };
export type Chunk = { index: number; total: number; data: string };
export type Put = <T>(key: string, name: string, c: Chunk, finish: (path: string) => Promise<T>) => Promise<{ done: false } | { done: true; value: T }>;

/**
 * Card uploads in base64 chunks sent in order (index 0..total-1), reassembled in a fresh temp dir under the file's own name.
 * The last chunk runs `finish` on the whole file. The temp dir is removed on every exit: finish (ok or throw), a failed write,
 * a chunk out of order, a restart at index 0, or 10 idle minutes (a card closed mid-upload).
 * ponytail: no sweep of tmpdir at server start; a crash mid-upload leaves one temp dir for the OS to clean. Add a startup sweep if that shows up.
 */
export function chunkedUploads(prefix: string): Put {
  const ups = new Map<string, Up>();
  const drop = async (key: string) => {
    const u = ups.get(key);
    ups.delete(key);
    if (u) await rm(u.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  };
  return async (key, name, { index, total, data }, finish) => {
    const now = Date.now();
    for (const [k, u] of ups) if (now - u.at > IDLE_MS) await drop(k);
    if (index === 0) {
      await drop(key); // the card started this file again
      const base = basename(name);
      if (!base || base === "." || base === "..") throw new Error("Bad file name.");
      const dir = await mkdtemp(join(tmpdir(), prefix));
      ups.set(key, { dir, path: join(dir, base), next: 0, total, at: now });
    }
    const u = ups.get(key);
    if (!u || u.next !== index || u.total !== total || index >= total) {
      await drop(key);
      throw new Error("Upload chunk out of order; send the file again.");
    }
    try {
      await appendFile(u.path, Buffer.from(data, "base64")); // no mkdir: a temp dir the OS removed must fail, not reassemble a partial file
    } catch (e) {
      await drop(key);
      throw e;
    }
    u.next++;
    u.at = now;
    if (u.next < total) return { done: false };
    ups.delete(key);
    try {
      return { done: true, value: await finish(u.path) };
    } finally {
      await rm(u.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    }
  };
}
