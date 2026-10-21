import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MEDIA, extOf } from "@/core/domain/ingest/import";
import { fileName, guessRole, parseCourse, parsePluginfiles, parseSearch } from "./moodleParse";

/** The saved login is gone or expired: the student has to log in again in the browser window. */
export class LoginNeeded extends Error {
  constructor() {
    super("Moodle login needed.");
  }
}

export type Downloaded = { path: string; role: "material" | "exercises" };
export type Moodle = ReturnType<typeof createMoodle>;

/**
 * Drives the student's own Chrome with a persistent profile: they log in (SSO + MFA) in the window, Shalav only keeps the browser session.
 * `channel` undefined = Playwright's bundled Chromium (tests).
 */
export function createMoodle(o: { profileDir: string; channel?: string; headedLogin?: boolean; delayMs?: number }) {
  const open = (headless: boolean) =>
    chromium.launchPersistentContext(o.profileDir, { headless, channel: o.channel, ...(headless ? {} : { viewport: null }) }).catch((e: unknown) => {
      throw new Error(o.channel === "chrome" ? "Google Chrome is needed for Moodle import. Install it and try again." : String(e));
    });

  /** Opens the login page and resolves once a logged-in Moodle page shows. */
  async function connect(baseUrl: string, timeoutMs = 5 * 60_000): Promise<void> {
    const ctx = await open(!(o.headedLogin ?? true));
    try {
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(baseUrl);
      const origin = new URL(baseUrl).origin;
      for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; ) {
        if (page.isClosed()) throw new Error("The login window was closed before the login finished.");
        const ok = await page.evaluate(() => !document.body.classList.contains("notloggedin") && !!document.querySelector('a[href*="login/logout.php"]')).catch(() => false);
        if (ok && new URL(page.url()).origin === origin) return;
        await page.waitForTimeout(1000).catch(() => undefined);
      }
      throw new Error("The login timed out.");
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }

  /** Downloads the supported files of the course into `dir`. Same host only, one request at a time. */
  async function sync(baseUrl: string, number: string, dir: string): Promise<{ course: string; files: Downloaded[]; skipped: number }> {
    const ctx = await open(true);
    try {
      const origin = new URL(baseUrl).origin;
      const wait = () => new Promise((r) => setTimeout(r, o.delayMs ?? 300));
      const html = async (url: string) => {
        const r = await ctx.request.get(url, { timeout: 60_000 });
        if (!r.ok()) throw new Error(`Moodle answered ${r.status()} for ${new URL(url).pathname}.`);
        return { text: await r.text(), url: r.url() };
      };
      // Moodle's own session cookie dies with the browser, but the SSO provider's cookies stay in the profile: opening /my/ in a page signs in silently when they are still valid (no MFA), otherwise the student logs in again.
      const probe = await ctx.newPage();
      await probe.goto(new URL("/my/", baseUrl).href).catch(() => undefined);
      const signedIn = await probe.evaluate(() => !!document.querySelector('a[href*="login/logout.php"]')).catch(() => false);
      await probe.close();
      if (!signedIn) throw new LoginNeeded();
      const s = await html(new URL(`/course/search.php?search=${encodeURIComponent(number)}`, baseUrl).href);
      const hit = parseSearch(s.text, s.url, number)[0];
      if (!hit) throw new Error(`No Moodle course matches ${number}. Check that you are enrolled and that the number is in the course name.`);
      const page = await html(hit.url);
      const files: Downloaded[] = [];
      const seen = new Set<string>();
      let skipped = 0;
      const grab = async (url: string, hint: { text: string; section: string }, depth: number): Promise<void> => {
        if (new URL(url).origin !== origin || seen.has(url)) return;
        seen.add(url);
        await wait();
        const r = await ctx.request.get(url, { timeout: 120_000 });
        if (!r.ok()) return void skipped++;
        if ((r.headers()["content-type"] ?? "").includes("text/html")) {
          if (depth < 2) for (const u of parsePluginfiles(await r.text(), r.url())) await grab(u, hint, depth + 1);
          return;
        }
        const name = fileName(r.url(), r.headers()["content-disposition"]);
        if (!(extOf(name) in MEDIA)) return void skipped++;
        const path = join(dir, String(files.length), name); // own folder per file keeps the real name for import
        await mkdir(join(dir, String(files.length)), { recursive: true });
        await writeFile(path, await r.body());
        files.push({ path, role: guessRole(name, `${hint.text} ${hint.section}`) });
      };
      for (const l of parseCourse(page.text, page.url)) await grab(l.url, l, 0);
      return { course: hit.text, files, skipped };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }
  return { connect, sync };
}
