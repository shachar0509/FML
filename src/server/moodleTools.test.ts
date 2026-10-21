// @vitest-environment node
import { createServer as http } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { expect, it } from "vitest";
import type { FilesData } from "@/cards/types";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import { setClaude } from "@/core/claude/runtime";
import { createCourse } from "@/core/domain/courses/courses";
import { briefRole, courseNumbers, fileName, guessRole, parseCourse, parsePluginfiles, parseSearch, parseSections, searchTerm } from "./moodleParse";
import { createMoodle } from "./moodle";
import { initNode } from "./platform";
import { createServer } from "./server";

const unit = (n: number) => ({ title: "u", summary: "s", stages: Array.from({ length: n }, () => ({ title: "t", kind: "concept", summary: "s", prerequisites: [] })) });
const details = (req: { messages: { content: unknown }[] }) =>
  toolCall("submit_unit_details", {
    stages: (/stage ids ([S\d, ]+)\./.exec(String(req.messages[0]?.content))?.[1]?.split(", ") ?? []).map((id) => ({ id, objectives: ["a", "b"], newConcepts: [], theorems: [], techniques: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30 })),
  });
const sc = <T,>(r: { structuredContent?: unknown }) => r.structuredContent as T;

it("parses Moodle pages and guesses roles", () => {
  const base = "https://m.example.ac.il/course/view.php?id=7";
  const tile = (id: number, name: string, cls = "coursevisible") => `<div class="tilecontainer" onclick="window.location.href='https://m.example.ac.il/course/view.php?id=${id}';"><div class="${cls}"><h3>${name}</h3><a href="https://m.example.ac.il/course/view.php?id=${id}" class="coursestyle2btn">צפה בקורס</a><ul><li>מורה: x</li></ul></div></div>`;
  const page = `<a href="/course/view.php?id=3">Other</a>${tile(10, "מבוא - קב' 082 - חורף - 02340117")}${tile(11, "מבוא - חורף - 02340117", "dimmed")}${tile(12, "מבוא מ'/ח' - חורף - 02340114/7")}${tile(13, "מבוא - חורף - 02340114")}<a href="/course/view.php?id=7&amp;x=1">104117 old</a>`;
  expect(parseSearch(page, base, "02340117").map((h) => h.url.split("=")[1])).toEqual(["12", "10", "11"]);
  expect(parseSearch(page, base, "01040117").map((h) => h.text)).toEqual(["104117 old"]);
  expect(courseNumbers("x - 02340114/7, 01040195/01040196 and 104195")).toEqual(["02340114", "02340117", "01040195", "01040196", "01040195"]);
  expect(searchTerm("02340117")).toBe("0234011");
  expect(parseSections('<a href="/course/section.php?id=5">s</a><a href="/course/view.php?id=7&amp;section=2#x">s2</a><a href="/course/view.php?id=3&section=1">other</a>', base)).toEqual(["https://m.example.ac.il/course/section.php?id=5", "https://m.example.ac.il/course/view.php?id=7&section=2"]);
  const links = parseCourse('<li id="section-1" data-sectionname="Exercises"><a href="/mod/resource/view.php?id=9"><span>sheet 1</span> <span class="accesshide">File</span></a></li>', base);
  expect(links).toEqual([{ url: "https://m.example.ac.il/mod/resource/view.php?id=9", text: "sheet 1", section: "Exercises" }]);
  // Real Technion page: the site menu's "login instructions" page sits before the sections, a reservists' request form inside one.
  expect(parseCourse('<nav><a href="/mod/page/view.php?id=474">הנחיות התחברות למערכת</a></nav><li id="section-1" data-sectionname="שיעורי בית"><a href="/mod/assign/view.php?id=2">בקשה להפחתת גיליונות (עבור משרתי מילואים) מטלה</a><a href="/mod/assign/view.php?id=3">גיליון 1 מטלה</a></li>', base).map((l) => l.text)).toEqual(["גיליון 1"]);
  expect(parsePluginfiles('<img src="/pluginfile.php/1/theme_boost_union/logocompact/logo.png"><img class="img-fluid" src="/pluginfile.php/4/mod_page/content/1/screen.jpg"><a href="/pluginfile.php/4/mod_folder/content/0/a.pdf">a</a><iframe src="/pluginfile.php/5/mod_resource/content/1/b.pdf"></iframe>', base)).toEqual(["https://m.example.ac.il/pluginfile.php/4/mod_folder/content/0/a.pdf", "https://m.example.ac.il/pluginfile.php/5/mod_resource/content/1/b.pdf"]);
  expect(guessRole("lecture1.pdf", "Week 1")).toBe("material");
  expect(guessRole("x.pdf", "מבחנים")).toBe("exercises");
  // Brief check: the opening text outweighs a misleading section name; no text → the label decides.
  expect(briefRole("הרצאה 3: הגדרה. משפט. מסקנה. הערה. תזכורת: פרק 2", "notes.pdf חומר עזר להרצאות ותרגולים")).toBe("material");
  expect(briefRole("שאלה 1 סעיף א: חשבו את המהירות. שאלה 2: מצאו", "week3.pdf שבוע 3")).toBe("exercises");
  expect(briefRole("", "scan.pdf תרגולים ישנים")).toBe("exercises");
  // Not study material: a video list (by label, or many links over little text) and course rules.
  expect(briefRole("נושאים", "list.pdf סרטוני עזר")).toBeNull();
  expect(briefRole("פיסיקה 1מ שם וקישור נושאים מרכזיים ".repeat(40), "list.pdf חומר עזר", 41)).toBeNull();
  expect(briefRole("סילבוס הקורס. הרכב הציון: ציון סופי 80% מבחן. נוכחות חובה. שעות קבלה", "info.pdf מבוא")).toBeNull();
  expect(parseCourse('<li id="section-1" data-sectionname="עזר"><a href="/mod/resource/view.php?id=1">סרטוני עזר</a></li>', base)).toEqual([]);
  expect(fileName("https://x/pluginfile.php/1/Lecture%201.pdf", undefined)).toBe("Lecture 1.pdf");
  expect(fileName("https://x/a.pdf", `inline; filename="${Buffer.from("תרגיל 3.pdf").toString("latin1")}"`)).toBe("תרגיל 3.pdf");
  expect(fileName("https://x/a.pdf", `attachment; filename="x.pdf"; filename*=UTF-8''%D7%AA.pdf`)).toBe("ת.pdf");
});

