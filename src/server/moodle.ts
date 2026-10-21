import { chromium, type BrowserContext } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MoodleError } from "@/cards/types";
import { MEDIA, extOf } from "@/core/domain/ingest/import";
import { fileName, guessRole, parseCourse, parsePluginfiles, parseSearch, parseSections, searchTerm } from "./moodleParse";

/** The saved login is gone or expired: the student has to log in again in the browser window. */
export class LoginNeeded extends Error {
  constructor() {
    super("Moodle login needed.");
  }
}

/** A Moodle failure the card can name in the student's language. */
export class MoodleFail extends Error {
  constructor(
    readonly code: MoodleError,
    message: string,
  ) {
    super(message);
  }
}

export type Downloaded = { path: string; role: "material" | "exercises" };
export type Moodle = ReturnType<typeof createMoodle>;

const loggedIn = () => !document.body.classList.contains("notloggedin") && !!document.querySelector('a[href*="login/logout.php"], #user-menu-toggle');

/**
 * Drives the student's own Chrome with a persistent profile: they log in (SSO + MFA) in the window, Shalav only keeps the browser session.
 * `channel` undefined = Playwright's bundled Chromium (tests).
 */
export function createMoodle(o: { profileDir: string; channel?: string; headedLogin?: boolean; delayMs?: number }) {
  const open = (headless: boolean) =>
    chromium.launchPersistentContext(o.profileDir, { headless, channel: o.channel, ...(headless ? {} : { viewport: null }) }).catch((e: unknown) => {
      throw o.channel === "chrome" ? new MoodleFail("chrome", "Google Chrome is needed for Moodle import. Install it and try again.") : e;
    });

  /** Opens Moodle in the window and resolves with Moodle's real origin once a logged-in Moodle page shows in any tab (SSO may use a popup). */
  async function waitLogin(ctx: BrowserContext, baseUrl: string, timeoutMs: number): Promise<string> {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.goto(baseUrl);
    const origin = new URL(page.url()).origin; // the address may redirect (moodle.technion.ac.il → moodle26.technion.ac.il)
    for (const t0 = Date.now(); Date.now() - t0 < timeoutMs; ) {
      if (!ctx.pages().length) throw new MoodleFail("closed", "The login window was closed before the login finished.");
      for (const p of ctx.pages()) if (new URL(p.url()).origin === origin && (await p.evaluate(loggedIn).catch(() => false))) return origin;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new MoodleFail("timeout", "The login timed out.");
  }

  /**
   * Downloads the supported files of every Moodle course whose name has the course number (all its sections) into `dir`. Same host only, one request at a time.
   * `login`: open a window and wait for the student to log in, then download in that same browser (Moodle's session cookie dies with the browser).
   */
  async function sync(baseUrl: string, number: string, dir: string, login = false, onLoggedIn?: () => void, loginTimeoutMs = 5 * 60_000): Promise<{ course: string; files: Downloaded[]; skipped: number }> {
    const ctx = await open(!(login && (o.headedLogin ?? true)));
    try {
      let origin: string;
      if (login) {
        origin = await waitLogin(ctx, baseUrl, loginTimeoutMs);
        onLoggedIn?.();
      } else {
        // The SSO provider's cookies stay in the profile: opening /my/ signs in silently when they are still valid (no MFA), otherwise the student logs in again.
        const probe = await ctx.newPage();
        await probe.goto(new URL("/my/", baseUrl).href).catch(() => undefined);
        const signedIn = await probe.evaluate(loggedIn).catch(() => false);
        origin = new URL(probe.url()).origin;
        await probe.close();
        if (!signedIn) throw new LoginNeeded();
      }
      const wait = () => new Promise((r) => setTimeout(r, o.delayMs ?? 300));
      const html = async (url: string) => {
        const r = await ctx.request.get(url, { timeout: 60_000 });
        if (!r.ok()) throw new MoodleFail("http", `Moodle answered ${r.status()} for ${new URL(url).pathname}.`);
        return { text: await r.text(), url: r.url() };
      };
      const s = await html(new URL(`/course/search.php?search=${encodeURIComponent(searchTerm(number))}&perpage=all`, origin).href);
      // ponytail: first 5 matching courses (main, combined, groups); raise if courses have more groups.
      const hits = parseSearch(s.text, s.url, number).slice(0, 5);
      if (!hits.length) throw new MoodleFail("noCourse", `No Moodle course matches ${number}. Check that you are enrolled and that the number is in the course name.`);
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
      for (const hit of hits) {
        const page = await html(hit.url);
        const pages = [page];
        for (const u of parseSections(page.text, page.url)) {
          const sec = new URL(u).origin === origin && (await html(u).catch(() => null)); // one section per page; a broken section is skipped
          if (sec) pages.push(sec);
        }
        for (const p of pages) for (const l of parseCourse(p.text, p.url)) await grab(l.url, l, 0);
      }
      return { course: hits.map((h) => h.text).join(", "), files, skipped };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }
  return { sync };
}
