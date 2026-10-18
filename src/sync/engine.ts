/* eslint-disable @typescript-eslint/no-dynamic-delete */
import type { Fs } from "@/lib/fs/fs";
import { sha256Hex } from "@/lib/hash";
import { dirname, join, nfc } from "@/lib/fs/paths";
import { courseOf, isIgnored, ownerDevice, syncClass } from "./classes";
import { OfflineError, ReconnectError, type DriveItem, type DrivePort, type SyncKind, type SyncState, type SyncStatus } from "./types";

export type EngineDeps = {
  drive: DrivePort;
  fs: Fs;
  root: () => string;
  deviceId: string;
  deviceName: () => string;
  saveState: (s: SyncState) => Promise<void>;
  trashLocal: (absPath: string) => Promise<void>;
  now: () => string;
  onStatus: (s: SyncStatus) => void;
  onDataChanged: (course: string) => void;
  onConflict?: (relPath: string) => void;
};

const MAX_PARALLEL = 3;
const base = (rel: string) => rel.slice(rel.lastIndexOf("/") + 1);
type Local = { kind: "file"; sha: string; bytes: Uint8Array } | { kind: "dir" } | { kind: "none" };

export const emptyState = (email: string, rootFolderId: string, pageToken: string): SyncState => ({
  accountEmail: email, rootFolderId, pageToken, folders: {}, entries: {}, queue: [], lastSyncAt: null, lastError: null, conflicts: [],
});

export class SyncEngine {
  private chain: Promise<unknown> = Promise.resolve();
  private flushing = false;
  private inflight = new Set<string>();
  private folderJobs = new Map<string, Promise<string>>();

  constructor(private d: EngineDeps, readonly state: SyncState) {}

  private abs = (rel: string) => join(this.d.root(), rel);
  private save = () => this.d.saveState(this.state);
  private emit(kind: SyncKind, error: string | null = null) {
    this.d.onStatus({ kind, pending: this.state.queue.length, lastSyncAt: this.state.lastSyncAt, error });
  }

  private async local(rel: string): Promise<Local> {
    const p = this.abs(rel);
    if (!(await this.d.fs.exists(p))) return { kind: "none" };
    try {
      const bytes = await this.d.fs.readBytes(p);
      return { kind: "file", bytes, sha: await sha256Hex(bytes) };
    } catch {
      return (await this.d.fs.readDir(p).then(() => true, () => false)) ? { kind: "dir" } : { kind: "none" };
    }
  }

  private async walk(dir = ""): Promise<string[]> {
    const out: string[] = [];
    for (const e of await this.d.fs.readDir(dir ? this.abs(dir) : this.d.root())) {
      const rel = nfc(dir ? `${dir}/${e.name}` : e.name);
      if (isIgnored(rel)) continue;
      if (e.isDirectory) out.push(...(await this.walk(rel)));
      else out.push(rel);
    }
    return out;
  }

  // ---- queue / push ----

  private enqueue(op: "upload" | "trash", relPath: string) {
    this.state.queue = this.state.queue.filter((q) => q.relPath !== relPath).concat({ op, relPath, enqueuedAt: this.d.now() });
  }

  /** A path changed on disk (already debounced by the caller). */
  async localChanged(relIn: string): Promise<void> {
    const rel = nfc(relIn);
    if (isIgnored(rel)) return;
    const l = await this.local(rel);
    if (l.kind === "file") {
      if (this.state.entries[rel]?.sha256 !== l.sha) this.enqueue("upload", rel);
    } else if (l.kind === "dir") {
      for (const f of await this.walk(rel)) await this.localChanged(f);
    } else {
      for (const k of Object.keys(this.state.entries)) if (k === rel || k.startsWith(`${rel}/`)) this.enqueue("trash", k);
    }
    await this.save();
    if (this.state.queue.length) this.emit("syncing");
  }

  private folder(rel: string): Promise<string> {
    if (!rel) return Promise.resolve(this.state.rootFolderId);
    const known = this.state.folders[rel];
    if (known) return Promise.resolve(known);
    let job = this.folderJobs.get(rel);
    if (!job) {
      job = (async () => {
        const id = await this.d.drive.createFolder(base(rel), await this.folder(dirname(rel)), { shalavPath: rel });
        this.state.folders[rel] = id;
        return id;
      })().finally(() => this.folderJobs.delete(rel));
      this.folderJobs.set(rel, job);
    }
    return job;
  }

