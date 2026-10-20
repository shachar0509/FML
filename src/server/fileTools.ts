import { appendFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { FilesData } from "@/cards/types";
import { claude } from "@/claude/runtime";
import { loadCourse, courseExists } from "@/domain/courses/courses";
import { importFiles, removeFile, scanCourse, type Deps } from "@/domain/ingest/import";
import { listFileIndexes } from "@/domain/ingest/indexStore";
import { openSource } from "@/domain/ingest/pageSource";
import { createIndexQueue } from "@/domain/ingest/queue";
import { refinePlan } from "@/domain/plan/refine";
import { coursePaths } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import type { BridgeGateway } from "./bridge";
import { native, openFolder } from "./native";
import { CARDS_URI } from "./resources";

const appOnly = { ui: { resourceUri: CARDS_URI, visibility: ["app" as const] } };
const num = z.string().regex(/^\d{8}$/);
const numIn = z.object({ number: num });
const role = z.enum(["material", "exercises"]);
const out = (text: string, structuredContent: object) => ({ content: [{ type: "text" as const, text }], structuredContent: structuredContent as Record<string, unknown> });
const fail = (text: string) => ({ ...out(text, { ok: false, error: text }), isError: true });

/** Files and indexing (plan v2 §6.6): chunked upload, open folder, scan, status, Start indexing, Improve plan. */
export function registerFileTools(server: McpServer, bridge: BridgeGateway, o: { openFolder?: (p: string) => Promise<void> } = {}) {
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
  });
  queue.subscribe((e) => (e.done === undefined ? prog.delete(e.sha256) : prog.set(e.sha256, { done: e.done, total: e.total ?? 0 })));
  // Indexing starts only on "Start indexing" (it spends the student's subscription), so import never enqueues.
  const deps = (): Deps => ({ native, open: openSource, enqueue: () => undefined, platform: process.platform === "win32" ? "windows" : "macos" });
  const improving = new Map<string, { state: "running" | "failed"; error: string | null }>();

  async function list(number: string): Promise<FilesData> {
    await scanCourse(number, deps());
    const recs = await listFileIndexes(number);
    const row = (r: (typeof recs)[number]) => ({ sha: r.sha256, name: r.fileName, pages: r.pageCount, status: r.status, error: r.error, exercises: r.exercises.length, ...prog.get(r.sha256) });
    const plan = (await loadCourse(number))?.plan;
    const { language, theme } = useSettings.getState().settings;
    return {
      view: "files", language, theme, number,
      materials: recs.filter((r) => r.role === "material").map(row),
      exercises: recs.filter((r) => r.role === "exercises").map(row),
      hasPlan: !!plan,
      canIndex: !!plan && recs.some((r) => r.status === "pending" || r.status === "failed"),
      canImprove: !!plan && recs.some((r) => r.role === "material" && r.status === "indexed"),
      improving: improving.get(number) ?? null,
    };
  }

  registerAppTool(server, "files_list", { title: "Course files", description: "Card-only: scan the course folder and list the files with their indexing status.", inputSchema: numIn, _meta: appOnly }, async ({ number }) => {
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

  registerAppTool(server, "files_start_indexing", { title: "Start indexing", description: "Card-only: index the pending files (an AI job; the model must then call shalav_next_job).", inputSchema: numIn, _meta: appOnly }, async ({ number }) => {
    if (!(await loadCourse(number))?.plan) return fail("This course has no study plan yet.");
    const todo = (await listFileIndexes(number)).filter((r) => r.status === "pending" || r.status === "failed");
    if (!todo.length) return out("Nothing to index.", { ok: true, count: 0 });
    bridge.run(`Indexing files of ${number}`, async () => {
      for (const r of todo) await queue.retry(number, r.sha256);
      await queue.idle();
      return todo.length;
    }, (n) => [{ type: "text", text: `Indexed ${n} file(s) of ${number}. Tell the student; the card shows the result.` }]).done.catch(() => undefined);
    return out(`Started indexing ${todo.length} file(s). Call shalav_next_job now.`, { ok: true, count: todo.length });
  });

  registerAppTool(server, "file_remove", { title: "Remove a file", description: "Card-only: move a course file to the trash and drop its index.", inputSchema: z.object({ number: num, sha: z.string() }), _meta: appOnly }, async ({ number, sha }) => {
    const r = (await listFileIndexes(number)).find((x) => x.sha256 === sha);
    if (!r) return fail("No such file.");
    await removeFile(number, r, deps());
    return out("ok", { ok: true });
  });

  registerAppTool(server, "plan_improve_request", { title: "Improve the plan", description: "Card-only: refine the study plan from the indexed materials (an AI job).", inputSchema: numIn, _meta: appOnly }, async ({ number }) => {
    const c = await loadCourse(number);
    if (!c?.plan) return fail("This course has no study plan yet.");
    if (improving.get(number)?.state === "running") return out("Already improving.", { ok: true });
    improving.set(number, { state: "running", error: null });
    bridge.run(`Improving the study plan for ${number}`, async () => {
      try {
        await refinePlan({ gw: claude(), course: c.course, lang: lang() });
        improving.delete(number);
      } catch (e) {
        improving.set(number, { state: "failed", error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    }, () => [{ type: "text", text: `The plan for ${number} was updated from the materials. Tell the student.` }]).done.catch(() => undefined);
    return out("Started improving the plan. Call shalav_next_job now.", { ok: true });
  });
}
