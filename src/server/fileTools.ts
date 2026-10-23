import { AsyncLocalStorage } from "node:async_hooks";
import { COURSE_ID_RE, isCustom } from "@/core/universities";
import { join } from "node:path";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { FileCounts, FilesData } from "@/cards/types";
import { claude } from "@/core/claude/runtime";
import { loadCourse, courseExists } from "@/core/domain/courses/courses";
import { importFiles, reindex, removeFile, scanCourse, type Deps } from "@/core/domain/ingest/import";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { openSource } from "@/core/domain/ingest/pageSource";
import { createIndexQueue } from "@/core/domain/ingest/queue";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { native, openFolder } from "./native";
import type { MoodleState } from "@/cards/types";
import { CHUNK_B64_MAX, chunkedUploads } from "./chunks";
import { CARDS_URI } from "./resources";

const both = { ui: { resourceUri: CARDS_URI, visibility: ["model" as const, "app" as const] } }; // plain tools in hosts without cards (Claude Code)
const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const num = z.string().regex(COURSE_ID_RE);
const numIn = z.object({ number: num });
const role = z.enum(["material", "exercises", "teacher"]);
const out = (text: string, structuredContent: object) => ({ content: [{ type: "text" as const, text }], structuredContent: structuredContent as Record<string, unknown> });
const fail = (text: string) => ({ ...out(text, { ok: false, error: text }), isError: true });

// Indexing starts only on "Build plan" (it spends the student's subscription), so import never enqueues.
export const importDeps = (): Deps => ({ native, open: openSource, enqueue: () => undefined, platform: process.platform === "win32" ? "windows" : "macos" });