  private async pushOne(op: "upload" | "trash", rel: string) {
    const entry = this.state.entries[rel];
    if (op === "trash") {
      if (entry && (await this.local(rel)).kind === "none") {
        await this.d.drive.trash(entry.fileId);
        delete this.state.entries[rel];
      }
      return;
    }
    const l = await this.local(rel);
    if (l.kind !== "file" || entry?.sha256 === l.sha) return;
    const item = await this.d.drive.upload({
      name: base(rel), parentId: await this.folder(dirname(rel)), props: { shalavPath: rel, sha256: l.sha }, bytes: l.bytes, existingId: entry?.fileId,
    });
    this.state.entries[rel] = { fileId: item.id, sha256: l.sha, remoteModifiedTime: item.modifiedTime, size: l.bytes.length, syncedAt: this.d.now() };
  }

  /** Drains the queue with up to 3 concurrent transfers (14.7). Throws on the first failing transfer; the item stays queued. */
  private async drain() {
    if (this.flushing) return;
    this.flushing = true;
    try {
      let failure: unknown = null;
      const worker = async () => {
        for (;;) {
          const item = failure ? undefined : this.state.queue.find((q) => !this.inflight.has(q.relPath));
          if (!item) return;
          this.inflight.add(item.relPath);
          try {
            await this.pushOne(item.op, item.relPath);
            this.state.queue = this.state.queue.filter((q) => q !== item);
            await this.save();
            this.emit("syncing");
          } catch (e) {
            failure ??= e;
          } finally {
            this.inflight.delete(item.relPath);
          }
        }
      };
      await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
      if (failure) throw failure;
    } finally {
      this.flushing = false;
    }
  }

  // ---- pull ----

  private async download(rel: string, item: DriveItem, notify = true) {
    const bytes = await this.d.drive.download(item.id);
    const p = this.abs(rel);
    await this.d.fs.mkdir(dirname(p));
    await this.d.fs.writeBytes(`${p}.tmp`, bytes);
    await this.d.fs.rename(`${p}.tmp`, p);
    this.state.entries[rel] = { fileId: item.id, sha256: await sha256Hex(bytes), remoteModifiedTime: item.modifiedTime, size: bytes.length, syncedAt: this.d.now() };
    const c = courseOf(rel);
    if (c && notify) this.d.onDataChanged(c);
  }

  private link(rel: string, item: DriveItem, sha: string) {
    this.state.entries[rel] = { fileId: item.id, sha256: sha, remoteModifiedTime: item.modifiedTime, size: item.size, syncedAt: this.d.now() };
  }

  private async history(rel: string, bytes: Uint8Array) {
    const c = courseOf(rel);
    if (!c) return;
    const dir = join(this.d.root(), "courses", c, ".shalav", "history");
    await this.d.fs.mkdir(dir);
    await this.d.fs.writeBytes(join(dir, `${base(rel).replace(/\.json$/, "")}-${this.d.now().replace(/[:.]/g, "-")}.json`), bytes);
  }

  /** Both sides differ (or no common ancestor): 14.5 conflict rule by sync class. */
  private async conflict(rel: string, item: DriveItem, l: Extract<Local, { kind: "file" }>) {
    switch (syncClass(rel)) {
      case "user-file": {
        const dot = base(rel).lastIndexOf(".");
        const name = base(rel);
        const stem = dot > 0 ? name.slice(0, dot) : name;
        const ext = dot > 0 ? name.slice(dot) : "";
        let copy = nfc(join(dirname(rel), `${stem} (${this.d.deviceName()})${ext}`));
        for (let n = 2; await this.d.fs.exists(this.abs(copy)); n++) copy = nfc(join(dirname(rel), `${stem} (${this.d.deviceName()} ${n})${ext}`));
        await this.d.fs.rename(this.abs(rel), this.abs(copy));
        delete this.state.entries[rel];
        await this.download(rel, item);
        this.enqueue("upload", copy);
        this.state.conflicts = [{ relPath: copy, at: this.d.now() }, ...this.state.conflicts].slice(0, 20);
        this.d.onConflict?.(copy);
        return;
      }
      case "per-device-append":
        if (ownerDevice(rel) === this.d.deviceId) {
          this.link(rel, item, item.appProperties.sha256 ?? "");
          this.enqueue("upload", rel);
        } else await this.download(rel, item);
        return;
      case "shared-config": {
        const remote = await this.d.drive.download(item.id);
        const stamp = (b: Uint8Array) => {
          try {
            const j = JSON.parse(new TextDecoder().decode(b)) as { updatedAt?: string; createdAt?: string };
            return j.updatedAt ?? j.createdAt ?? "";
          } catch {
            return "";
          }
        };
        if (stamp(remote) > stamp(l.bytes)) {
          await this.history(rel, l.bytes);
          await this.download(rel, item);
        } else {
          await this.history(rel, remote);
          this.link(rel, item, item.appProperties.sha256 ?? "");
          this.enqueue("upload", rel);
        }
        return;
      }
      default: // content-addressed, derived: remote wins
        await this.download(rel, item);
    }
  }

