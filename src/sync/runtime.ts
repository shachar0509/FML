import { create } from "zustand";
import { toast } from "@/components/ui/toaster";
import { scheduleRecompute } from "@/domain/progress/store";
import i18n from "@/i18n";
import { getDeviceId } from "@/lib/device";
import { readJsonFile, writeJsonAtomic } from "@/lib/fs/atomicWrite";
import { fs } from "@/lib/fs/fs";
import { join, nfc } from "@/lib/fs/paths";
import { nowIso } from "@/lib/time";
import { useSettings } from "@/stores/settings";
import { createTokenSource, googleConfigured, revokeAndForget, signIn, REFRESH_ACCOUNT } from "./auth";
import { createDrive } from "./drive";
import { emptyState, SyncEngine } from "./engine";
import { SyncStateSchema, type SyncState, type SyncStatus } from "./types";
import { secretGet } from "@/lib/secrets";

export type { ConflictCopy, SyncKind, SyncStatus } from "./types";
export const syncAvailable = googleConfigured;

const OFF: SyncStatus = { kind: "off", pending: 0, lastSyncAt: null, error: null };
export const useSyncStatus = create<{ status: SyncStatus; email: string | null; conflicts: { relPath: string; at: string }[] }>(() => ({
  status: OFF, email: null, conflicts: [],
}));
/** Bumped whenever a pull changed data on disk; screens that cache disk state can depend on it. */
export const useDataVersion = create<{ version: number; course: string | null }>(() => ({ version: 0, course: null }));

const DEBOUNCE_MS = 2500;
const POLL_MS = 45_000;
let hostName = "device";
let engine: SyncEngine | null = null;
let stopAll: (() => void) | null = null;

const configDir = async () => (await import("@tauri-apps/api/path")).appConfigDir();
const stateFile = async () => join(await configDir(), "sync-state.json");

function makeEngine(state: SyncState): SyncEngine {
  const tokens = createTokenSource();
  const eng: SyncEngine = new SyncEngine(
    {
      drive: createDrive({ token: tokens.token, fetchFn: async (...a) => ((await import("@tauri-apps/plugin-http")).fetch as typeof fetch)(...a) }),
      fs: fs(),
      root: () => useSettings.getState().settings.dataRoot,
      deviceId: getDeviceId(),
      deviceName: () => hostName,
      saveState: async (s) => void (await writeJsonAtomic(await stateFile(), s)),
      trashLocal: async (path) => {
        await (await import("@tauri-apps/api/core")).invoke("trash_path", { path });
      },
      now: nowIso,
      onStatus: (status) => useSyncStatus.setState({ status, conflicts: eng.state.conflicts }),
      onDataChanged: (course) => {
        useDataVersion.setState((s) => ({ version: s.version + 1, course }));
        scheduleRecompute(course);
      },
      onConflict: () => toast({ message: i18n.t("sync.conflict") }),
    },
    state,
  );
  void import("@tauri-apps/plugin-os").then(async (os) => void (hostName = (await os.hostname()) ?? "device"));
  useSyncStatus.setState({ email: state.accountEmail, conflicts: state.conflicts, status: { ...OFF, kind: "synced", lastSyncAt: state.lastSyncAt } });
  return eng;
}

/** Watch the data root, poll every 45 s, pull on focus (14.5). */
async function startLoops(eng: SyncEngine) {
  stopAll?.();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let unwatch: (() => void) | null = null;
  let watchedRoot = "";
  const watchRoot = async () => {
    unwatch?.();
    watchedRoot = useSettings.getState().settings.dataRoot;
    const root = watchedRoot;
    unwatch = await (await import("@tauri-apps/plugin-fs")).watch(
      root,
      (ev) => {
        for (const p of ev.paths) {
          if (!p.startsWith(root)) continue;
          const rel = nfc(p.slice(root.length).replace(/^[\\/]+/, "").replace(/\\/g, "/"));
          if (!rel) continue;
          clearTimeout(timers.get(rel));
          timers.set(rel, setTimeout(() => {
            timers.delete(rel);
            void eng.localChanged(rel).then(() => eng.cycle());
          }, DEBOUNCE_MS));
        }
      },
      { recursive: true, delayMs: 500 },
    ).catch(() => null);
  };
  await watchRoot();
  const unsub = useSettings.subscribe((s) => {
    if (s.settings.dataRoot !== watchedRoot) void watchRoot();
  });
  const poll = setInterval(() => document.visibilityState === "visible" && void eng.cycle(), POLL_MS);
  const onFocus = () => void eng.cycle();
  window.addEventListener("focus", onFocus);
  stopAll = () => {
    unwatch?.();
    unsub();
    clearInterval(poll);
    window.removeEventListener("focus", onFocus);
    timers.forEach(clearTimeout);
    stopAll = null;
  };
}

/** Called at startup (main.tsx, Tauri only): resumes sync when a refresh token and sync-state.json exist. */
export async function startSyncIfConnected(): Promise<void> {
  if (!syncAvailable) return;
  const state = await readJsonFile(await stateFile(), SyncStateSchema);
  if (!state || !(await secretGet(REFRESH_ACCOUNT))) return;
  engine = makeEngine(state);
  await startLoops(engine);
  void engine.cycle();
}

export async function connectSync(): Promise<void> {
  if (!syncAvailable) throw new Error(i18n.t("settings.sync.unavailable"));
  const email = await signIn();
  const tokens = createTokenSource();
  const drive = createDrive({ token: tokens.token, fetchFn: async (...a) => ((await import("@tauri-apps/plugin-http")).fetch as typeof fetch)(...a) });
  const rootId = (await drive.findRoot()) ?? (await drive.createFolder("Shalav", null, { shalavRoot: "1", formatVersion: "1" }));
  const state = emptyState(email, rootId, await drive.startPageToken());
  await writeJsonAtomic(await stateFile(), state);
  engine = makeEngine(state);
  await engine.initial();
  const { kind, error } = useSyncStatus.getState().status;
  if (kind === "error" || kind === "reconnect" || kind === "offline") {
    await disconnectSync();
    throw new Error(error ?? kind);
  }
  await startLoops(engine);
}

export async function disconnectSync(): Promise<void> {
  stopAll?.();
  engine = null;
  await revokeAndForget();
  await fs().remove(await stateFile()).catch(() => undefined);
  useSyncStatus.setState({ status: OFF, email: null, conflicts: [] });
}

export const syncNow = async () => void (await engine?.cycle());
export const retrySync = syncNow;