/** Files and indexing (plan v2 §6.6): chunked upload, open folder, scan, status; indexing runs inside "Build plan" (courseTools). */
export function registerFileTools(server: McpServer, o: { openFolder?: (p: string) => Promise<void>; moodle?: () => MoodleState } = {}) {
  const root = () => useSettings.getState().settings.dataRoot;
  const lang = () => useSettings.getState().settings.language;
  const prog = new Map<string, { done: number; total: number }>();
  const queue = createIndexQueue({
    gw: () => claude(),
    open: openSource,
    getPlan: async (c) => (await loadCourse(c))?.plan ?? null,
    course: async (c) => (await loadCourse(c))?.course ?? null,
    lang,
    resolve: (c, rec) => join(coursePaths(root(), c).course, rec.relPath),
    bind: () => AsyncLocalStorage.snapshot(),
  });
  queue.subscribe((e) => (e.done === undefined ? prog.delete(e.sha256) : prog.set(e.sha256, { done: e.done, total: e.total ?? 0 })));
  const deps = importDeps;
  const builds = new Map<string, Set<string>>(); // course → the files its running plan build reads; a file added meanwhile waits for the next build
  const scans = new Map<string, Promise<unknown>>(); // one folder scan per course at a time (the card polls)

  /** Follows the folders: files added outside the app are registered, deleted ones are dropped and stop being read (like Remove in the card). */
  function scan(number: string) {
    const run = scans.get(number) ?? scanCourse(number, deps()).then(({ removed }) => removed.forEach((sha) => queue.cancel(number, sha))).finally(() => scans.delete(number));
    scans.set(number, run);
    return run;
  }

  async function list(number: string): Promise<FilesData> {
    await scan(number);
    const recs = await listFileIndexes(number);
    const mine = builds.get(number);
    const row = (r: (typeof recs)[number]) => ({ sha: r.sha256, name: r.fileName, pages: r.pageCount, status: r.status, error: r.error, exercises: r.exercises.length, solved: r.exercises.filter((e) => e.referenceSolutionMd).length, inBuild: mine?.has(r.sha256), ...prog.get(r.sha256) });
    const { language, theme } = useSettings.getState().settings;
    return {
      view: "files", language, theme, number,
      materials: recs.filter((r) => r.role === "material").map(row),
      exercises: recs.filter((r) => r.role === "exercises").map(row),
      teacher: recs.filter((r) => r.role === "teacher").map(row),
      moodle: (await loadCourse(number).then((c) => c && isCustom(c.course))) ? null : (o.moodle?.() ?? null), // a custom course has no Moodle
    };
  }

  registerAppTool(server, "files_list", { title: "Course files", description: "Scan the course folder and list the files with their indexing status.", inputSchema: numIn, _meta: both }, async ({ number }) => {
    if (!(await courseExists(number))) return fail("No such course.");
    const d = await list(number);
    return out(`${d.materials.length} materials, ${d.exercises.length} exercise files`, d);
  });

  // Chunks arrive in order; the file is reassembled in a temp dir under its real name, then imported like a picked file.
  const uploads = chunkedUploads("shalav-up-");
  registerAppTool(
    server,
    "file_upload_chunk",
    {
      title: "Upload a file chunk",
      description: "Card-only: one base64 chunk (at most 4 MB) of a file; the last chunk imports it.",
      inputSchema: z.object({ number: num, role, name: z.string().min(1), index: z.number().int().min(0), total: z.number().int().min(1), data: z.string().max(CHUNK_B64_MAX) }),
      _meta: appOnly,
    },
    async ({ number, role: r, name, index, total, data }) => {
      if (!(await courseExists(number))) return fail("No such course.");
      try {
        const u = await uploads(`${number}/${r}/${name}`, name, { index, total, data }, async (path) => (await importFiles(number, r, [path], deps()))[0]);
        if (!u.done) return out("ok", { ok: true, done: false });
        const res = u.value;
        return out(res?.status ?? "failed", { ok: true, done: true, status: res?.status ?? "failed", error: res && "error" in res ? res.error : undefined });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  registerAppTool(server, "files_open_folder", { title: "Open course folder", description: "Card-only: reveal the course folder in Finder/Explorer.", inputSchema: z.object({ number: num, role }), _meta: appOnly }, async ({ number, role: r }) => {
    const p = coursePaths(root(), number);
    await (o.openFolder ?? openFolder)(r === "material" ? p.materials : r === "teacher" ? p.teacher : p.exercises);
    return out("ok", { ok: true });
  });

  /** A plan build starts: it reads the files not scanned now; files added later wait for the next build. `release` when it ends. */
  async function claim(number: string) {
    await scan(number);
    builds.set(number, new Set((await listFileIndexes(number)).filter((r) => r.status === "pending" || r.status === "failed").map((r) => r.sha256)));
  }
  const release = (number: string) => void builds.delete(number);

  /** Index every pending/failed file the build claimed against the current plan (part of "Build plan").
   *  Returns `indexed`: how many files of the course are indexed after it (all of them, as before), and
   *  `read`: how many of THIS build's files it read successfully (failed and removed ones not counted).
   *  `on` gets the build's files (materials and exercises together) by state, like the file lists: scanned, scanning, not scanned (waiting or failed). */
  async function indexPending(number: string, on: (c: FileCounts) => void = () => undefined): Promise<{ indexed: number; read: number }> {
    const mine = builds.get(number);
    const todo = (await listFileIndexes(number)).filter((r) => (r.status === "pending" || r.status === "failed") && (!mine || mine.has(r.sha256)));
    const state = new Map(todo.map((r) => [r.sha256, "pending" as string]));
    const report = () => {
      const v = [...state.values()];
      on({ scanned: v.filter((s) => s === "indexed").length, scanning: v.filter((s) => s === "indexing").length, notScanned: v.filter((s) => s === "pending" || s === "failed").length, total: v.length });
    };
    report();
    const off = queue.subscribe((e) => {
      if (e.course !== number || !state.has(e.sha256)) return;
      if (e.status === "removed") state.delete(e.sha256);
      else if (state.get(e.sha256) !== e.status) state.set(e.sha256, e.status);
      else return; // page progress of a file already scanning
      report();
    });
    try {
      for (const r of todo) await queue.retry(number, r.sha256);
      await queue.idle(number); // its own files only: another course's build may be indexing too
    } finally {
      off?.();
    }
    const done = (await listFileIndexes(number)).filter((r) => r.status === "indexed");
    return { indexed: done.length, read: done.filter((r) => state.has(r.sha256)).length }; // state: this build's files minus removed ones
  }

  registerAppTool(server, "file_open", { title: "Open a file", description: "Card-only: open a course file in the system's default app.", inputSchema: z.object({ number: num, sha: z.string() }), _meta: appOnly }, async ({ number, sha }) => {
    const r = (await listFileIndexes(number)).find((x) => x.sha256 === sha);
    if (!r) return fail("No such file.");
    await (o.openFolder ?? openFolder)(join(coursePaths(root(), number).course, r.relPath)); // `open` / explorer / xdg-open open files too
    return out("ok", { ok: true });
  });

  // M41: files read before the trap / key point / note fields are re-read only when the student asks; the next Build/Update plan reads it.
  registerAppTool(server, "file_reindex", { title: "Read a file again", description: "Card-only: mark a course file to be read again by the next Build plan / Update plan.", inputSchema: z.object({ number: num, sha: z.string() }), _meta: appOnly }, async ({ number, sha }) => {
    const r = (await listFileIndexes(number)).find((x) => x.sha256 === sha);
    if (!r) return fail("No such file.");
    if (r.status === "indexing") return fail("This file is being read right now.");
    await reindex(number, r, deps());
    return out("ok", { ok: true });
  });

  registerAppTool(server, "file_remove", { title: "Remove a file", description: "Card-only: move a course file to the trash and drop its index.", inputSchema: z.object({ number: num, sha: z.string() }), _meta: appOnly }, async ({ number, sha }) => {
    const r = (await listFileIndexes(number)).find((x) => x.sha256 === sha);
    if (!r) return fail("No such file.");
    queue.cancel(number, sha); // stop reading it first: no more model work on a removed file
    await removeFile(number, r, deps());
    return out("ok", { ok: true });
  });

  return { indexPending, claim, release };
}
