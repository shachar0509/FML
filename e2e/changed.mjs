/* global process, console */
// Runs only the e2e specs that cover what changed (vs HEAD, or the ref given first): `pnpm e2e:changed [ref] [-- playwright args]`.
// Each rule maps changed paths to specs; a path no rule names but under src/cards, src/core or e2e runs everything,
// and anything else (server, docs) runs nothing. Add a rule when a new view or spec appears.
import { execSync, spawnSync } from "node:child_process";

const ALL = ["*"];
const RULES = [
  [/^e2e\/tests\/helpers\.ts$|^playwright\.config/, ALL],
  [/^e2e\/tests\/(\w[\w-]*)\.spec\.ts$/, (m) => [m[1]]],
  [/views\/Home\.tsx$/, ["home"]],
  [/views\/(AddCourse|Course|Files|Checklist|useBuild)\.tsx?$/, ["course"]],
  [/views\/(Lesson|Question)\.tsx$/, ["lesson"]],
  [/views\/AnswerFiles\.tsx$/, ["lesson", "exercise"]],
  [/views\/(Exercise|GradeCard)\.tsx$/, ["exercise"]],
  [/views\/Waiting\.tsx$/, ["exercise", "course"]],
  [/views\/(Step|FigureCard)\.tsx$/, ["step"]],
  [/views\/Practice\.tsx$/, ["practice"]],
  [/views\/Settings\.tsx$/, ["settings"]],
  [/^src\/cards\/test-advanced\.ts$/, ["render"]],
  [/^src\/core\/render\//, ["render", "step", "lesson", "practice"]],
  [/\.test\.tsx?$/, []], // unit tests
  [/^src\/(cards|core)\/|^src\/index\.css$|^e2e\/tests\//, ALL], // shared card code (Cards, useShalav, ui, i18n, css, test host)
];

const args = process.argv.slice(2);
const ref = args[0] && args[0] !== "--" ? args.shift() : "HEAD";
const rest = args[0] === "--" ? args.slice(1) : args;
const sh = (c) => execSync(c, { encoding: "utf8" }).split("\n").filter(Boolean);
// a range (a..b) is just those commits; otherwise the working tree vs ref, new files included
const changed = [...sh(`git diff --name-only ${ref}`), ...(ref.includes("..") ? [] : sh("git ls-files --others --exclude-standard"))];

const specs = new Set();
for (const f of changed)
  for (const [re, to] of RULES) {
    const m = f.match(re);
    if (!m) continue;
    for (const s of typeof to === "function" ? to(m) : to) specs.add(s);
    break;
  }

if (specs.size === 0) {
  console.log(`e2e: nothing to run for ${changed.length} changed file(s)`);
  process.exit(0);
}
const files = specs.has("*") ? [] : [...specs].map((s) => `e2e/tests/${s}.spec.ts`);
console.log(`e2e: ${files.length ? files.join(" ") : "all specs"}`);
process.exit(spawnSync("pnpm", ["exec", "playwright", "test", ...files, ...rest], { stdio: "inherit" }).status ?? 1);
