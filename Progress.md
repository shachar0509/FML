# Progress

**CURRENT PHASE: v2 — MCP connector transition.** Governing doc: `Shalav — MCP Connector Transition Plan v2.md` (its §9 = step order M0–M13). v1 spec `Shalav — Product & Technical Specification v1.md` stays normative where v2 does not override it.
Rules: work only on branch `dev`; one commit per step with tests; update this file after every step; record silent-spec choices in `DECISIONS.md`; stop after each step so the user can compact. Steps marked 🧪 in the plan need a manual Claude Desktop check by the user; list what to check.
Environment: Node 22, pnpm, Rust (`~/.cargo/bin`, only needed for v1 until M12), Playwright chromium. Live API checks (`vitest.live.config.ts`) are v1-only and need API credit; never store keys in files.

## Phase 2 — MCP connector (plan v2 §9)
- [x] M0. Freeze v1 + dependencies — DONE (see M-log)
- [x] M1. Node platform layer — DONE (see M-log)
- [x] M2. MCP server skeleton — DONE (see M-log)
- [x] M3. Host Bridge (BridgeGateway, jobs) — DONE (see M-log)
- [x] M4. Cards pipeline (MCP Apps single-file UI) — DONE (see M-log; 🧪 check pending)
- [x] M5. Courses and plan — DONE (see M-log; 🧪 real plan build pending)
- [x] M6. Files and indexing — DONE (see M-log; real PDF in the bundle not yet checked)
- [x] M7. Learn — DONE (see M-log; 🧪 full lesson pending)
- [x] M8. Exercises and grading — DONE (see M-log; 🧪 check pending)
- [x] M9. Practice — DONE (see M-log; 🧪 check pending)
- [x] M10. Settings and context — DONE (see M-log)
- [x] M11. Packaging (MCPB) and docs — DONE (see M-log; 🧪 install check pending)
- [x] M12. Cleanup — DONE (see M-log)
- [x] M13. Hardening + acceptance checklist v2 — DONE (see M-log; 🧪 checklist pending, see ACCEPTANCE.md)

### Handoff notes (start here)
- v1 is complete through Step 13, plus partial Step 14 (see the log below). Step 14 is **superseded** by M13; do not continue it.
- User-reported v1 issues already understood: (1) dot-folder fs scope (fixed in 01640cb); (2) the add-course preview shows the raw catalog syllabus, which starts with admission requirements ("קדם: …"), and looked like the plan. The fix is in plan v2 §6.2 (label + note), done in M5; (3) API keys with no credit pass `models.list` but fail every request; irrelevant in v2 (no API key).
- The real plan output for 01040195 has never been seen (no API credit). The first real check is the M5 🧪 step in Claude Desktop.
- `live/` + `vitest.live.config.ts` = v1 real-API harness (catalog lookup verified live: 01040195 → "חשבון אינפיניטסימלי 1", 5.5 credits). Delete in M12.

### M-log

### M0 — Freeze v1 + dependencies (done)
- Tag `desktop-v1-final` (= `01640cb`) exists. Added exact-pinned deps (versions + reasons in `DECISIONS.md`): `@modelcontextprotocol/server`, `core`, `ext-apps`, `@napi-rs/canvas`; dev: `@modelcontextprotocol/client`, `vite-plugin-singlefile`, `esbuild`. Nothing deleted.
- The MCP SDK is now the v2 split packages (not `@modelcontextprotocol/sdk` 1.x); plan doc updated. Imports for M2: `McpServer` and `InMemoryTransport` from `@modelcontextprotocol/server` (client side from `@modelcontextprotocol/client`), stdio at `@modelcontextprotocol/server/stdio`, app helpers `registerAppTool`/`registerAppResource`/`RESOURCE_MIME_TYPE` from `@modelcontextprotocol/ext-apps/server`. Verify exact export names against `node_modules/*/dist/index.d.mts` before writing code.
- `pnpm-workspace.yaml` added (pnpm 11 `allowBuilds: esbuild: true`). Verified: `@napi-rs/canvas` loads and encodes JPEG in Node 22; esbuild CLI + JS API work.
- typecheck/lint clean; 154 tests pass (1 live skipped).
- Next: M1 — Node platform layer.

### M1 — Node platform layer (done)
- `src/server/`: `nodeFs.ts` (`nodeFs()` = `Fs` port), `native.ts` (ports of the Rust commands: `sha256`, `importCopy` with `name  (2).ext` — two spaces, as in Rust/spec 5.2, `heicToJpeg` via sips, `trash`, `openFolder`; exported as `native: Native`), `canvas.ts` (`enableNodeCanvas()` routes `lib/images` + `lib/pdf` through `@napi-rs/canvas`), `platform.ts` (`initNode()`: setFs, canvas, dirs, settings load, device.json, data root; `nodeCatalog()` with global `fetch`). Env overrides: `SHALAV_CONFIG_DIR`, `SHALAV_CACHE_DIR`, `SHALAV_DOCUMENTS_DIR`.
- Seams added to shared code (browser/Tauri behaviour unchanged): `lib/platform.ts` (`nodeDirs`), `lib/images.ts` (`setNodeCanvas`, `newCanvas`, `decodeImage`), `lib/pdf.ts` (uses `pdfjs-dist/legacy` when there is no `document`), `lib/storage.ts` (JSON files under `nodeDirs.config`), `ingest/pageSource.ts` (page cache under `nodeDirs.cache`).
- Tests: `src/server/node.test.ts` (node env): nodeFs temp dir, sha vector, importCopy collisions, settings storage, `initNode`, a real PDF → text + JPEG in Node. Existing domain tests unchanged. 160 pass; typecheck/lint clean.
- Caveats: `trash` on macOS moves into `~/.Trash` (no Finder "Put Back"; Windows uses Recycle Bin via PowerShell, untested); `openFolder`/HEIC/Windows paths untested here. Server bundling (esbuild, `@napi-rs/canvas` external, pdfjs legacy worker resolution) is checked in M2/M11.
- Next: M2 — MCP server skeleton.

### M2 — MCP server skeleton (done)
- `src/server/server.ts` `createServer()` (instructions from `instructions.ts`, tool `shalav_home` text + `structuredContent.courses`, prompts "Shalav: my courses" / "Shalav: continue learning"), `main.ts` (initNode + stdio). `scripts/build-server.mjs` → `dist/server.mjs` (ESM, esbuild, external `@napi-rs/canvas`, require shim banner); `pnpm build:server`, `pnpm mcp:dev` (Inspector).
- Tests: `server.test.ts` via in-memory transport + `@modelcontextprotocol/client`. Bundle smoke-tested by hand over stdio (initialize + tool call OK). The bundle is `.mjs`, not `.js`, so ESM works without a package.json in the MCPB.
- Not yet checked: the bundle rendering a PDF (pdfjs legacy worker + canvas external) — check in M6/M11.
- Next: M3 — Host Bridge.

### M3 — Host Bridge (done)
- `src/server/bridge.ts` `BridgeGateway implements ClaudeGateway`: `send()` parks a job; `run(label, fn, summary?)` wraps a domain operation (AsyncLocalStorage ties each `send()` to its op; returns `{opId, done}`), `cancel(opId)` aborts all its jobs (`ClaudeError("aborted")`), `next()` = shalav_next_job, `submit()` = shalav_submit_job. After a submit it waits (45 s max) for: op's next job ("Next job is ready" + job), op result (`summary(result)` content, default "Done."), op error (`isError`), or lists other still-open jobs of the op. Correction rounds set `parentJobId` and show only the new message. Dedupe: "Same instructions as job #N" / same first message. Images → MCP image content. Server tools dropped; tool answer if toolChoice names a tool or exactly one tool, else text.
- `server.ts`: `createServer(bridge = new BridgeGateway())` registers `shalav_next_job`, `shalav_submit_job` (zod input `{jobId, input?, text?}`).
- Tests: `bridge.test.ts` (correction round via `callStructured`, parallel jobs + dedupe, cancel, request-signal abort, text job, op error, image job) + MCP-level check in `server.test.ts`.
- Not done (deliberate): persisting `jobs.json` for display (no consumer; add with the M4+ cards if wanted); sampling fast path (§5.3, optional); the singleton bridge is created per `createServer()` — domain code in M5+ must receive it via `setClaude(bridge)` (`claude/runtime.ts`) or equivalent.
- Next: M4 — Cards pipeline (🧪 Claude Desktop check).

### M4 — Cards pipeline (done; 🧪 pending)
- `src/cards/`: `host.ts` (the only MCP Apps bridge code: `App` + `PostMessageTransport`, `connectHost()`), `types.ts` (`Host`, `HomeData`/`CardData`, `view` picks the view), `useShalav.ts`, `Cards.tsx` (language/theme/RTL, view switch), `views/Home.tsx`, `main.tsx` + `cards.html`. `pnpm build:cards` (`vite.cards.config.ts`, singlefile) → `dist/cards.html`; `mcp:dev` builds cards first.
- Server: `resources.ts` (`readCards`), `shalav_home` is now `registerAppTool` with `_meta.ui.resourceUri = ui://shalav/cards.html` and `structuredContent` `HomeData` (courses with pct/current stage, language, theme); text fallback unchanged. Buttons (Add course / Continue) send a chat line via `say()`; real actions arrive with M5+.
- Tests: `server.test.ts` (resource list/read with the MCP App mime type, tool `_meta`, structuredContent); `e2e/cards.spec.ts` (fake-host page, he/en × light/dark: dir, theme class, axe A/AA, screenshot, button → message, empty state). Screenshots inspected (RTL + dark fine). typecheck/lint/test green.
- 🧪 **User check in Claude Desktop** (after M11 packaging, or now with `pnpm mcp:dev`-style manual config): the "Shalav: my courses" prompt shows the Home card; Hebrew RTL; theme follows Claude's light/dark; "Add course" puts a line in the chat. Not verified: a real host (iframe sandbox/CSP with the inlined fonts, resize), `app.sendMessage` behaviour.
- Next: M5 — Courses and plan (🧪 real plan build). Domain code needs the bridge: `setClaude(bridge)` and `bridge.run(...)` for course creation.

