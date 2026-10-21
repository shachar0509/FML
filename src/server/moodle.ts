import { chromium, type BrowserContext } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MoodleError } from "@/cards/types";
import { MEDIA, extOf } from "@/core/domain/ingest/import";
import { openPdf, pageText } from "@/core/lib/pdf";
import { briefRole, fileName, parseCourse, parsePluginfiles, parseSearch, parseSections, searchTerm } from "./moodleParse";

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

// Only a real login has a logout link: guest access (Technion gives it once the session expires) has the user menu but sees no enrolled course.
const PARALLEL = 4;

/** The text and web-link count of a downloaded file's first two pages, for the brief check of what it is (no text for pictures, scans and unreadable PDFs). */
async function opening(name: string, body: Buffer): Promise<{ text: string; links: number }> {
  const ext = extOf(name);
  if (ext === "txt" || ext === "md") {
    const text = body.subarray(0, 8000).toString("utf8");
    return { text, links: text.match(/https?:\/\//g)?.length ?? 0 };
  }
  if (ext !== "pdf") return { text: "", links: 0 };
  try {
    const doc = await openPdf(new Uint8Array(body));
    try {
      const pages = await Promise.all(
        Array.from({ length: Math.min(2, doc.numPages) }, async (_, i) => {
          const p = await doc.getPage(i + 1);
          return { text: await pageText(p), links: (await p.getAnnotations()).filter((a: { url?: string }) => a.url).length };
        }),
      );
      return { text: pages.map((p) => p.text).join(" "), links: pages.reduce((n, p) => n + p.links, 0) };
    } finally {
      void doc.loadingTask.destroy();
    }
  } catch {
    return { text: "", links: 0 };
  }
}

const loggedIn = () => !document.body.classList.contains("notloggedin") && !!document.querySelector('a[href*="login/logout.php"]');

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
   * Downloads the supported files of every Moodle course whose name has the course number (all its sections) into `dir`. Same host only, PARALLEL requests at a time; each file's folder is chosen by a brief look at its first pages (briefRole).
   * `login`: open a window and wait for the student to log in, then download in that same browser (Moodle's session cookie dies with the browser).
   */
  async function sync(baseUrl: string, number: string, dir: string, login = false, onLoggedIn?: () => void, loginTimeoutMs = 5 * 60_000, onProgress?: (done: number, total: number) => void): Promise<{ course: string; files: Downloaded[]; skipped: number }> {
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
      // At most PARALLEL requests in flight (polite to Moodle); only the request holds a slot, so a folder can wait for its own files.
      let active = 0;
      const queue: (() => void)[] = [];
      const get = async (url: string, timeout: number) => {
        if (active < PARALLEL) active++;
        else await new Promise<void>((r) => queue.push(r));
        try {
          await new Promise((r) => setTimeout(r, o.delayMs ?? 300));
          const r = await ctx.request.get(url, { timeout });
          await r.body(); // read while holding the slot
          return r;
        } finally {
          const next = queue.shift();
          if (next) next();
          else active--;
        }
      };
      const html = async (url: string) => {
        const r = await get(url, 60_000);
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
      let slot = 0;
      // Progress counts links: a folder's files join the total when the folder page is read.
      let done = 0, total = 0;
      const grab = async (url: string, hint: { text: string; section: string }, depth: number): Promise<void> => {
        try {
          await grabOne(url, hint, depth);
        } finally {
          onProgress?.(++done, total);
        }
      };
      const grabOne = async (url: string, hint: { text: string; section: string }, depth: number): Promise<void> => {
        if (new URL(url).origin !== origin || seen.has(url)) return;
        seen.add(url);
        const r = await get(url, 120_000).catch(() => null);
        if (!r?.ok()) return void skipped++;
        if ((r.headers()["content-type"] ?? "").includes("text/html")) {
          if (depth < 2) {
            const inner = parsePluginfiles(await r.text(), r.url());
            total += inner.length;
            await Promise.all(inner.map((u) => grab(u, hint, depth + 1)));
          }
          return;
        }
        const name = fileName(r.url(), r.headers()["content-disposition"]);
        if (!(extOf(name) in MEDIA)) return void skipped++;
        const body = await r.body();
        const { text, links } = await opening(name, body);
        const role = briefRole(text, `${name} ${hint.text} ${hint.section}`, links);
        if (!role) return void skipped++; // not study material (video list, course admin)
        const sub = join(dir, String(slot++)); // own folder per file keeps the real name for import
        await mkdir(sub, { recursive: true });
        await writeFile(join(sub, name), body);
        files.push({ path: join(sub, name), role });
      };
      // Courses, their section pages and the files all go out together, PARALLEL requests at a time.
      const pages = (
        await Promise.all(
          hits.map(async (hit) => {
            const page = await html(hit.url);
            const secs = await Promise.all(parseSections(page.text, page.url).map((u) => (new URL(u).origin === origin ? html(u).catch(() => null) : null))); // a broken section is skipped
            return [page, ...secs.filter((s) => s !== null)];
          }),
        )
      ).flat();
      const links = pages.flatMap((p) => parseCourse(p.text, p.url));
      total = links.length;
      onProgress?.(0, total);
      await Promise.all(links.map((l) => grab(l.url, l, 0)));
      return { course: hits.map((h) => h.text).join(", "), files, skipped };
    } finally {
      await ctx.close().catch(() => undefined);
    }
  }
  return { sync };
}