// A tiny Moodle (served on localhost, reached through a redirect from 127.0.0.1): login = a script that sets the session cookie (stands in for SSO + MFA), a search page, one course with a file, an exam, a landing page and a folder.
function fakeMoodle() {
  const logout = '<a href="/login/logout.php?sesskey=x">Log out</a>';
  return http((req, res) => {
    const cookies = req.headers.cookie ?? "";
    const idp = /(^|;\s*)idp=1/.test(cookies); // persistent SSO cookie; Moodle's own s=1 is a session cookie that dies with the browser
    const url = new URL(req.url ?? "/", "http://x");
    // Like moodle.technion.ac.il → moodle26.technion.ac.il: the given address redirects to another host.
    if (req.headers.host?.startsWith("127.0.0.1")) return void (res.setHeader("location", `http://localhost:${req.headers.host.split(":")[1]}${req.url}`), (res.statusCode = 302), res.end());
    if (idp && !/(^|;\s*)s=1/.test(cookies) && (url.pathname === "/my/" || url.pathname === "/")) return void (res.setHeader("set-cookie", "s=1; Path=/"), res.setHeader("location", url.pathname), (res.statusCode = 302), res.end());
    const loggedIn = /(^|;\s*)s=1/.test(cookies);
    const html = (b: string) => (res.setHeader("content-type", "text/html"), res.end(`<html><body class="${loggedIn ? "loggedin" : "notloggedin"}">${b}</body></html>`));
    const file = (name: string, type = "text/plain") => (res.setHeader("content-type", type), res.end(`content of ${name}`));
    const p = url.pathname;
    if (p === "/" || p === "/my/") return loggedIn ? html(logout) : p === "/" ? html('<script>document.cookie="idp=1;path=/;max-age=86400";location.reload()</script>') : html("please log in");
    if (!loggedIn) return html("please log in");
    // A site link and another course are ignored; a Technion-style tile (name in <h3>, link text "צפה בקורס") of a combined course matches too.
    const tile = (id: number, name: string) => `<div class="tilecontainer" onclick="window.location.href='/course/view.php?id=${id}';"><figcaption><h3>${name}</h3><a href="/course/view.php?id=${id}">צפה בקורס</a></figcaption></div>`;
    if (p === "/course/search.php") return html(url.searchParams.get("search") === "0104019" ? `<a href="/course/view.php?id=1">Home</a>${tile(9, "Other - 01040196")}<a href="/course/view.php?id=7">01040195 Calculus</a>${tile(8, "Calculus M/H - 01040194/5")}` : "no courses");
    if (p === "/course/view.php" && url.searchParams.get("id") === "8") return html('<li id="section-1"><a href="/course/section.php?id=81">Exams 2024</a></li>');
    if (p === "/course/section.php") return html('<li id="section-1" data-sectionname="Exams 2024"><a href="/mod/resource/view.php?id=5">Moed A</a></li>');
    if (p === "/course/view.php" && url.searchParams.get("id") !== "7") return html('<a href="/pluginfile.php/9/not-this-course.txt">x</a>');
    if (p === "/course/view.php")
      return html(`<li id="section-1" data-sectionname="Week 1"><a href="/mod/resource/view.php?id=1">Lecture</a><a href="/mod/resource/view.php?id=4">Landing</a></li>
        <li id="section-2" data-sectionname="Exams"><a href="/mod/resource/view.php?id=2">Exam A</a><a href="/mod/folder/view.php?id=3">Sheets</a></li>`);
    if (p === "/mod/resource/view.php") {
      const id = url.searchParams.get("id");
      if (id === "4") return html('<iframe src="/pluginfile.php/4/landing-notes.txt"></iframe>');
      res.statusCode = 302;
      return res.setHeader("location", id === "1" ? "/pluginfile.php/1/lecture1.txt" : id === "5" ? "/pluginfile.php/5/exam-2024.txt" : "/pluginfile.php/2/exam-moed-a.txt"), res.end();
    }
    if (p === "/mod/folder/view.php") return html('<a href="/pluginfile.php/3/sheet1.txt">s</a><a href="/pluginfile.php/3/archive.zip">z</a>');
    if (p.startsWith("/pluginfile.php")) return file(p.split("/").pop() as string, p.endsWith(".zip") ? "application/zip" : "text/plain");
    res.statusCode = 404;
    res.end("no");
  });
}

