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
import { fileName, guessRole, parseCourse, parseSearch } from "./moodleParse";
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
  expect(parseSearch('<a href="/course/view.php?id=3">Other</a><a href="/course/view.php?id=7&amp;x=1">01040195 Calculus</a>', base, "01040195")[0]?.text).toBe("01040195 Calculus");
  const links = parseCourse('<li id="section-1" data-sectionname="Exercises"><a href="/mod/resource/view.php?id=9"><span>sheet 1</span> <span class="accesshide">File</span></a></li>', base);
  expect(links).toEqual([{ url: "https://m.example.ac.il/mod/resource/view.php?id=9", text: "sheet 1", section: "Exercises" }]);
  expect(guessRole("lecture1.pdf", "Week 1")).toBe("material");
  expect(guessRole("x.pdf", "מבחנים")).toBe("exercises");
  expect(fileName("https://x/pluginfile.php/1/Lecture%201.pdf", undefined)).toBe("Lecture 1.pdf");
});

// A tiny Moodle: login = a script that sets the session cookie (stands in for SSO + MFA), a search page, one course with a file, an exam, a landing page and a folder.
function fakeMoodle() {
  const logout = '<a href="/login/logout.php?sesskey=x">Log out</a>';
  return http((req, res) => {
    const cookies = req.headers.cookie ?? "";
    const idp = /(^|;\s*)idp=1/.test(cookies); // persistent SSO cookie; Moodle's own s=1 is a session cookie that dies with the browser
    const url = new URL(req.url ?? "/", "http://x");
    if (idp && !/(^|;\s*)s=1/.test(cookies) && (url.pathname === "/my/" || url.pathname === "/")) return void (res.setHeader("set-cookie", "s=1; Path=/"), res.setHeader("location", url.pathname), (res.statusCode = 302), res.end());
    const loggedIn = /(^|;\s*)s=1/.test(cookies);
    const html = (b: string) => (res.setHeader("content-type", "text/html"), res.end(`<html><body class="${loggedIn ? "loggedin" : "notloggedin"}">${b}</body></html>`));
    const file = (name: string, type = "text/plain") => (res.setHeader("content-type", type), res.end(`content of ${name}`));
    const p = url.pathname;
    if (p === "/" || p === "/my/") return loggedIn ? html(logout) : p === "/" ? html('<script>document.cookie="idp=1;path=/;max-age=86400";location.reload()</script>') : html("please log in");
    if (!loggedIn) return html("please log in");
    if (p === "/course/search.php") return html('<a href="/course/view.php?id=7">01040195 Calculus</a>');
    if (p === "/course/view.php")
      return html(`<li id="section-1" data-sectionname="Week 1"><a href="/mod/resource/view.php?id=1">Lecture</a><a href="/mod/resource/view.php?id=4">Landing</a></li>
        <li id="section-2" data-sectionname="Exams"><a href="/mod/resource/view.php?id=2">Exam A</a><a href="/mod/folder/view.php?id=3">Sheets</a></li>`);
    if (p === "/mod/resource/view.php") {
      const id = url.searchParams.get("id");
      if (id === "4") return html('<iframe src="/pluginfile.php/4/landing-notes.txt"></iframe>');
      res.statusCode = 302;
      return res.setHeader("location", id === "1" ? "/pluginfile.php/1/lecture1.txt" : "/pluginfile.php/2/exam-moed-a.txt"), res.end();
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
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([createServer(undefined, undefined, (profileDir) => createMoodle({ profileDir, headedLogin: false, delayMs: 0 })).connect(a), client.connect(b)]);
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
  expect(f.moodle).toMatchObject({ connected: true, last: { added: 4, duplicate: 0, skipped: 1, error: null } });
  expect(f.materials.map((x) => x.name).sort()).toEqual(["landing-notes.txt", "lecture1.txt"]);
  expect(f.exercises.map((x) => x.name).sort()).toEqual(["exam-moed-a.txt", "sheet1.txt"]);

  await call("moodle_import", { number: "01040195" }); // saved address, saved login
  f = await files();
  expect(f.moodle?.last).toMatchObject({ added: 0, duplicate: 4, error: null });

  expect(sc<{ state: { connected: boolean } }>(await call("moodle_disconnect")).state.connected).toBe(false);
  await call("moodle_import", { number: "01040195" }); // logs in again
  expect((await files()).moodle).toMatchObject({ connected: true, last: { error: null } });
  srv.close();
}, 120_000);
