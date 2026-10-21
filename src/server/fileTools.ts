import { AsyncLocalStorage } from "node:async_hooks";
import { COURSE_ID_RE } from "@/core/universities";
import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { FilesData } from "@/cards/types";
import { claude } from "@/core/claude/runtime";
import { loadCourse, courseExists } from "@/core/domain/courses/courses";
import { importFiles, removeFile, scanCourse, type Deps } from "@/core/domain/ingest/import";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { openSource } from "@/core/domain/ingest/pageSource";
import { createIndexQueue } from "@/core/domain/ingest/queue";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { native, openFolder } from "./native";
import type { MoodleState } from "@/cards/types";
import { CARDS_URI } from "./resources";

const both = { ui: { resourceUri: CARDS_URI, visibility: ["model" as const, "app" as const] } }; // plain tools in hosts without cards (Claude Code)
const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const num = z.string().regex(COURSE_ID_RE);
const numIn = z.object({ number: num });
const role = z.enum(["material", "exercises"]);
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

  async function list(number: string): Promise<FilesData> {
    await scanCourse(number, deps());
    const recs = await listFileIndexes(number);
    const row = (r: (typeof recs)[number]) => ({ sha: r.sha256, name: r.fileName, pages: r.pageCount, status: r.status, error: r.error, exercises: r.exercises.length, solved: r.exercises.filter((e) => e.referenceSolutionMd).length, ...prog.get(r.sha256) });
    const { language, theme } = useSettings.getState().settings;
    return {
      view: "files", language, theme, number,
      materials: recs.filter((r) => r.role === "material").map(row),
      exercises: recs.filter((r) => r.role === "exercises").map(row),
      moodle: o.moodle?.() ?? null,
    };
  }

  registerAppTool(server, "files_list", { title: "Course files", description: "Scan the course folder and list the files with their indexing status.", inputSchema: numIn, _meta: both }, async ({ number }) => {
    if (!(await courseExists(number))) return fail("No such course.");
    const d = await list(number);
    return out(`${d.materials.length} materials, ${d.exercises.length} exercise files`, d);
  });

  // Chunks arrive in order; the file is reassembled in a temp dir under its real name, then imported like a picked file.
  const uploads = new Map<string, { dir: string; path: string; next: number }>();
  registerAppTool(
    server,
    "file_upload_chunk",
    {
      title: "Upload a file chunk",
      description: "Card-only: one base64 chunk (at most 4 MB) of a file; the last chunk imports it.",
      inputSchema: z.object({ number: num, role, name: z.string().min(1), index: z.number().int().min(0), total: z.number().int().min(1), data: z.string().max(4 * 1024 * 1024) }),
      _meta: appOnly,
    },
    async ({ number, role: r, name, index, total, data }) => {
      if (!(await courseExists(number))) return fail("No such course.");
      const key = `${number}/${r}/${name}`;
      let u = uploads.get(key);
      if (index === 0) {
        if (u) await rm(u.dir, { recursive: true, force: true });
        const dir = await mkdtemp(join(tmpdir(), "shalav-up-"));
        u = { dir, path: join(dir, basename(name)), next: 0 };
        uploads.set(key, u);
      }
      if (!u || u.next !== index) return fail("Upload chunk out of order; send the file again.");
      await mkdir(u.dir, { recursive: true });
      await appendFile(u.path, Buffer.from(data, "base64"));
      u.next++;
      if (index + 1 < total) return out("ok", { ok: true, done: false });
      uploads.delete(key);
      try {
        const [res] = await importFiles(number, r, [u.path], deps());
        return out(res?.status ?? "failed", { ok: true, done: true, status: res?.status ?? "failed", error: res && "error" in res ? res.error : undefined });
      } finally {
        await rm(u.dir, { recursive: true, force: true });
      }
    },
  );

  registerAppTool(server, "files_open_folder", { title: "Open course folder", description: "Card-only: reveal the course folder in Finder/Explorer.", inputSchema: z.object({ number: num, role }), _meta: appOnly }, async ({ number, role: r }) => {
    const p = coursePaths(root(), number);
    await (o.openFolder ?? openFolder)(r === "material" ? p.materials : p.exercises);
    return out("ok", { ok: true });
  });

  /** Index every pending/failed file against the current plan (part of "Build plan"); returns how many files are indexed after it. */
  async function indexPending(number: string, on: (k: number, n: number) => void = () => undefined) {
    const todo = (await listFileIndexes(number)).filter((r) => r.status === "pending" || r.status === "failed");
    const left = new Set(todo.map((r) => r.sha256));
    on(0, todo.length);
    const off = queue.subscribe((e) => {
      if (e.done === undefined && left.delete(e.sha256)) on(todo.length - left.size, todo.length);
    });
    try {
      for (const r of todo) await queue.retry(number, r.sha256);
      await queue.idle(number); // its own files only: another course's build may be indexing too
    } finally {
      off?.();
    }
    return (await listFileIndexes(number)).filter((r) => r.status === "indexed").length;
  }

  registerAppTool(server, "file_remove", { title: "Remove a file", description: "Card-only: move a course file to the trash and drop its index.", inputSchema: z.object({ number: num, sha: z.string() }), _meta: appOnly }, async ({ number, sha }) => {
    const r = (await listFileIndexes(number)).find((x) => x.sha256 === sha);
    if (!r) return fail("No such file.");
    await removeFile(number, r, deps());
    return out("ok", { ok: true });
  });

  return { indexPending };
}
