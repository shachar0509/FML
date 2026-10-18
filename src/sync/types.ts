import { z } from "zod";

// Spec 14.4 (+ `conflicts`, for the Sync tab's list of conflict copies).
export const SyncStateSchema = z.object({
  accountEmail: z.string(),
  rootFolderId: z.string(),
  pageToken: z.string(),
  folders: z.record(z.string(), z.string()).default({}),
  entries: z
    .record(z.string(), z.object({ fileId: z.string(), sha256: z.string(), remoteModifiedTime: z.string(), size: z.number(), syncedAt: z.string() }))
    .default({}),
  queue: z.array(z.object({ op: z.enum(["upload", "trash"]), relPath: z.string(), enqueuedAt: z.string() })).default([]),
  lastSyncAt: z.string().nullable().default(null),
  lastError: z.string().nullable().default(null),
  conflicts: z.array(z.object({ relPath: z.string(), at: z.string() })).default([]),
});
export type SyncState = z.infer<typeof SyncStateSchema>;

export type DriveItem = {
  id: string;
  name: string;
  isFolder: boolean;
  size: number;
  modifiedTime: string;
  /** shalavPath / sha256 as set by us. */
  appProperties: Record<string, string>;
  parentId: string | null;
  trashed: boolean;
};
export type DriveChange = { fileId: string; removed: boolean; file?: DriveItem };

/** The Drive calls the engine needs (14.3/14.5). Real impl in drive.ts, in-memory fake in tests. */
export interface DrivePort {
  findRoot(): Promise<string | null>;
  createFolder(name: string, parentId: string | null, props: Record<string, string>): Promise<string>;
  listChildren(folderId: string): Promise<DriveItem[]>;
  upload(o: { name: string; parentId: string; props: Record<string, string>; bytes: Uint8Array; existingId?: string }): Promise<DriveItem>;
  download(fileId: string): Promise<Uint8Array>;
  trash(fileId: string): Promise<void>;
  startPageToken(): Promise<string>;
  /** Pages through everything since `token`. */
  changes(token: string): Promise<{ changes: DriveChange[]; newToken: string }>;
}

/** Network unreachable: status "offline", queue kept. */
export class OfflineError extends Error {}
/** Refresh token rejected (invalid_grant): status "reconnect". */
export class ReconnectError extends Error {}

export type SyncKind = "off" | "synced" | "syncing" | "offline" | "error" | "reconnect";
export type SyncStatus = { kind: SyncKind; pending: number; lastSyncAt: string | null; error: string | null };
export type ConflictCopy = { relPath: string; at: string };
