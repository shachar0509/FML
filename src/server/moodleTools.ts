import { existsSync } from "node:fs";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";
import type { MoodleState } from "@/cards/types";
import { courseExists } from "@/core/domain/courses/courses";
import { importFiles } from "@/core/domain/ingest/import";
import { nodeDirs } from "@/core/lib/platform";
import { COURSE_ID_RE, university } from "@/core/universities";
import { useSettings } from "@/stores/settings";
import { ensureChromium } from "./browser";
import { importDeps } from "./fileTools";
import { createMoodle, LoginNeeded, MoodleFail, type Moodle } from "./moodle";
import { CARDS_URI } from "./resources";

const both = { ui: { resourceUri: CARDS_URI, visibility: ["model" as const, "app" as const] } };
const out = (text: string, structuredContent: object) => ({ content: [{ type: "text" as const, text }], structuredContent: structuredContent as Record<string, unknown> });
const fail = (text: string) => ({ ...out(text, { ok: false, error: text }), isError: true as const });

/** Import from the university's Moodle (plan M14b): the student logs in once in a browser window; sync runs in the background and shows in files_list. */
export function registerMoodleTools(server: McpServer, make?: (profileDir: string) => Moodle) {
  const config = () => nodeDirs.config ?? "";
  // M39: Shalav's own Chromium. Its cookies are encrypted under another keychain item than Chrome's, so it gets its own profile and login marker (the student logs in once more).
  const profile = () => join(config(), "moodle-profile-chromium");
  const marker = () => join(config(), "moodle-login-chromium");
  const chromiumPath = async () => {
    await rm(join(config(), "moodle-profile"), { recursive: true, force: true }).catch(() => undefined); // the old Chrome profile and marker
    await rm(join(config(), "moodle-login"), { force: true }).catch(() => undefined);
    const was = busy;
    try {
      return await ensureChromium(join(config(), "browsers"), (pct) => {
        busy = "install";
        progress = { done: pct, total: 100 };
      });
    } finally {
      busy = was;
      progress = null;
    }
  };
  const moodle = () => (make ?? ((profileDir) => createMoodle({ profileDir, executablePath: chromiumPath })))(profile());
  let connected: boolean | null = null; // null = not read yet
  let busy: MoodleState["busy"] = null;
  let last: MoodleState["last"] = null;
  let progress: MoodleState["progress"] = null;

  const url = () => useSettings.getState().settings.moodleUrl || university()?.moodleUrl || null;
  const isConnected = () => (connected ??= existsSync(marker())); // the marker survives restarts; the browser profile keeps the cookies

  /** Cheap sync read for files_list. */
  function state(): MoodleState {
    return { url: url(), connected: isConnected(), busy, last, progress };
  }

  async function run(number: string, base: string) {
    const m = moodle();
    const dir = await mkdtemp(join(tmpdir(), "shalav-moodle-"));
    let relogin = !isConnected();
    try {
      for (;;) {
        busy = relogin ? "login" : "sync";
        try {
          const r = await m.sync(base, number, dir, relogin, () => {
            busy = "sync";
            connected = true;
            void writeFile(marker(), new Date().toISOString());
          }, undefined, (done, total) => (progress = { done, total }));
          let added = 0, duplicate = 0, skipped = r.skipped;
          for (const role of ["material", "exercises"] as const) {
            const paths = r.files.filter((f) => f.role === role).map((f) => f.path);
            if (!paths.length) continue;
            for (const o of await importFiles(number, role, paths, importDeps())) {
              if (o.status === "added") added++;
              else if (o.status === "duplicate") duplicate++;
              else skipped++;
            }
          }
          last = { course: r.course, added, duplicate, skipped, error: null };
          return;
        } catch (e) {
          if (!(e instanceof LoginNeeded) || relogin) throw e;
          connected = false;
          await unlink(marker()).catch(() => undefined);
          relogin = true; // session expired: log in once, then retry the sync
        }
      }
    } catch (e) {
      const code = e instanceof MoodleFail ? e.code : e instanceof LoginNeeded ? "login" : "failed";
      last = { course: "", added: 0, duplicate: 0, skipped: 0, error: e instanceof Error ? e.message : String(e), code };
    } finally {
      busy = null;
      progress = null;
      await rm(dir, { recursive: true, force: true });
    }
  }

  registerAppTool(
    server,
    "moodle_import",
    {
      title: "Import from Moodle",
      description: "Download the files (all sections) of the Moodle courses whose name has this course number, from the student's university Moodle, into the course (a browser window opens once so the student can log in, including two-step verification). Runs in the background; poll files_list. The student then presses Build/Update plan when ready (plan_build_request). `url` is the Moodle address when the university has no built-in one.",
      inputSchema: z.object({ number: z.string().regex(COURSE_ID_RE), url: z.string().max(300).optional() }),
      _meta: both,
    },
    async ({ number, url: given }) => {
      if (!(await courseExists(number))) return fail("No such course.");
      if (busy) return out("A Moodle import is already running.", { ok: true, started: false, state: state() });
      if (given) {
        let u: URL;
        try {
          u = new URL(given.trim());
        } catch {
          return fail("That is not a web address.");
        }
        if (u.protocol !== "https:" && u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return fail("The Moodle address must start with https://");
        useSettings.getState().update({ moodleUrl: u.href });
      }
      const base = url();
      if (!base) return out("Ask the student for their university's Moodle address (https://…) and call again with url.", { ok: false, needUrl: true, state: state() });
      busy = isConnected() ? "sync" : "login";
      last = null;
      const job = run(number, base);
      await Promise.race([job, new Promise((r) => setTimeout(r, 20_000))]);
      const s = state();
      const text = s.busy ? (s.busy === "login" ? "A browser window opened: the student must log in there. Poll files_list for progress." : "Importing in the background. Poll files_list for progress.") : s.last?.error ? `Import failed: ${s.last.error}` : `Imported ${s.last?.added ?? 0} new file(s) from "${s.last?.course}". The student presses Build/Update plan when ready.`;
      return out(text, { ok: !s.last?.error, started: true, state: s, next: "When busy is null, tell the student; they press Build/Update plan when ready." });
    },
  );

  registerAppTool(server, "moodle_disconnect", { title: "Forget the Moodle login", description: "Delete the saved Moodle browser session (the student will log in again next time).", _meta: both }, async () => {
    if (busy) return fail("A Moodle import is running.");
    await rm(profile(), { recursive: true, force: true });
    await unlink(marker()).catch(() => undefined);
    connected = false;
    return out("The saved Moodle login was deleted.", { ok: true, state: state() });
  });

  return state;
}