### M5 — Courses and plan (done; 🧪 pending)
- Server `src/server/courseTools.ts` (`registerCourseTools`, called from `createServer(bridge, catalog?)`): app-only tools `course_lookup` (catalog via `nodeCatalog()`: invalid/exists/found/notfound/offline), `course_create_request` (catalog entry or `manual`; starts `createCourse` as a `bridge.run` op and returns at once), `plan_retry_request` (`buildPlan`), `course_status` (state + step + unit k/n + pending job count; polled by the card), and model+app `shalav_course` (`CourseData`: header, progress, units/stages with status+mastery, Watch out for, build state). `setClaude(bridge)` added to `claude/runtime.ts`; domain code (`createCourse`/`buildPlan`/`generatePlan`) is unchanged. In-memory `builds` map tracks running/failed builds (lost on server restart; a course without plan.json then shows Try again).
- Bridge: new `nextWait()` used by `shalav_next_job` waits up to 20 s for a running op's first request (race: the model could call it before the op parked its first job).
- Cards: `Cards.tsx` has card-side navigation over the model's last result (`go(tool,args)`; a new model result replaces it). New views `AddCourse` (input → lookup → preview with "תיאור הקורס מהקטלוג/Catalog description" label and the "builds a detailed plan (a few minutes)" note → manual form when not found/offline → build checklist with polling `useBuild`), `Course` (plan accordion, status icons, stage summary on click, Watch out for, Learn button = chat line, Practice disabled until M9, Try again), `Checklist`. Home: Add course opens the form; Continue opens the course (no chat line).
- Tests: `courseTools.test.ts` (MCP in-memory: visibility app-only, lookup states, create → fake host answers outline + unit-detail jobs → plan.json validates with 70 stages, status done, `shalav_course` data, exists/errors); `bridge.test.ts` nextWait; e2e `cards.spec.ts` now 11 (home, add flow with the catalog-label fix, course card he/en × light/dark, axe, screenshots inspected). typecheck/lint green; 168 unit tests.
- 🧪 **User check in Claude Desktop** (after M11 packaging): from "Shalav: my courses" press Add course, enter 01040195, Search → preview must say "תיאור הקורס מהקטלוג" + the plan note; Add → a chat line asks Claude to build the plan; Claude should call shalav_next_job and work through the jobs (outline, then units, up to 3 in parallel); the card checklist advances and then shows the course. Check the plan has 66–121 stages and the granularity rules; if not, tune `claude/prompts/plan.ts` and record it in DECISIONS.md. Also report how many tool calls/minutes it took and whether Claude needed reminders.
- Not done: `plan_improve_request` (needs indexed materials, M6), Learn/Practice buttons (M7/M9), delete course (`deleteCourse` is Tauri-only; Node trash port exists in `native.ts`, wire when needed), Files card (M6).
- Next: M6 — Files and indexing.

### M6 — Files and indexing (done)
- Server `src/server/fileTools.ts` (`registerFileTools`, called from `createServer`): app-only `files_list` (runs `scanCourse`, returns `FilesData`: rows with status/progress/exercise counts, `canIndex`, `canImprove`, improve state), `file_upload_chunk` (ordered base64 chunks → temp file → `importFiles`), `files_open_folder` (Finder/Explorer), `files_start_indexing` (queue as one bridge op; the model then calls `shalav_next_job`), `file_remove` (trash + drop index), `plan_improve_request` (`refinePlan` as a bridge op). The v1 index queue is reused unchanged (gateway = bridge via `claude()`).
- Card `views/Files.tsx` inside the course card: two drop zones + file picker, per-file status chips (Waiting/Indexing N/M/Ready/Failed), exercises found, Remove, Open folder, Start indexing (chat line `mcp.index`), Improve plan (`mcp.improve`); polls `files_list` while busy and reloads the course when work ends.
- Tests: `fileTools.test.ts` (visibility, chunk order/duplicate, list, indexing round trip via bridge job with a txt file, remove); e2e course card now checks the Files section (he/en × light/dark, axe). 169 unit + 14 e2e green; typecheck/lint clean; cards 966 KB, server 3.6 MB.
- 🧪 **User check in Claude Desktop** (after M11): in a course card drop a lecture PDF into Study materials (and a homework PDF into Sample exercises); chips show Waiting; press Start indexing; Claude should work through the page jobs (text pages first, images only when needed); chips become Ready with "N exercises found"; then Improve plan updates the plan. Report time/tool calls, and whether the drag-and-drop inside the card works (the host iframe may block it; the picker button is the fallback).
- Not done / not verified: a real PDF through the esbuild bundle (pdfjs worker + canvas), drag-drop in a real host iframe, HEIC, the `files_open_folder` call (no test, spawns the OS opener), Windows paths.
- Next: M7 — Learn (🧪).

### M7 — Learn (done; 🧪 pending)
- `src/server/learnTools.ts` (`registerLearnTools`): model+card `shalav_start_lesson` (returns v1 tutor instructions with `mcp` rule 10, `[STATUS]`, raw BM25 materials excerpt, boundary, RECAP block; appends `stage_started` once; locked/completed handled), `shalav_lesson_status`, and the tutor tools under their v1 names/schemas: `present_mcq`, `ask_open_question` (cards), `record_check_result`, `update_assessment` (events + criteria result), `consult_materials` (raw pages). App-only: `check_answer`, `lesson_state`, `stage_complete` (mastery needs criteria; `user_override`), `stage_reopen`. `domain/learn/recap.ts`, `tutorSystem({mcp:true})`.
- Cards: `views/Lesson.tsx` (objectives, mastery bar, Complete stage / Complete anyway + confirm listing missing items, Next stage, Learn again; polls `lesson_state`), `views/Question.tsx` (MCQ marking + explanation, open answer form). Both answers go to the chat through `say()`. Markdown+KaTeX in cards (code/figures stubbed; cards 1.77 MB).
- Tests: `learnTools.test.ts` (full event sequence over MCP: start, MCQ once-only recording, tag define/observe, open check, assessment/criteria/status, override, reopen + recap); e2e lesson/mcq/open cards he/en × light/dark with axe + screenshots inspected. 170 unit + 22 e2e green; typecheck/lint clean.
- 🧪 **User check in Claude Desktop** (after M11): press Learn in a course card (or say "Let's learn S001"); Claude should call shalav_start_lesson, show the lesson card and teach one idea per message, then ask via question cards; MCQ buttons mark right/wrong with the explanation and a chat line "My answer: …" appears; open answers go back as a chat line; Claude calls update_assessment/record_check_result; the lesson card's mastery/objective ticks update within ~4 s; Complete anyway lists what is missing; Next stage starts the next lesson; in a new chat, "continue" resumes with a recap. Report whether Claude ends its message after a question card, whether math renders in cards and chat, and how many tool calls a lesson step needs.
- Not done / known: `assign_exercise` + graded exercises (M8; criteria cannot be met until then, use Complete anyway); open-question attachments (M8); active lesson and MCQ answer keys are in memory only (lost on server restart); figure blocks are not drawn in cards; locked-stage refusal untested (test plan has no prerequisites); real host behaviour of `sendMessage` untested.
- Next: M8 — Exercises and grading.

### M8 — Exercises and grading (done; 🧪 pending)
- `src/server/exerciseTools.ts` (`registerExerciseTools`, called from `registerLearnTools`, which also registers the model tool `assign_exercise` with the v1 schema): app-only `exercise_state`, `exercise_grade_request`, `exercise_hint_request`, `exercise_solution_request`, `exercise_retry`, `attachment_upload`. Requests run v1 `ExerciseRun` (`gradeAttempt`/`getHint`/`getSolution`) as bridge ops; the grade JSON is returned to the model by the final `shalav_submit_job`. `Env.digest` (optional) feeds hints/solutions raw BM25 pages. The interim "assign_exercise not available" note is gone from `shalav_start_lesson`.
- Card `views/Exercise.tsx` (statement, figure crops as data URIs, hints, upload with in-card photo shrink, Grade / Hint N/3 / Show full solution / Try again, v1 `GradeCard`, polls `exercise_state` while Claude works). Chat lines `mcp.grade/hint/solution`.
- Tests: `exerciseTools.test.ts` (over MCP: visibility, hints 1-3 and a refused 4th, upload, grade through a bridge job with the page image, `attempt_graded` with hintsUsed 3, tag defined, solution reveal event, retry, expired id, key not leaked); e2e exercise card he/en × light/dark (axe, screenshot inspected). 26 e2e; typecheck/lint clean.
- 🧪 **User check in Claude Desktop** (after M11): in a lesson Claude calls `assign_exercise`; the Exercise card shows the statement; Upload a photo of a handwritten solution (also try a PDF); Grade puts a chat line, Claude fetches the job (sees the photo) and answers; the Grade card appears in the card (steps, missing, mistakes) and Claude continues the lesson. Hint 1/2/3 and Show full solution (unlocks after hint 3 or a grade). Report: does Claude actually read the handwriting from the job image, time and tool calls per grade, whether the file picker works in the card iframe, and whether a phone photo uploads fast.
- Not done: open-question attachments (decision: paste in chat); run state not persisted across a server restart; Practice reuse of the card comes with M9 (`exercises.open(n, ex, "practice")`).
- Next: M9 — Practice.