it("moodle_import logs in once, downloads by role, is repeatable, and can forget the login", async () => {
  const srv = fakeMoodle();
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as { port: number }).port}/`;
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  await writeFile(join(d, "cards.html"), "<html></html>");
  process.env.SHALAV_CARDS_HTML = join(d, "cards.html");
  await initNode();
  setClaude(new FakeClaudeGateway([toolCall("submit_plan_outline", { courseKind: "mixed", units: [unit(18), unit(18)] }), details, details]));
  await createCourse({ courseNumber: "01040195", nameHe: "קורס", credits: 2, faculty: "f", syllabusHe: "s", prerequisitesRaw: "" }, () => {});
  const ticks: [number, number][] = [];
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer(undefined, undefined, (profileDir) => {
    const m = createMoodle({ profileDir, headedLogin: false, delayMs: 0 });
    // record the download progress the card shows
    return { ...m, sync: (...x: Parameters<typeof m.sync>) => m.sync(x[0], x[1], x[2], x[3], x[4], x[5], (done, total) => (ticks.push([done, total]), x[6]?.(done, total))) };
  }).connect(a), client.connect(b)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  const files = async () => {
    for (let i = 0; i < 120; i++) {
      const f = sc<FilesData>(await call("files_list", { number: "01040195" }));
      if (f.moodle && !f.moodle.busy) return f;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("import did not finish");
  };

  expect((await call("moodle_import", { number: "01040195", url: "ftp://x" })).isError).toBe(true);
  expect((await call("moodle_import", { number: "01040195" })).structuredContent).toMatchObject({ needUrl: true }); // technion default exists only as https, tests have no university chosen
  await call("moodle_import", { number: "01040195", url: base });
  let f = await files();
  expect(f.moodle).toMatchObject({ connected: true, progress: null, last: { added: 5, duplicate: 0, skipped: 1, error: null } });
  expect(ticks[0]?.[0]).toBe(0);
  expect(ticks.at(-1)?.[0]).toBe(ticks.at(-1)?.[1]); // ends at 100%
  expect(ticks.every(([d, t]) => d <= t)).toBe(true);
  expect(f.materials.map((x) => x.name).sort()).toEqual(["landing-notes.txt", "lecture1.txt"]);
  expect(f.exercises.map((x) => x.name).sort()).toEqual(["exam-2024.txt", "exam-moed-a.txt", "sheet1.txt"]);

  await call("moodle_import", { number: "01040195" }); // saved address, saved login
  f = await files();
  expect(f.moodle?.last).toMatchObject({ added: 0, duplicate: 5, error: null });

  expect(sc<{ state: { connected: boolean } }>(await call("moodle_disconnect")).state.connected).toBe(false);
  await call("moodle_import", { number: "01040195" }); // logs in again
  expect((await files()).moodle).toMatchObject({ connected: true, last: { error: null } });
  srv.close();
}, 120_000);