  private async applyRemote(rel: string, item: DriveItem) {
    const l = await this.local(rel);
    const entry = this.state.entries[rel];
    const remoteSha = item.appProperties.sha256;
    if (l.kind !== "file") return this.download(rel, item);
    if (entry && l.sha === entry.sha256) return this.download(rel, item);
    if (!entry && remoteSha === l.sha) return this.link(rel, item, l.sha);
    return this.conflict(rel, item, l);
  }

  private async pullOnce() {
    const { changes, newToken } = await this.d.drive.changes(this.state.pageToken);
    const byId = (id: string) => Object.entries(this.state.entries).find(([, e]) => e.fileId === id)?.[0];
    for (const c of changes) {
      const rel = c.file?.appProperties.shalavPath ?? byId(c.fileId);
      if (!rel || isIgnored(rel)) continue;
      const gone = c.removed || !!c.file?.trashed;
      if (c.file?.isFolder) {
        if (gone) delete this.state.folders[rel];
        else this.state.folders[rel] = c.file.id;
        continue;
      }
      const entry = this.state.entries[rel];
      if (gone) {
        if (!entry || entry.fileId !== c.fileId) continue;
        const l = await this.local(rel);
        delete this.state.entries[rel];
        if (l.kind !== "file") continue;
        if (l.sha === entry.sha256) {
          await this.d.trashLocal(this.abs(rel));
          const course = courseOf(rel);
          if (course) this.d.onDataChanged(course);
        } else this.enqueue("upload", rel); // local edit beats remote delete
      } else if (c.file && !(entry?.fileId === c.file.id && c.file.appProperties.sha256 === entry.sha256)) {
        await this.applyRemote(rel, c.file);
      }
    }
    this.state.pageToken = newToken;
    this.state.lastSyncAt = this.d.now();
    await this.save();
  }

  // ---- public cycle ----

  private run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    const next = this.chain.then(async () => {
      try {
        this.emit("syncing");
        const r = await fn();
        this.state.lastError = null;
        this.emit("synced");
        await this.save();
        return r;
      } catch (e) {
        if (e instanceof OfflineError) this.emit("offline");
        else if (e instanceof ReconnectError) this.emit("reconnect");
        else {
          const msg = e instanceof Error ? e.message : String(e);
          this.state.lastError = msg;
          this.emit("error", msg);
        }
        await this.save().catch(() => undefined);
        return undefined;
      }
    });
    this.chain = next;
    return next;
  }

  /** Pull, push the queue, pull again if something was pushed (14.5). */
  cycle(): Promise<void> {
    return this.run(async () => {
      await this.pullOnce();
      if (this.state.queue.length) {
        await this.drain();
        await this.pullOnce();
      }
    }).then(() => undefined);
  }

  /** Initial connect (14.5): link / upload / download / conflict per path. */
  initial(): Promise<void> {
    return this.run(async () => {
      const remote = new Map<string, DriveItem>();
      const todo = [this.state.rootFolderId];
      for (let id = todo.pop(); id; id = todo.pop())
        for (const it of await this.d.drive.listChildren(id)) {
          const rel = it.appProperties.shalavPath;
          if (!rel || it.trashed) continue;
          if (it.isFolder) {
            this.state.folders[rel] = it.id;
            todo.push(it.id);
          } else remote.set(rel, it);
        }
      const locals = new Set(await this.walk());
      for (const rel of new Set([...locals, ...remote.keys()])) {
        const item = remote.get(rel);
        if (!item) this.enqueue("upload", rel);
        else await this.applyRemote(rel, item);
      }
      await this.save();
      await this.drain();
    }).then(() => undefined);
  }
}