### M9 — Practice (done; 🧪 pending)
- `src/server/practiceTools.ts` (`registerPracticeTools`; `createServer` now creates `registerExerciseTools` once and passes it to Learn and Practice): model+card `shalav_practice({courseNumber, scope?})` (without a scope the card shows the chooser), app-only `practice_state`, `practice_start_request`, `practice_next_request`, `practice_answer_mcq`, `practice_answer_open_request`, `practice_retry`, `practice_end`, `practice_learn_again`. One v1 `Practice` engine per course in memory (state also saved as v1 `ui` lines, so a restart resumes). Engine calls that may need Claude run as bridge ops; the tool waits 100 ms, and if the engine is still loading the card sends the chat line `mcp.practice` so the model calls `shalav_next_job`. MCQ keys and explanations leave the server only after the answer.
- Exercise items reuse the Exercise card: `exercises.adopt(runId, n, run, "practice")` registers the engine's own `ExerciseRun`, so grade/hint/solution tools work unchanged and the engine records results. Engine changes: `prefetchOn` (server sets false) and `binding` promise.
- Card `views/Practice.tsx`: scope chooser (all / unit / weak / stage), counters, MCQ, open answer (text only), Try again, Next, End, summary with Learn again; polls `practice_state` while loading or on an exercise item. Course card Practice button opens it.
- Tests: `practiceTools.test.ts` (visibility, locked → chooser, generated exercise via two jobs, exercise card state through exercise tools, MCQ key hidden then revealed, open answer graded via job, summary, events); e2e practice card he/en × light/dark (axe, screenshot inspected). Typecheck/lint clean, e2e 30 pass.
- 🧪 **User check in Claude Desktop** (after M11): complete one stage, open the course card, press Practice, choose a scope, Start; Claude should fetch the job(s) and an item appears (exercise → upload/grade like M8, MCQ, open answer). Report how many tool calls an item takes and whether the "continue" chat line works.
- Not done: prefetch (decision: off, see DECISIONS.md); open-answer attachments; the weak scope is untested over MCP.
- Next: M10 — Settings and context.

### M10 — Settings and context (done)
- `src/server/settingsTools.ts` (`registerSettingsTools`): model+card `shalav_settings`, app-only `settings_update` ({language?, learning?}, zod bounds from the v1 schema, saved through the v1 settings store), model tool `shalav_context({courseNumber?, stageId?})` = course progress + v1 §6.8 knowledge boundary + current stage objectives + nearby plan (courseNumber defaults to the only course). Instructions mention both.
- Sync conflict copies: `lib/fs/conflicts.ts` (`isConflictCopy`: `x (1).json`, `(conflicted copy)`, `(Case Conflict)`; `findConflictCopies(root)` skips materials/exercises/attachments/crops). `readJsonlDir` now ignores conflict copies; the settings card lists them in an alert.
- Card `views/Settings.tsx` (language buttons, read-only data folder with the note "change it in the extension settings", learning criteria with restore defaults, conflict warning); Home got a settings icon button.
- Tests: `settingsTools.test.ts` (conflict-name table; settings round trip incl. out-of-range rejection; a conflicted events file is ignored and listed; `shalav_context` + unknown course); e2e settings card he/en × light/dark (axe, screenshot inspected). 174 unit + 34 e2e; typecheck/lint clean; cards 1.79 MB.
- Not done / known: the language button changes the setting but the open card keeps its language until the next card; the data folder comes from MCPB `user_config` in M11 (until then `dataRoot` is the settings.json value); only data files (json/jsonl/md) are scanned for conflicts.
- Next: M11 — Packaging (MCPB) and docs (🧪).

### M11 — Packaging (MCPB) and docs (done; 🧪 pending)
- `mcpb/manifest.json` (manifest 0.3; node server `server/server.mjs`; `user_config` `data_folder` (directory, default `${DOCUMENTS}/Shalav`) and `language` (he/en) passed as env `SHALAV_DATA_FOLDER` / `SHALAV_LANGUAGE`; platforms darwin + win32), `mcpb/icon.png` (512 px, copy of the placeholder Tauri icon). `initNode` applies the env: the folder always wins, the language only seeds the first run (settings.json absent); unresolved `${...}` values are ignored.
- `pnpm pack:mcpb` (`scripts/pack-mcpb.mjs`): builds cards + server, stages `build/mcpb/` (manifest, icon, `server/{server.mjs,cards.html,pdf.worker.mjs,standard_fonts/}`, `@napi-rs/canvas` + darwin-arm64/x64 + win32-x64 binaries), `mcpb validate`, `mcpb pack` → `dist/shalav.mcpb` (41 MB). `pnpm smoke:mcpb` unpacks it and talks over stdio (44 tools, Home card, cards resource, data folder env). `@anthropic-ai/mcpb` 2.1.2 is a dev dependency; `pnpm-workspace.yaml` `supportedArchitectures` installs all OS canvas binaries (run `CI=true pnpm install` after changing it).
- Bundle fixes found while packing: pdfjs needs `pdf.worker.mjs` next to `server.mjs`, and `standard_fonts/` (`SHALAV_PDF_FONTS`, set by `main.ts`) for PDFs without embedded fonts. Verified by hand: a PDF page's text and a JPEG render work from the unpacked bundle with the canvas native module.
- `.github/workflows/release.yml` rewritten (tag `v*`: install, typecheck, test, pack, smoke, attach `shalav.mcpb`; never run). README, INSTALL.en.md, INSTALL.he.md rewritten for v2. eslint ignores `build`, node globals for `scripts/`.
- Tests: `node.test.ts` env test (folder override, first-run language, `${...}` ignored); 175 unit pass, typecheck/lint clean.
- 🧪 **User check in Claude Desktop** (on `dist/shalav.mcpb`: run `pnpm pack:mcpb`, or the release asset): double-click it and press Install; the settings dialog asks for a data folder and language and does NOT ask for an API key; type "Shalav" or pick the prompt "Shalav: my courses": the Home card opens (Hebrew, RTL). Then do the pending checks M4–M10 listed above (Add course 01040195, files, Learn, exercise, Practice, Settings). Also report whether Claude Desktop warns about an unsigned extension, and whether the data folder you chose was created. Windows: same install on a Windows machine, not tested.
- Not done / not verified: install on a clean macOS user and on Windows; `pnpm pack:mcpb` on Linux CI (the workflow is untested); the `.mcpb` is unsigned; the icon is a placeholder; manifest `language` is a free string (no enum support in `user_config`).
- Next: M12 — Cleanup (delete Tauri/sync/API code, move to src/core).

### M12 — Cleanup (done)
- Deleted: `src-tauri/`, `src/sync`, `src/screens`, `App/routes/main.tsx`, `index.html`, `live/` + `vitest.live.config.ts`, v1 API client (`claude/{gateway,cache,models,cap,connect,keyCheck,sdk}`, `pricing.json`, `prompts/{ask,summary}`), `domain/{ask,usage}`, `lib/secrets`, the v1 Lesson engine (`learn/{engine,context,session}`), unused UI (`Lightbox`, `ui/{dialog,tabs,toaster}`), Tauri branches in `storage/fs/firstRun/pageSource/catalog/courses`, and all Tauri/Anthropic-SDK/router/radix-dialog/tabs deps. Settings schema lost `models/usage/updates/onboardingCompleted` (old files still parse).
- Moved with `git mv` to `src/core/{domain,lib,claude,render,i18n,components}`; imports are `@/core/...`. `claude/runtime.ts` is just `setClaude/claude`. `claude.test.ts` shrank to `structured.test.ts`. `pnpm dev` = vite on 1420 (card test host); Playwright waits on `test-host.html`.
- Checks: typecheck/lint clean, 118 unit, 27 e2e (the 7 desktop-app specs are gone), `pack:mcpb` + `smoke:mcpb` ok (44 tools).
- Not done: unused i18n keys of the v1 screens remain in `he.json/en.json`; `src/server/tools/` split from plan §8 not done (flat `src/server/*Tools.ts`); `mcp:dev`/README not re-read for stale desktop wording beyond M11.
- Next: M13 — Hardening + acceptance checklist v2.

