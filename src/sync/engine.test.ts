import { describe, expect, it } from "vitest";
import { memFs } from "@/test/memfs";
import { SyncEngine, emptyState, type EngineDeps } from "./engine";
import type { DriveChange, DriveItem, DrivePort } from "./types";

/** In-memory Drive: files keyed by id, change log indexed by token. */
function fakeDrive() {
  let n = 0;
  const items = new Map<string, DriveItem & { bytes?: Uint8Array }>();
  const log: DriveChange[] = [];
  const put = (it: DriveItem & { bytes?: Uint8Array }) => (items.set(it.id, it), log.push({ fileId: it.id, removed: false, file: it }), it);
  const drive: DrivePort = {
    findRoot: async () => null,
    createFolder: async (name, parentId, appProperties) => put({ id: `f${++n}`, name, isFolder: true, size: 0, modifiedTime: "t", appProperties, parentId, trashed: false }).id,
    listChildren: async (id) => [...items.values()].filter((i) => i.parentId === id && !i.trashed),
    upload: async ({ name, parentId, props, bytes, existingId }) =>
      put({ id: existingId ?? `f${++n}`, name, isFolder: false, size: bytes.length, modifiedTime: `t${++n}`, appProperties: props, parentId, trashed: false, bytes }),
    download: async (id) => items.get(id)?.bytes ?? new Uint8Array(),
    trash: async (id) => void put({ ...(items.get(id) as DriveItem), trashed: true }),
    startPageToken: async () => String(log.length),
    changes: async (t) => ({ changes: log.slice(Number(t)), newToken: String(log.length) }),
  };
  return drive;
}

function device(drive: DrivePort, id: string, rootId: string) {
  const fs = memFs();
  const trashed: string[] = [];
  const deps: EngineDeps = {
    drive, fs, root: () => "/r", deviceId: id, deviceName: () => id, saveState: async () => {}, now: () => new Date().toISOString(),
    trashLocal: async (p) => (trashed.push(p), void (await fs.remove(p))), onStatus: () => {}, onDataChanged: () => {},
  };
  const eng = new SyncEngine(deps, emptyState("a@b", rootId, "0"));
  return { fs, eng, trashed };
}
const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

describe("sync engine", () => {
  it("pushes, pulls, resolves conflicts and propagates deletes between two devices", async () => {
    const drive = fakeDrive();
    const root = await drive.createFolder("Shalav", null, { shalavRoot: "1" });
    const A = device(drive, "A", root);
    const B = device(drive, "B", root);
    const mat = "courses/01040195/חומרי לימוד/a.txt";
    const ev = "courses/01040195/.shalav/events/A.jsonl";

    await A.fs.writeBytes(`/r/${mat}`, enc("one"));
    await A.fs.writeText(`/r/${ev}`, "e1\n");
    await A.eng.initial();
    await B.eng.cycle();
    expect(dec(await B.fs.readBytes(`/r/${mat}`))).toBe("one");
    expect(await B.fs.readText(`/r/${ev}`)).toBe("e1\n");

    // user-file conflict: both edit; B pulls A's push -> keeps both
    await A.fs.writeBytes(`/r/${mat}`, enc("from A"));
    await B.fs.writeBytes(`/r/${mat}`, enc("from B"));
    await A.eng.localChanged(mat);
    await A.eng.cycle();
    await B.eng.cycle();
    expect(dec(await B.fs.readBytes(`/r/${mat}`))).toBe("from A");
    expect(dec(await B.fs.readBytes(`/r/courses/01040195/חומרי לימוד/a (B).txt`))).toBe("from B");
    expect(B.eng.state.conflicts).toHaveLength(1);
    await B.eng.cycle(); // pushes the conflict copy
    await A.eng.cycle();
    expect(dec(await A.fs.readBytes(`/r/courses/01040195/חומרי לימוד/a (B).txt`))).toBe("from B");

    // own downloads are not echoed back
    expect(A.eng.state.queue).toHaveLength(0);

    // delete propagates to the OS trash
    await A.fs.remove(`/r/${mat}`);
    await A.eng.localChanged(mat);
    await A.eng.cycle();
    await B.eng.cycle();
    expect(B.trashed).toEqual([`/r/${mat}`]);
  });
});
