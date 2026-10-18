import { describe, expect, it } from "vitest";
import { decideSyncAction, type SyncAction, type SyncClass } from "./classes";

const L = { sha: "L" };
// [local, entry, remote, class, owned, expected]
const table: [typeof L | null, string | undefined, string | undefined, SyncClass, boolean, SyncAction][] = [
  [null, undefined, "R", "user-file", false, "download"],
  [L, "L", "R", "user-file", false, "download"], // local unchanged since last sync
  [L, undefined, "L", "user-file", false, "link"], // same bytes, no entry
  [L, "E", "R", "user-file", false, "copy"], // both changed
  [L, undefined, "R", "user-file", false, "copy"], // no ancestor, different
  [L, "E", "R", "per-device-append", true, "keep-local"],
  [L, "E", "R", "per-device-append", false, "download"],
  [L, "E", "R", "shared-config", false, "newest"],
  [L, "E", "R", "content-addressed", false, "download"],
  [L, "E", "R", "derived", false, "download"],
];

describe("decideSyncAction", () => {
  it.each(table)("%j %s %s %s owned=%s -> %s", (l, e, r, c, o, want) => expect(decideSyncAction(l, e, r, c, o)).toBe(want));
});