### M13 — Hardening + acceptance (done; 🧪 pending)
- **Nudge** (plan §11 risk): `cards/views/Waiting.tsx` = "Waiting for Claude…" plus a "Nudge Claude" button after 20 s that re-sends "call shalav_next_job"; used by the plan-build checklist, Files and Exercise cards. Test `Waiting.test.tsx`.
- **Claude Code / text hosts** (§10 #13): `course_lookup`, `course_create_request`, `plan_retry_request`, `course_status`, `files_list`, `files_start_indexing`, `plan_improve_request` are now visible to the model as well as the card; `shalav_home`/`shalav_course` text lists numbered options; server instructions explain the text flow. Not possible without cards: photo grading and file upload (put files in the course folder, then `files_list`).
- `ACCEPTANCE.md`: the §10 checklist with auto coverage and the 🧪 boxes. Checks: typecheck/lint clean, 119 unit, 27 e2e, pack + smoke ok.
- **All remaining work is the user's 🧪 checks** (M4–M11 items above + ACCEPTANCE.md) and fixes from what they find. Open polish: unused v1 i18n keys, `src/server/tools/` split, signing/icon for the `.mcpb`.

### M13b — First real run (headless Claude Code, 2026-10-21)
- Remote testing without the Mac screen: `claude mcp add shalav -e SHALAV_DATA_FOLDER=~/Documents/ShalavTest -- node build/mcpb/server/server.mjs`, then `claude -p "<test prompt>" --allowedTools mcp__shalav` from the Bash tool. Remove with `claude mcp remove shalav`. Test data lives in `~/Documents/ShalavTest` (not the real Shalav folder).
- **Plan build for 01040195 verified with real Claude**: lookup ok, 7 units / 101 stages (target 66–121), 8 jobs (1 outline + 7 units), `shalav_course` data fine, `plan.md` readable Hebrew, courseKind became proof-based. Claude needed only one `shalav_next_job` call (each submit returns the next job).
- Fixes from its report: job text said "Call submit_plan_outline" (now rewritten to point at "How to answer"); `Next job is ready.` now followed by a blank line; action tools return `next: "Call shalav_next_job now."` in structuredContent (Claude Code shows structuredContent only, the text hint was invisible).
- Not fixed: jobs 2–8 repeat ~3k tokens (outline + syllabus) each; "Same instructions as job #1" dedupe may confuse a model that lost job 1; exam-prep stages S099–S101 sit at the end of the last unit; text fallback options of shalav_home/shalav_course are invisible in Claude Code for the same structuredContent reason.
- Still 🧪: the cards in Claude Desktop (needs the Mac screen).

### M14a — Universities (done)
- `src/core/universities.ts`: registry for technion / huji / reichman / braude (names he/en, example number, Moodle URL, `catalog` flag, `normalize`). Technion keeps the 8-digit rule (6-digit legacy padded); the others accept any 2–32 char `[A-Za-z0-9._-]` code (**formats unverified**, see DECISIONS). `COURSE_ID_RE` replaces every `\d{8}` (schemas, tools, course dir filter). `uniName()` feeds the prompts instead of "Technion".
- The choice lives in the data folder's `shalav.json` (`university`), written once by `shalav_choose_university` (model + card) and refused afterwards ("locked; reset = delete the data folder"). v1 data (courses but no choice) is locked as Technion on load (`lib/firstRun.ts` `loadUniversity`/`chooseUniversity`). `shalav_home` returns `university: null` until chosen; the Home card then shows the picker; lookup/create refuse before a choice.
- Only Technion has an online catalog; other universities skip the lookup (`notfound` → manual entry form).
- Tests: tool flow + lock, v1→technion, loose ids, picker e2e (28 e2e), 120 unit. Docs: README/manifest text.
- Not done: Moodle per university (next, M14b); settings card does not show the university yet.

### M14b — Moodle import (done; 🧪 live check pending)
- `src/server/moodle.ts` drives the student's **own Chrome** (`playwright-core`, `channel: "chrome"`, persistent profile in the config dir `moodle-profile`): `connect` opens a window for SSO + MFA and waits for a logged-in Moodle page; `sync` opens `/my/` in a headless page first (SSO cookies in the profile sign in silently; Moodle's own session cookie dies with the browser), then course search by number → course page → resource/folder/pluginfile links → downloads (same host, sequential). `moodleParse.ts` = the regex selectors (one place to fix after a real-site check). Role guess: exam/quiz/exercise/solution words (he+en, name or section title) → exercises.
- `moodleTools.ts`: `moodle_import({number, url?})` (background job; login first if needed, one automatic re-login on expiry; files go through `importFiles`, so dedupe and naming are the usual ones), `moodle_disconnect` (deletes the profile). State shows in `files_list.moodle`; the Files card has an "Import from Moodle" box (address field when the university has no built-in URL, progress, result, Forget login).
- Moodle address: Technion built in (`https://moodle.technion.ac.il/`, to verify); HUJI/Reichman/Braude unknown → the student pastes it once (saved in settings `moodleUrl`, https only).
- Tests: parsers + a fake Moodle (http server with an SSO-style persistent cookie and a session cookie) driven by Playwright's bundled Chromium: login, 4 files by role, zip skipped, second run all duplicates, forget + re-login. 122 unit, 28 e2e.
- Packaging: `playwright-core` is external and copied into the MCPB `node_modules` (`scripts/pack-mcpb.mjs`). `pnpm pack:mcpb` ok (44.7 MB), `smoke:mcpb` ok (47 tools), `playwright-core` loads from the staged server.
- 🧪 live (needs the Mac screen): Import from Moodle in a course card → Chrome opens → log in with MFA → files appear → Start indexing. Report failing selectors.

### M14c — University polish (done)
- `course_lookup` for universities without a catalog returns `manual` (+ normalised number) and the card says "no online catalog yet, enter from the syllabus" instead of "not found"; the manual form no longer strips letters from course ids. Settings card shows the locked university with the reset note.

## Phase 1 — Desktop app (v1, frozen)

### Steps (v1 spec §19)
- [x] 1. Scaffold — DONE (see log)
- [x] 2. Data layer — DONE (see log)
- [x] 3. Claude layer — DONE (see log)
- [x] 4. Onboarding — DONE (see log)
- [x] 5. Courses — DONE (see log)
- [x] 6. Progress — DONE (see log)
- [x] 7. Ingestion — DONE (see log)
- [x] 8. Rendering — DONE (see log)
- [x] 9. Learn — DONE (see log)
- [x] 10. Practice — DONE (see log)
- [x] 11. Settings + Ask panel — DONE (see log)
- [x] 12. Sync — DONE (see log)
- [x] 13. Release — DONE (see log)
- [~] 14. Hardening — partial; superseded by v2 M13

### Log

### Step 1 — Scaffold (done)
- Frontend: Vite/React 19/TS strict/Tailwind v4, i18n he (default)/en with live RTL, app shell (top bar, breadcrumbs, Ask tab placeholder), placeholder routes + Settings 6 tabs, zod Settings schema (`src/domain/schemas.ts`) + zustand store (`src/stores/settings.ts`, storage in `src/lib/storage.ts`), toasts, shortcuts. Scripts: dev/build/typecheck/lint/test (all pass, 4 tests).
- Rust (`src-tauri/`): Cargo.toml, tauri.conf.json (CSP §15.3), capabilities/default.json, commands secret_*/trash_path/heic_to_jpeg/file_sha256/import_copy, placeholder icons. **Never compiled** (no cargo on this machine).
- Needs compile check once Rust exists: capability permission ids (fs:scope, opener path scopes, http allow, process, updater), `tauri-plugin-oauth` version, keyring v3 / trash / single-instance API signatures, `asset:` protocol if convertFileSrc is used.
- Placeholders: updater pubkey (`pnpm tauri signer generate`), `<owner>/<repo>` in updater endpoint + opener scope, real icons (`pnpm tauri icon`).
- Not yet done (later steps): device.json/shalav.json first-run (§15.1, step 2), real onboarding, README/INSTALL docs (step 13).
- Next: Step 2 — Data layer.

### Step 2 — Data layer (done)
- `src/domain/dataSchemas.ts`: zod schemas + types for every §3 file (course, plan, events union, progress, session lines, file index, generated, shalav.json, device.json). Settings schema stays in `schemas.ts`.
- `src/lib/fs/`: `fs.ts` (Fs port; plugin-fs impl, `setFs()` for tests), `paths.ts` (NFC, join, `coursePaths()` for the whole §3.2 tree), `atomicWrite.ts` (tmp+rename, `readJsonFile` w/ schema), `jsonl.ts` (append, partial-line-tolerant read, dir merge by (ts,id) + dedup). `watch.ts` deferred to Sync/Ingestion.
- `src/lib/{ids,hash,time}.ts`; `ulid` dependency added. `src/test/memfs.ts` in-memory Fs for tests.
- `src/lib/firstRun.ts` (§15.1): device.json in appConfigDir, data root + shalav.json (reused if present); runs in `main.tsx` after settings load, no-op outside Tauri.
- Tests: 18 pass; typecheck/lint/build clean. Not exercised against real plugin-fs (needs Tauri/Rust).
- Next: Step 3 — Claude layer (`src/claude/`: client, models, tools, cache, prompts; usage accounting).

### Step 3 — Claude layer (done)
- `src/claude/`: `types.ts` (ClaudeRequest/Response, `ClaudeGateway` port), `models.ts` (9.2 task table, `resolveModel`, dev-model override, `pickAvailable` family fallback, 24 h `modelCatalog`), `cache.ts` (9.5 breakpoints: last tool, system, last assistant block; 1 h TTL for tutor; `stripTtl`), `errors.ts` (`ClaudeError` kinds + status classification), `gateway.ts` (`createGateway`: 3-slot FIFO queue with tutor fast lane, retries 1/2/4/8 s + jitter + retry-after, 60 s idle / 10 min plan / 4 min hard timeouts, abort, thinking-rejected and ttl-rejected session memory, 413 image shrink hook, cap gate hook, usage callback), `sdk.ts` (SDK client via plugin-http in Tauri, streaming transport, `listModelIds`), `tools.ts` (`defineTool` = JSON schema + zod mirror; `submit_retrieval`, `submit_lesson_brief` only), `structured.ts` (`callStructured`: forced tool, zod validate, 2 same-conversation corrections, thinking → auto + fallback to forced w/o thinking), `fake.ts` (`FakeClaudeGateway`, `toolCall`), `runtime.ts` (`initClaude`, `initClaudeFromKeyring`, `claude()`), `prompts/shared.ts` (10.1 fragments), `pricing.json`.
- `src/domain/usage/usage.ts`: device-local `usage.jsonl` (append/read), `costUsd`, `summarizeMonth` (per task/course, cache share), `capState` (80 %/100 %).
- `src/lib/secrets.ts`: invoke wrappers for `secret_get/set/delete`. `src/vite-env.d.ts` for `VITE_SHALAV_DEV_MODEL`.
- Tests: 35 pass total (17 new, fake transport — no network). Typecheck/lint/build clean.
- **TODO / caveats**: `pricing.json` is `{}` — spec 9.7 says fill from Anthropic's pricing page (not verified offline); until then UI shows tokens only. Other tool schemas (tutor, plan, index, grading...) are added by the step that owns them. `initClaude` is not yet called anywhere: Onboarding (Step 4) must call it after key check; `onUsage` should be `logUsage(appConfigDir, e)`; monthly-cap dialog (`beforeRequest`) lands in Step 11. Web-search server tool pass-through is supported via `tools` (`ServerToolDef`).
- Next: Step 4 — Onboarding (12.2) incl. key check + credential storage.

