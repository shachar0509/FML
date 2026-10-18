import { EXERCISES_DIR, MATERIALS_DIR } from "@/constants";

export type SyncClass = "user-file" | "per-device-append" | "content-addressed" | "shared-config" | "derived";

const IGNORED = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]*|[^/]*\.tmp)$/;
export const isIgnored = (rel: string): boolean => IGNORED.test(rel);

/** Spec 3.3 table; `rel` is relative to the data root. */
export function syncClass(rel: string): SyncClass {
  if (rel === "shalav.json") return "shared-config";
  const m = /^courses\/[^/]+\/(.*)$/.exec(rel);
  if (!m) return "user-file";
  const r = m[1] as string;
  if (r === "course.json" || r === "plan.json") return "shared-config";
  if (r === "plan.md" || r === "progress.json" || r === "progress.md") return "derived";
  if (/^\.shalav\/(events|sessions|generated)\//.test(r)) return "per-device-append";
  if (/^\.shalav\/(index|history|briefs)\//.test(r)) return "content-addressed";
  if (r.startsWith(`${MATERIALS_DIR}/`) || r.startsWith(`${EXERCISES_DIR}/`) || r.startsWith(".shalav/attachments/")) return "user-file";
  return "user-file";
}

/** `.shalav/events/<id>.jsonl`, `sessions/.../<id>.jsonl`, `generated/<id>.json` belong to the device named in the file. */
export const ownerDevice = (rel: string): string => (rel.split("/").pop() ?? "").replace(/\.[^.]+$/, "");

export const courseOf = (rel: string): string | null => /^courses\/([^/]+)\//.exec(rel)?.[1] ?? null;

export type SyncAction = "download" | "link" | "copy" | "keep-local" | "newest";

/** 14.5 pull rule for one path. `local` is null when there is no local file. `owned`: the file belongs to this device. */
export function decideSyncAction(local: { sha: string } | null, entrySha: string | undefined, remoteSha: string | undefined, cls: SyncClass, owned: boolean): SyncAction {
  if (!local) return "download";
  if (entrySha !== undefined && local.sha === entrySha) return "download";
  if (entrySha === undefined && remoteSha === local.sha) return "link";
  if (cls === "user-file") return "copy";
  if (cls === "per-device-append") return owned ? "keep-local" : "download";
  if (cls === "shared-config") return "newest";
  return "download";
}