### Step 4 — Onboarding (done)
- `src/screens/Onboarding/index.tsx`: 4-step wizard (12.2) with step indicator; routed in `routes.tsx` while `onboardingCompleted` is false. Step 1 language toggle (live RTL), step 2 console button (plugin-opener) + password field + **Check key**, step 3 data folder with **Change** (plugin-dialog; runs `ensureDataRoot`), step 4 **Connect Google Drive** (disabled until Step 12) / **Skip** which sets `onboardingCompleted`.
- `src/claude/keyCheck.ts`: `checkApiKey` (= `models.list`) + `keyErrorKey` mapping to `api.invalidKey` / `api.noCredit` / `net.offline` / `api.failed`. `src/claude/connect.ts`: `saveAndConnect` (secretSet only after a successful check, then `initClaude` with `onUsage` -> `logUsage(appConfigDir)`) and `connectFromKeyring`, called at startup in `main.tsx` (Tauri only).
- i18n: all 12.8 required strings added in he/en (nested, e.g. `t("api.invalidKey")`), plus `onboarding.*`.
- Tests: 36 pass (1 new: error mapping). Typecheck/lint/build clean. Wizard UI not run in a browser/Tauri; key check never hit the real API.
- Caveats: opener scope must allow `https://console.anthropic.com/*` (check capabilities when Rust exists); Hebrew welcome copy should get a native-speaker pass.
- Next: Step 5 — Courses (catalog lookup, add course, plan generation).

### Step 5 — Courses (done)
- `src/domain/catalog/catalog.ts`: `normalizeCourseNumber` (4.1), `technionSource` (4.2: newest-first semester walk, two hosts, 7-day cache in `appCacheDir()/catalog`, stale cache when offline), `defaultCatalog()` (plugin-http, Tauri only).
- `src/domain/plan/`: `plan.ts` (`stageRange`, `validatePlan` 3.5, `renderPlanMd`), `generate.ts` (`generatePlan`: Pass A with count corrections, Pass B per unit, 3 parallel, one retry on wrong ids). Tools `submit_plan_outline`/`submit_unit_details` in `claude/tools.ts`; prompts in `claude/prompts/plan.ts` (10.3).
- `src/domain/courses/courses.ts`: `createCourse`, `buildPlan` (also "Try again"), `loadCourse`, `listCourses`, `courseExists`, `deleteCourse` (Rust `trash_path`). `domain/progress/initial.ts`: stand-in initial `progress.json`.
- UI (subagent): `screens/Home` (cards, empty state, `AddCourseDialog` with checklist, `parts.tsx`), `screens/CourseHome` (header, plan-failed banner, Learn/Practice buttons, units + stage drawer). i18n `home.*`, `courseHome.*`, `plan.step.*`.
- Tests: 47 pass; typecheck/lint/build clean. UI never run in browser/Tauri; real catalog/API never hit.
- Caveats: card menus use native `<details>` (no outside-click close); Hebrew copy needs native review; `progress.md` not written yet (Step 6); "Improve plan" (4.6), Files cards and Watch-out are later steps; decisions in DECISIONS.md.
- Next: Step 6 — Progress (`reduceProgress`, events append, `renderProgressMd`, debounced recompute).

### Step 6 — Progress (done)
- `src/domain/progress/`: `reduce.ts` (`reduceProgress` pure: statuses 8.1, mastery EMA 8.2, mistakes 8.4, `plan_replaced` id chain via `mapEvents`, `normalizeTag`), `criteria.ts` (`checkAdvanceCriteria({plan,events,stageId,cfg,lang,now})` -> `{met, missing[]}` he/en sentences, 8.3), `render.ts` (`renderProgressMd`, UI language), `store.ts` (`appendEvent(course, event)` -> this device's jsonl + schedule; `recomputeProgress` writes progress.json/md only if changed; `scheduleRecompute` 500 ms debounce, also to call after a sync pull). `initial.ts` removed; `createCourse` uses `reduceProgress(plan, [])` and writes progress.md.
- `src/lib/device.ts`: `setDeviceId/getDeviceId`, set by `firstRun` (events need it).
- Course Home: "Watch out for" panel (top 5 unresolved). Status icons/amber override already existed.
- Tests: 64 pass (17 new); typecheck/lint/build clean. Not run in Tauri.
- Not wired yet (later steps): nothing calls `appendEvent` until Learn (9); recompute after sync pull (12); override-completed ×1.5 weak-spot weighting (Practice, 10); decisions in DECISIONS.md.
- Next: Step 7 — Ingestion (import pipeline, watcher, PDF prep, indexing queue, material/exercise indexing, file lists, plan improvement). Large step: consider splitting into subagent-built parts.

### Step 7 — Ingestion (done)
- Foundation: `Fs` port gained `readBytes/writeBytes` (+ memfs); `pdfjs-dist` added; `domain/ingest/types.ts` (`PageSource`, `OpenSource`, `PasswordProtectedError`, `TooManyPagesError`); `indexStore.ts` (read/write/list `index/files/<sha>.json`).
- PDF/images (subagent): `lib/images.ts` (fit/crop/encode, `cropBox` pure), `lib/pdf.ts` (lazy pdfjs, text/paint-op/render), `ingest/pageSource.ts` (`openSource`: pdf/image/txt/md, page-JPEG disk cache in `appCacheDir()/pages/<sha>`).
- Indexing (subagent): tools `submit_material_pages`/`submit_exercises`, `claude/prompts/index.ts` (10.4), `ingest/index.ts` (`indexMaterial`/`indexExercises`: batches 8 / 6+1 overlap, dedupe, ids `${sha8}-${n}`, stage validation, figure crops), `ingest/queue.ts` (persistent via records; 1 per course, 2 global; >60 pages confirm; subscribe/retry/resume).
- Import (me): `ingest/import.ts` (`importFiles` 5.2 rules, `scanCourse` for watcher/sync arrivals incl. renames and deletions, `removeFile`, `reindex`), `ingest/runtime.ts` (native invoke wrappers, singleton queue, `resumeAll` at startup from `main.tsx`).
- Plan improvement (subagent): `plan/refine.ts` `refinePlan` (4.6: split/insert, ids, Pass B only for new stages, history, `plan_replaced`, index remap), `refineTool.ts`, `prompts/refine.ts`; `newStageIds` drives the "New" badge (session-only).
- UI: `screens/CourseHome/Files.tsx` (two drop-zone cards, Tauri drag-drop role by position + chooser dialog, picker, status chips with N/M, row menu Open/Re-index/Remove, "N exercises found", fs watcher -> rescan), "Improve plan" in the course menu once a material is indexed. i18n `files.*`, `courseHome.improve*`.
- Tests: 83 pass; typecheck/lint/build clean. NOT exercised: pdfjs/canvas/worker, Tauri drag-drop and fs watch, native commands, real API.
- Caveats: HEIC copy keeps sips' temp name (`shalav-<pid>-<stem>.jpg`); `watch` permission/scope for course folders to verify with Rust; 'New' badge is lost on reload; Practice still disabled (Step 10).
- Next: Step 8 — Rendering (Markdown + KaTeX, code, figure blocks 11.x).

### Step 8 — Rendering (done)
- `src/render/Markdown.tsx` (the one renderer: react-markdown + gfm + math + rehype-katex, KaTeX macros \R\N\Z\Q\C, raw HTML ignored, `dir="auto"` blocks, math/inline code isolated LTR via CSS, tables scroll), `CodeBlock.tsx` (lazy Shiki github-light/dark, 12 langs + aliases, language label, Copy; unknown = plain), `Figure.tsx` (lazy dispatch on the 5 tags, error boundary -> "figure could not be drawn" + collapsed source), `Lightbox.tsx` (`Thumb` for exercise crops, Esc closes), `useDark.ts`.
- `render/figures/` (subagent): `specs.ts` (`parsePlot`, `parseGeometry`, `sanitizeSvg`), Mermaid/Plot/Geometry/Wavedrom/Svg components via `useDraw.ts`, `libs.d.ts` (wavedrom types).
- `claude/prompts/figures.ts`: `FIGURE_FORMATS` verbatim; Step 9 passes it to `formatRules`. i18n `render.*`.
- Tests: 92 pass; typecheck/lint/build clean. NOT exercised: mermaid/function-plot/jsxgraph/wavedrom/Shiki in a real browser (jsdom can't), KaTeX fonts bundling check.
- Caveats: plot per-datum `label` parsed but not drawn; Thumb not used yet (Practice, Step 10).
- Next: Step 9 — Learn (lesson flow, tutor chat, retrieval, advance).

### Step 9 — Learn (done)
- Retrieval (`domain/retrieval/`): `bm25.ts` (Hebrew niqqud/prefix aware), `retrieve.ts` (`pagesFor`, `consult` incl. web-search fallback that is skipped on any error, `getLessonBrief` cached at `.shalav/briefs/<stage>-<hash12>.json`), prompts in `claude/prompts/retrieval.ts`. `domain/boundary/boundary.ts` = `buildKnowledgeBoundary` (6.8).
- Tutor: `claude/tutorTools.ts` (6 tools, `BLOCKING`), `claude/prompts/tutor.ts` (10.2 system + `[STATUS]`, wired to `FIGURE_FORMATS`), `prompts/summary.ts`. `domain/learn/session.ts` (merged per-device jsonl), `context.ts` (`buildMessages`: images only newest, ephemeral->stub, status only on newest, `resumePrefix`, `compactIfNeeded` at 40k), `engine.ts` (`Lesson` class: open/send/answerMcq/answerOpen/skipExercise/stop/retry/complete/reopen; every tool outcome is a `ui` session line keyed by tool_use id so resume is exact; events: stage_started, check_answered, mistake_tag_defined, mistake_observed, assessment_updated, stage_completed, stage_reopened).
- UI: `screens/Learn/` (header, mastery bar, objectives, advance + override confirm, mastery banner, streaming + Stop, composer + chips + image attach, MCQ/open/exercise widgets, read-only completed view), `lib/attachments.ts`. i18n `learn.*`.
- `newId` is now monotonic ULID (same-ms ids must sort in creation order for the (ts,id) merge).
- Not done / caveats: `assign_exercise` cards can only be skipped (Upload/Hint/Show solution + Grade Card + 7.6 grading pipeline arrive with Step 10, then also return the grade JSON to the tutor); PDF attachments in chat throw; teaching language = UI language (no separate setting); nothing run against the real API or in Tauri; web-search tool type `web_search_20250305` unverified.
- Next: Step 10 — Practice (selection, generation, grading pipeline shared with Learn, hints, solutions).

### Step 10 — Practice (done)
- Pure selection (`domain/practice/select.ts`: cycle E,E,M,E,O…, eligibility 7.3, scoring/draw 7.4, `focusStage`, `requiredSet`, `targetDifficulty`).
- Claude: `claude/practiceTools.ts` (submit_grade, submit_check_grade, submit_hint, submit_solution, submit_generated_exercise, submit_verification, submit_practice_check), `claude/prompts/practice.ts` (10.5-10.8).
- `domain/practice/`: `exercises.ts` (Ctx, `Ex`, generated store + solutions cache, figure crops), `grade.ts` (`gradeAttempt` 7.6 with thinking 8000, tag definitions, `attempt_graded`; `gradeCheck` for open answers), `assist.ts` (hint levels 1-3, solution/solve mode + `solution_revealed`), `run.ts` (`ExerciseRun`: shared card state for Learn and Practice), `generate.ts` (generate + verify with one regeneration, 4-question batches), `engine.ts` (`Practice` session: snapshot state, prefetch, queue, counters, summary, relearn).
- Learn: `Lesson.exerciseRun(id)` / `continueAfterExercise()`; a graded attempt answers `assign_exercise` with the grade JSON. `lib/attachments.ts` `saveAnswerFile` (PDF → page images, max 12).
- UI (subagent): `screens/Exercise/` (ExerciseCard with upload/hint dialog/solution, GradeCard), `screens/Practice/` (scope chooser, item cards, summary), CourseHome Practice button enabled after first completed stage. i18n `practice.*`, `exercise.*`, `grade.*`.
- Tests: 128 pass; typecheck/lint/build clean. NOT run: real API, Tauri, PDF rendering of answers, UI in a browser.
- Caveats: scope fixed during a session; est. minutes not shown on card; Practice screen has no render test; if Learn reloads after grading but before Continue, no Continue button (sending a chat message continues); decisions in DECISIONS.md.
- Next: Step 11 — Settings + Ask panel.

### Step 11 — Settings + Ask panel (done)
- Settings (`screens/Settings/`): General (language/theme/data folder), Claude (masked key + Check/Replace/Remove, per-task models from models.list, thinking + budget, web lookups; `model.warn*` dialog before risky changes, Changed badge/reset/Restore all), Learning (8.3 criteria + restore), Sync (placeholder until Step 12), Usage (month totals per task/course, cap field), About (version, updater, repo link, logs folder). `runtime.ts` gained `availableModelIds()` / `disconnectClaude()`; capability gained reveal-item-in-dir + $APPLOG.
- Cap: `claude/cap.ts` `makeCapGate` (toast once at 80 %, native dialog Continue anyway/Stop at 100 %, parallel requests share one dialog) wired as `beforeRequest` + `onUsage` in `claude/connect.ts`.
- Ask panel: `domain/ask/ask.ts` `AskThread` (in-memory, last 6 messages, one image, consult_materials loop, no disk/events), `prompts/ask.ts` (10.12), `screens/Ask/` drawer (400 px, end side, Cmd/Ctrl+K, chips, New question), `useOpenExercise` published by ExerciseCard.
- Tests: 135 pass; typecheck/lint/build clean. NOT run: Tauri (key ops, dialogs, updater), real API, UI in browser/RTL.
- Caveats: pricing.json still `{}` (Usage shows tokens only); GitHub link is the `<owner>/<repo>` placeholder; slider warn-on-release untested; no-key error in Ask shows raw text; screen-context strings are English.
- Next: Step 12 — Sync (Google Drive).

### Step 12 — Sync / Google Drive (done)
- `src/sync/`: `types.ts` (SyncState zod + `conflicts`, `DrivePort`, Offline/Reconnect errors), `classes.ts` (3.3 class table, ignore patterns), `drive.ts` (Drive REST: root discovery, folders, multipart/resumable upload, changes paging, 14.7 backoff), `auth.ts` (loopback PKCE via `@fabianlars/tauri-plugin-oauth`, token source refreshing 60 s early, revoke), `engine.ts` (`SyncEngine`: initial connect, localChanged -> persisted queue, 3-way parallel drain, pull via changes, conflict rule per class, echo suppression by sha), `runtime.ts` (watch data root with 2.5 s per-path debounce, 45 s poll, focus pull, connect/disconnect/syncNow, `useSyncStatus`, `useDataVersion`; started from `main.tsx`).
- UI (subagent): Settings Sync tab, header `SyncIndicator` (14.6 states), Onboarding step 4 Connect (step skipped without client id). i18n `settings.sync.*`, `sync.*`.
- Tests: 144 pass (engine two-device test with fake Drive: push/pull/conflict copy/delete->trash; auth PKCE/token cache). NOT run: real Google OAuth/Drive, Tauri watch, oauth plugin.
- Caveats: needs `VITE_GOOGLE_CLIENT_ID/SECRET` at build (else Sync is hidden); capability ids `oauth:allow-start/cancel`, `os:allow-hostname` unverified until Rust compiles; resumable upload is a single PUT (no chunk resume); `pageToken` is taken before the initial listing (safer than after); moving the data root restarts the watcher only (entries keep relative paths); shalav.json conflicts keep no history copy; folders are not mirrored when empty; `useDataVersion` is bumped but screens do not yet subscribe (only progress recompute runs after a pull); a pull of a new course shows on next Home visit.
- Next: Step 13 — Release (README/INSTALL docs, CI build, updater keys, icons).

### Step 13 — Release (done)
- `.github/workflows/release.yml` (17.2: tag `v*`, macOS universal + Windows, tests, tauri-action with updater json), `README.md` (17.3), `INSTALL.en.md` / `INSTALL.he.md` (17.4). Added `@tauri-apps/cli` devDependency and the `tauri` script (it was missing, so `pnpm tauri dev` now works once Rust exists). Dev server port is 1420 (not 5173).
- Still manual (needs the owner): generate updater keys and paste the pubkey, replace `<owner>/<repo>`, create the Google OAuth client, real icons (`pnpm tauri icon`), fill `pricing.json`, GitHub secrets. Workflow never run; Rust never compiled.
- Next: Step 14 — Hardening (18.2 acceptance checklist, a11y/RTL pass, error paths, Rust compile fixes once installed).

### Post-install validation (Rust installed)
- `cargo check`, `cargo clippy`, `cargo test` (2 tests) pass: the Rust code and capability ids compile (tauri-build validates them). `pnpm typecheck/lint/test (144)/build` pass.
- `pnpm tauri build --debug --bundles app` produces `Shalav.app`; the binary launches, the frontend loads and the startup keyring lookup (`il.shalav.app`/`anthropic_api_key`) runs. Not verified visually (no screenshot).
- Gotchas: a pip `xattr` in `/Library/Frameworks/Python.framework/.../bin` shadows `/usr/bin/xattr` and breaks bundling; build with `PATH="/usr/bin:$PATH"`. Updater artifacts need `TAURI_SIGNING_PRIVATE_KEY` (pubkey is a placeholder), so the final updater-signing step fails locally.
- Still unverified: real Anthropic/Google calls, plugin-fs scopes at runtime, drag-drop, HEIC, trash, OAuth, UI in RTL.

### Step 14 — Hardening (in progress)
- Done: `useDataVersion` now has subscribers (Home and Course Home reload after a sync pull); `sync/runtime` imported statically from `main.tsx` (removes the INEFFECTIVE_DYNAMIC_IMPORT build warning). Verified: corrupt/invalid JSON files already degrade to "missing" (`readJsonFile` returns null), `shalav.json`-class conflicts do save a history copy for course-scoped files (the Step 12 caveat only applies to the root `shalav.json`). `reduceProgress` requires (ts,id)-sorted input by contract, so no shuffle test.
- Still open: §18.1 fixtures dir `tests/fixtures/claude/` (tests use inline fake responses), table-driven `decideSyncAction` (logic is inside `SyncEngine.conflict`), Playwright/RTL visual pass, §18.2 manual checklist, real-API pass, resumable upload, empty folders, `pricing.json`.
- Done (2): pure `decideSyncAction(local, entrySha, remoteSha, class, owned)` in `sync/classes.ts` now drives `SyncEngine.applyRemote`/`conflict`; table-driven test `sync/classes.test.ts` (154 tests pass). Remaining from the list above: `tests/fixtures/claude/` (decision: inline fake responses are used instead; add files only if wanted), Playwright visual/RTL pass, §18.2 manual list, real-API pass, resumable upload, empty folders, `pricing.json`.
- Done (3): Playwright added (`pnpm e2e`, `e2e/smoke.spec.ts`, chromium headless; excluded from vitest). Smoke: onboarding opens Hebrew + `dir=rtl`, switches to English `dir=ltr`, dark mode renders, no page errors. Screenshots (gitignored) in `e2e/shots/` were inspected: RTL layout and dark theme look right (a first dark shot looked broken only because of the colour transition).
- Done (4): `e2e/screens.spec.ts` — Home, all 6 Settings tabs, add-course dialog and Ask drawer in he/en × light/dark: no page errors and no serious/critical axe (WCAG A/AA) violations; screenshots inspected. **Found and fixed an RTL bug**: Radix `Tabs` defaults to `dir=ltr`, so the whole Settings panel (tab order, rows, hints) was left-to-right in Hebrew; `components/ui/tabs.tsx` now passes `dir` from the language setting.
- Next (remaining): extend e2e (settings tabs, Home empty state, add-course dialog with a mocked catalog; Learn/Practice need a seeded data root + fake Claude, not possible in plain browser without a test hook), then the real-API pass once a key is available.
- Real-app bug (found by the user, 2026-10-20): adding a course failed with "Something went wrong" because Tauri's fs scope has `requireLiteralLeadingDot = true` by default on macOS, so `$DOCUMENT/Shalav/**` never matched `.shalav/...` (events, history, index, ...). Fixed in `tauri.conf.json` (`plugins.fs.requireLiteralLeadingDot: false`); Add-course dialog now shows the underlying error text. Leftover folder `~/Documents/Shalav/courses/01040066` from the failed attempt is harmless (courseExists checks course.json).

### M14d — Card pin + prompts (done; 🧪 pending)
- Prompts and instructions tell Claude to call `shalav_home` instead of answering from memory (in the first live test Claude Desktop answered from memory with 0 tool calls).
- Pin button (top corner of every card) asks the host for `pip` display mode so the card stays on screen while the chat scrolls; shown only when the host lists `pip` in `availableDisplayModes`. e2e covers the toggle with the test host.
- Live notes: in Claude Desktop a card's `sendMessage` only fills the input box (the student presses Enter); MCP sampling is not offered, so card buttons cannot start AI work by themselves.
- 🧪: does the pin button appear in Claude Desktop, and does the card float?

### M15 — Card requests behind one "▶️ המשך" (done; 🧪 pending)
- Claude Desktop can't start a turn from a card (sendMessage only fills the composer, anthropics/claude-ai-mcp#1111; no sampling). So the card now sends the real request to a hidden app-only tool `shalav_request` (kinds: learn, relearn, answer), and the composer gets only "▶️ המשך" / "▶️ Continue". `shalav_next_job` hands out the card requests first, then the bridge jobs. The instructions tell Claude that this word comes from a card.
- Cards: `say(text)` became `go(req?)` (`useShalav`). A "press Enter" banner shows at the bottom of the card; it hides on new data, after 90 s, or on ✕. The long `mcp.*` chat lines are gone.
- Chaining: `files_start_indexing` refines the plan in the same run. A Moodle import that added files starts indexing by itself → import + index + plan update = one Enter.
- Checks: typecheck/lint clean, 122 unit, 29 e2e, pack + smoke ok (48 tools).
- 🧪 Claude Desktop (a regular chat, not Cowork): Learn → composer shows only "▶️ המשך" → Enter → the lesson starts; MCQ answer → Enter → Claude reacts to the chosen option.

### M15a — fix: Claude ignored "▶️ המשך" after card choices
- Live test: the student chose the university and added a course in the card, then sent "▶️ המשך". Claude's last message had asked "which university?", so it asked again instead of calling `shalav_next_job`.
- Fixes:
  - With a cards host, `shalav_home` text now says the student acts in the card and that Claude should not ask in chat.
  - The instructions say: on "▶️ המשך" always call `shalav_next_job` first, because card clicks change state the model does not see.
  - The card also sends `updateModelContext` with the meaning of the line (best effort).

### M15b — Card UI refresh (done; 🧪 pending)
- One card shell (`Cards.tsx`): slim sticky header with the Shalav mark/wordmark and the pin button (stays reachable while the card scrolls), centred `max-w-3xl` column, opaque "press Enter" banner (no more see-through), skeleton instead of the bare "…" while loading.
- Tokens (`index.css`): calmer palette with AA text contrast in light and dark (darker success/warning/danger in light, lighter in dark, `danger-fg`), card shadow, 14px radius, system font fallbacks for Hebrew, `.cards` line-height 1.6, `fade-in`/`skeleton` honour `prefers-reduced-motion`. Button gets a `sm` size and focus offset.
- Shared bits in `src/cards/ui.tsx` (panel, Bar, Ring, Skeleton). Home: course rows with progress bar + stage pill, empty state with one CTA, university tiles. Course: header with ring + bar, Learn/Practice with icons, units with done count and status chips. Lesson/MCQ/Open/Exercise/Practice/Files/Settings/AddCourse/Checklist/Waiting restyled in the same language. No behaviour, tool or i18n changes.
- Checks: typecheck/lint clean, 122 unit, 29 e2e (axe AA clean); screenshots inspected (he/en, light/dark).
- 🧪 Claude Desktop: look at the cards in a real chat (light + dark, Hebrew + English); is the banner/pin placement right in the iframe?

### M16 — Lesson like a TA: figures, quick checks, notebook exercises (done; 🧪 pending)
- New `show_figure` tool (model + card): Claude draws a function plot, a geometry drawing or an SVG in a card inside the chat while it teaches. The server checks the source first (plot/geometry schema, `<svg>`) and returns the error so Claude can fix it. The figure is drawn left to right even in Hebrew (minus signs stayed on the wrong side).
- The card bundle now includes the plot/geometry/SVG renderers (cards.html 1.8 → 3.3 MB); Mermaid and WaveDrom stay out (9.4 MB with them).
- Tutor prompt (MCP only): teach slowly (intuition with a figure → precise statement → worked example → one quick check), then full written exercises in the student's notebook (paper/tablet) uploaded as a photo or PDF, then a TA-style correction step by step and a resubmit or a similar exercise. The grade result tells Claude the same. The exercise card says "solve in your notebook, upload a photo or PDF".
- Fix: `function-plot` default-export interop (the plot threw "functionPlot is not a function" under Vite dev).
- Checks: typecheck/lint clean, 123 unit, 29 e2e (the lesson e2e now covers the figure card, he/en, light/dark, axe).
- 🧪 Claude Desktop: start a lesson → does Claude draw figures, ask MCQs, then assign a notebook exercise, and after grading go over the mistakes?

### M16a — Back arrow at the top of every card (done; 🧪 pending)
- The sticky card header has a back arrow (→ in Hebrew, ← in English) on every screen except the home list. It goes back through the screens opened inside the card; with no history it goes up (lesson/exercise/practice → the course, course/settings/add/questions/figures → home).
- The in-view back links (course, practice, settings) are gone; a course reload or a finished plan build replaces the screen instead of adding history.
- Checks: typecheck/lint clean, 123 unit, 30 e2e (new back-navigation test).

### M17 — Plan only when the student asks; "Build plan" / "Update plan" covers every topic (done; 🧪 pending)
- Adding a course only creates it (folders + course.json, `addCourse`); no AI job and no "▶️ המשך". The course card opens with "Next: your course files": upload materials/example exercises or import from Moodle (the Moodle import no longer starts indexing by itself).
- One button at the bottom of the course card: "Build plan" (no plan) / "Update plan". New `plan_build_request` (one bridge operation) runs: generate the plan from the syllabus if there is none → index all pending files against it (indexing needs stage ids) → refine with the materials **and the example exercises** so every topic has a stage (the refine prompt now lists the exercises and a coverage rule; it adds stages, never deletes). The result says how many stages were added.
- Removed `files_start_indexing`, `plan_improve_request`, `plan_retry_request` and the FilesData flags (canIndex/canImprove/improving).
- During a build the student can keep using the cards: the course card shows the checklist (plan → read files k/n → coverage) and still shows the files; Home shows a "Building plan…" pill; the back arrow works. `shalav_next_job` now serves pending AI jobs before card requests (a lesson started mid-build would end the turn and stall the build); a card request waits and Claude is told to call shalav_next_job again once the jobs are done.
- Checks: typecheck/lint clean, unit + 30 e2e green, pack + smoke.
- 🧪 Claude Desktop: add a course → no message; upload files / Moodle → Build plan → Enter → plan built from files; add a file → Update plan → new topics get stages.

### M17a — fixes: lesson teaches before quizzing; Moodle login no longer hangs (done; 🧪 pending)
- Lesson: the MCP tutor prompt now says "teach first, quiz second": never open or resume with a question or diagnostic quiz; each idea is taught in full (intuition/figure → definition → worked example) before one check about what was just taught; the first lesson message asks no question tool. `shalav_start_lesson` repeats this.
- Moodle: `moodle.technion.ac.il` redirects to `moodle26.technion.ac.il`, and the login check compared against the address before the redirect, so it never saw the login. Now the real origin is taken after the redirect (login page, `/my/` probe, search and same-host filter), the logged-in check looks at every tab (SSO popups) and also accepts Moodle 4's `#user-menu-toggle`, and after a login the files download in the same browser window (Moodle's session cookie dies when the browser closes). `connect` folded into `sync(…, login)`.
- Test: the fake Moodle now redirects 127.0.0.1 → localhost (the old code hangs on it).
- 🧪 Claude Desktop: Moodle import → log in → the window closes after the download and the files show; start a lesson → the first message teaches with no question.

### M17b — Moodle import: only the course's own Moodle pages, all sections (done; 🧪 pending)
- Search hits must contain the course number (as a whole number; for Technion also the old 6-digit form, 01040195 → 104195, searched too). Before, a search with no exact hit fell back to the first course link on the page (e.g. the site home), so the import scanned the wrong page.
- Up to 5 matching courses (e.g. several semesters) are imported, each with all its sections: one-section-per-page courses (`course/section.php?id=…`, `view.php?id=…&section=N`) are followed. Assignment and page activities are scanned for attached files too.
- Test: the fake Moodle has a site link, another course, an old-number course with a section page; only the right files are imported (5).
- 🧪 Claude Desktop: Moodle import for a real course → only that course's files (materials + exams).

### M17c — Moodle import finds Technion courses (tiles, combined and group courses) (done; 🧪 pending)
- Real-site check (guest search on moodle26.technion.ac.il): Technion's theme shows search results as tiles; the course name is in an `<h3>` and the links say "צפה בקורס" or wrap an image, so matching link text never found the number (01140071, 01040195, 02340117 all failed).
- `parseSearch` now cuts the page into one block per course (from its first link/onclick to the next course) and matches the block's first heading (else its text) → works on Technion tiles and standard Moodle lists.
- Combined courses: `courseNumbers` expands "02340114/7" → 02340114 + 02340117 (and old 6-digit numbers → 8 digits). The search query drops the last digit (`searchTerm`: 0234011) so combined courses show up; results are filtered by number.
- Order: main/combined course first, then group courses ("קב' 082"), then courses hidden from students (`dimmed`); up to 5. A course "not available to students" has no files and adds nothing.
- Live check: 01140071 → main + 3 groups; 01040195 → its course; 02340117 → 02340114/7 then the 082 group.
- Not verified on a logged-in Technion course page (needs the student's login): `parseCourse` (sections/activities) is still generic Moodle.

### M18 — Lessons in small steps, shown in cards (done; 🧪 pending)
- New `teach_step` tool (model + card): one small lesson step (title, Markdown/math body, optional figure) rendered as a card. The card has "Got it, continue", "Explain differently" and "I have a question" (a text box); each goes through `shalav_request` kind `step` (next / again / question) and "▶️ המשך".
- The server rejects a step over ~900 characters (LaTeX commands not counted) with "too long, split it into smaller steps", so Claude cannot dump a topic at once.
- Tutor prompt (MCP): all lesson content goes in teach_step, the chat text is at most one sentence; one step per message, then wait; one idea per step (~120 words); a list of axioms or a long proof spans several steps; a quick check every 2-3 steps; questions answered briefly in a step; "explain differently" re-explains with simpler words/another example/a figure. Rules 1-2 follow this in MCP mode. `show_figure` stays for figures outside a step.
- Checks: typecheck/lint clean, 123 unit (teach_step cases, step request), 30 e2e (step card: math, figure, question flow, axe; he/en, light/dark).
- 🧪 Claude Desktop: start a lesson → short step cards, one per message; Continue / Explain differently / question each need one Enter.

### M18a — Board-like step cards; ≠ and other negated symbols fixed (done; 🧪 pending)
- Bug: `\neq` (and every `\not…`) showed as "/=". rehype-katex rendered with its own KaTeX 0.16 (classes `.inner`, `.thinbox`), but the CSS came from our KaTeX 0.19 (renamed `.katex-inner`, `.katex-thinbox`), so the slash overlay had no styles. Fix: `overrides: katex: 0.19.0` in `pnpm-workspace.yaml` (one KaTeX everywhere, desktop app too). e2e asserts the overlay is styled.
- Step card styled like a board (`.board`): 17px text, line-height 1.9, 1em gaps between paragraphs/lists/display math, spaced list items, slightly larger math, a ruled heading, more padding; long lines scroll inside the card instead of being clipped.
- Tutor prompt: write each step like a tutor on a board (heading, one short sentence per line, key formulas as display math on their own lines, derivations in `aligned` with a reason per line, numbered lists for axioms/cases, real symbols, never ASCII like /= or <=).
- Checks: typecheck/lint clean, 123 unit, 30 e2e (screenshots checked he/en, light/dark).

### M19 — Card redesign for students: a squared notebook in violet ink (done; 🧪 pending)
- Look (cards only, `src/cards/cards.css` after `@/index.css`; the desktop app keeps its look): Rubik variable font (Hebrew + Latin subsets only, replaces Heebo in the cards), lavender paper background, violet ink primary with a violet gradient only on primary buttons/progress fills and the hero band, deep-plum headings, 20px card radius, pill buttons (`--radius-btn`), violet-tinted soft shadows; dark mode has its own night-indigo palette. Axe AA passes in all 4 combos.
- Lesson step = a page of a squared math notebook (22px grid, red margin line on the start side), a big title with a short violet ink underline, the figure pinned on the page beside the text on wide cards, a segmented progress bar "צעד 2 מתוך 5" (new optional `teach_step.progress {n, of}`, clamped), "Got it, continue" as the big primary pill.
- Coloured math terms like the inspiration (a, b, c in blue/green/pink): KaTeX macros `\blue{}`, `\green{}`, `\pink{}`, `\orange{}` → `\htmlClass` (the only trusted command), colours themed per light/dark; the tutor is told to colour the terms the student must tell apart, consistently.
- Lesson and course headers are a violet hero band (white text, white ring/bar); Home rows get a coloured initial badge per course; MCQ/open questions sit in a framed card with violet option letters.
- Checks: typecheck/lint clean, 123 unit, 30 e2e (screenshots reviewed he/en, light/dark).

### M20 — Board-like lecture layouts in lesson steps (done; 🧪 pending)
- **Rows block** (` ```rows `, `src/core/render/Rows.tsx`): one "name | math" per line; the math is split at its first top-level relation (`=`, `\subset`, `\le`, `\iff`, `:=`…, never inside `{…}`, `\{…\}` or `\left…\right`) and laid out as a grid name | lhs | relation | rhs, so the relations line up like on a lecturer's board (the "המספרים הממשיים" photo). Hebrew names stay outside KaTeX. Wide rows scroll inside the block (keyboard-focusable).
- **Board boxes**: `> [!definition] title` / theorem / lemma / proof (dashed, ends with ∎) / example / note / warning → an outlined box with its label cut into the top border (rehype plugin in `Markdown.tsx`; labels in i18n `board.*`). Other blockquotes unchanged.
- **Side note**: `teach_step.sideMd` → a yellow sticky note taped beside the page (wide cards) or above it; counts toward the step length cap. The pinned figure shares that column.
- `\boxed{}` results get a violet frame. Base board styles live in `src/index.css` (desktop renderer too); the notebook flavour in `src/cards/cards.css`.
- Tutor prompt: a board toolkit (rows, boxes, sideMd, set-builder with `\middle|` + `\substack`, cases, aligned with reasons, `\underbrace` notes, `\boxed` results, tables).
- Checks: typecheck/lint clean, 125 unit (splitRel incl. escaped braces, rows render, boxes, sideMd + length cap), 30 e2e (the step fixture is the real-numbers board: 4 rows with the "=" at the same x, definition box, sticky note, boxed result; axe AA; he/en, light/dark).

### M20a — fixes: colour commands leaking into text; "Explain differently" answered with a quiz (done; 🧪 pending)
- Claude wrote `\blue{מעבד (CPU)}` in plain text (outside `$…$`), so the raw command showed. The renderer now turns such stray `\blue{…}` / `\green{…}` / `\pink{…}` / `\orange{…}` in text into coloured words (code and math sources untouched), and the prompt says the colour commands work only inside math, only on symbols; words are stressed with **bold**.
- "Explain differently" sometimes got a quiz question. The request text is stricter (same step, rewritten, no question), and the server enforces it: after the request, `present_mcq` / `ask_open_question` / `assign_exercise` are refused until Claude calls `teach_step`.
- Checks: typecheck/lint clean, 126 unit, 30 e2e.

### M21 — Card redesign: the lecture-hall board (done; 🧪 pending)
- Direction chosen by the student: a real board. Light mode = whiteboard (off-white surface with a glossy sheen and faint ghost marks, aluminium frame, blue/red/black markers), dark mode = green chalkboard (chalk dust smudges, wooden frame, white and coloured chalk). A ledge under each board holds two markers / pieces of chalk.
- Handwriting (Gveret Levin, Hebrew + Latin subsets) for what a lecturer writes by hand: step and header titles, screen titles, row names, box labels, the sticky note. Body text stays Rubik; math stays KaTeX.
- Boards: lesson steps, lesson/course headers, MCQ/open questions, practice questions and exercise statements. Everything else (lists, files, settings) stays calm cards on the classroom-wall background. No gradients; buttons and progress are marker blue / chalk yellow. The board logic from M20 (rows, boxes, sticky note, boxed results) is unchanged, only restyled.
- Text fixes: inline math never breaks across lines (`.md .katex { white-space: nowrap }`; "a +" / "(−b)" were split); a short word right before inline math ("אם $a<b$") is glued to it with a no-break space (rehype pass in `Markdown.tsx`).
- Checks: typecheck/lint clean, 127 unit, 30 e2e (axe AA, he/en × light/dark), screenshots reviewed.

### M22 — One language in the cards (the one in Settings) (done; 🧪 pending)
- Prompt language rule (`languageRules`, used by the tutor, grading, practice, side questions) is stricter than spec 10.1: everything the student sees (titles, text, options, feedback, notes, exercise statements) in the chosen language; English only inside math notation and code; technical terms in the language's university term, with the English term at most once in parentheses; no words inside math (`\text{…}`).
- Server errors the cards showed raw in English are now codes the card translates: Moodle (`MoodleFail` codes chrome / closed / timeout / http / noCourse / login / failed, plus the address check), upload rejections (`file.*`), and the plan-build failure (localized message; the English detail only as a tooltip).
- Test host sample data follows the card language (Hebrew lesson, objectives, questions, grade, practice, board), so screenshots show what a Hebrew student sees; e2e expectations updated.
- Known limit: content generated before the language was changed (an existing plan's stage titles) stays in its old language until the plan is rebuilt.
- Checks: typecheck/lint clean, 127 unit, 30 e2e.

### M22a — Readable spacing; board rows aligned like `aligned`; ε-N order in RTL (done; 🧪 pending)
- Cards: a little letter/word spacing (Rubik sets tight) and line-height 1.7 (2 on boards); lesson objectives 15px with more gap.
- Rows block: the left side now hugs the relation (`justify-self: end`, like `\begin{aligned}`), the gap opens between the Hebrew name and the formula (1.25em). e2e asserts the left sides end at the same x; the step fixture is the multiplication axioms from the student's screenshot (left sides of different widths). Fixed a specificity bug that let a row's display math become its own scroll box.
- Two inline formulas around a hyphen ("$\varepsilon$-$N$") are joined into one formula before rendering, so a right-to-left line no longer swaps them ("N-ε").
- Checks: typecheck/lint clean, 128 unit, 30 e2e.
