# Progress

**CURRENT PHASE: v2 — MCP connector.** Governing doc: `Shalav — MCP Connector Transition Plan v2.md`. The v1 spec stays normative only where v2 keeps it (data layout §3, plan rules §4, progress §8, prompts §10, figures §11.3, knowledge boundary §6.8).
Rules: work only on branch `dev`; one commit per step with tests; update this file after every step; record silent-spec choices in `DECISIONS.md`; stop after each step so the user can compact. Steps marked 🧪 need a manual Claude Desktop check by the user; list what to check.
Environment: Node 22, pnpm, Playwright chromium. Never store keys in files.

Status: plan v2 §9 (M0–M13) is done, plus follow-ups M14–M83. The v1 desktop app (Tauri, API key, Drive sync, Ask panel) is deleted; it lives in git tag `desktop-v1-final` (= `01640cb`).

---

## How to work on it (start here)

- **Build / run**
  - `pnpm dev`: vite on 1420 = the card test host (`test-host.html`, fake bridge, fixtures by query string, e.g. `?view=step&sample=log`, `?files=mix|many|read|importing`, `?stale=1`).
  - `pnpm build:cards` → `dist/cards.html` (single file, served as `ui://shalav/cards.html`). `pnpm build:server` → `dist/server.mjs` (ESM; externals `@napi-rs/canvas`, `playwright-core`).
  - `pnpm pack:mcpb` → `dist/shalav.mcpb` (stages `build/mcpb/`: manifest, icon, `server/{server.mjs,cards.html,pdf.worker.mjs,standard_fonts/}`, canvas binaries for darwin-arm64/x64 + win32-x64, `playwright-core`). `pnpm smoke:mcpb` unpacks and talks over stdio.
  - `pnpm dev:install` (macOS): packs and copies `build/mcpb` over the installed extension (`~/Library/Application Support/Claude/Claude Extensions/local.mcpb.shalav.shalav`), then restarts Claude Desktop (`--no-restart` only copies). First install of `dist/shalav.mcpb` is by hand.
  - `pnpm mcp:dev`: the server under MCP Inspector.
  - Headless real-model test: `claude mcp add shalav -e SHALAV_DATA_FOLDER=~/Documents/ShalavTest -- node build/mcpb/server/server.mjs`, then `claude -p "<prompt>" --allowedTools mcp__shalav`. Test data in `~/Documents/ShalavTest`, never the real folder.
- **Tests**
  - `pnpm typecheck`, `pnpm lint`, `pnpm test` (vitest; server tests use the SDK in-memory transport + `@modelcontextprotocol/client`).
  - e2e: one spec per card in `e2e/tests/` (`home`, `shell`, `course`, `lesson`, `step`, `slides`, `exercise`, `practice`, `settings`, `render`). Run only what changed: `pnpm e2e:changed [ref]`, or `pnpm exec playwright test <spec>`. Screenshots go to `e2e/tests_output/<spec>/`; ask the user to check them, delete them on approval.
  - Flakiness: the first e2e run after a code change can time out while Vite recompiles (rerun); kill an orphaned old `pnpm dev` before running.
- **Gotchas**
  - Claude Desktop runs the server in an Electron utility process: `initNode` clears `process.type` so pdf.js works (M29). Claude.app has the RunAsNode fuse off: never spawn `process.execPath` / `ELECTRON_RUN_AS_NODE` (M39).
  - In Claude Desktop a card's `sendMessage` only fills the composer (the student presses Enter), and there is no MCP sampling. Hence the "▶️ המשך" / "▶️ בניית תוכנית" pattern below.
  - Claude Code shows `structuredContent` only, so action tools put `next: "Call shalav_next_job now."` there.
  - One KaTeX everywhere: `overrides: katex: 0.19.0` in `pnpm-workspace.yaml`. After changing `supportedArchitectures` there, run `CI=true pnpm install`.
  - Env: `SHALAV_DATA_FOLDER` / `SHALAV_LANGUAGE` (from MCPB `user_config`; folder always wins, language only seeds first run), `SHALAV_CONFIG_DIR`, `SHALAV_CACHE_DIR`, `SHALAV_DOCUMENTS_DIR`, `SHALAV_PDF_FONTS`.
  - UI naming: file indexing is "סריקה / scan" (Re-scan = סריקה מחדש).
  - The display/alignment pipeline (math, bidi, rows, fitting) is documented in `OUTPUT_ALIGN.md`.

## Code map

- `src/server/`: `main.ts` (stdio), `server.ts` (`createServer`), `instructions.ts`, `bridge.ts`, `platform.ts` (`initNode`), `nodeFs.ts`, `native.ts` (sha256, importCopy with `name  (2).ext`, trash, heic via sips, openFolder), `canvas.ts`, `resources.ts`, `browser.ts` (own Chromium), `moodle.ts` + `moodleParse.ts`, and flat `*Tools.ts` (course, file, learn, exercise, practice, settings, moodle, translate…). The plan's `server/tools/` split was not done.
- `src/cards/`: `host.ts` (the only MCP Apps code), `useShalav.ts`, `Cards.tsx` (shell, language/theme/RTL, navigation, view switch), `views/*`, `ui.tsx`, `cards.css`, test host + fixtures (`test-advanced.ts` render samples).
- `src/core/{domain,lib,claude,render,i18n,components}` (imports `@/core/...`): v1 domain code reused through the bridge (catalog, plan, progress, ingest, retrieval/BM25, boundary, practice, exercises), prompts in `claude/prompts/`, tutor tool schemas in `claude/tutorTools.ts`, renderer in `render/` (`Markdown.tsx`, `Rows.tsx`, figures).
- `src/core/universities.ts`, `lib/firstRun.ts` (`shalav.json` university lock), `lib/fs/conflicts.ts` (sync conflict copies).

## Feature summary (done, tested; compacted from M0–M55)

**Host Bridge (M3, M25, M38, M40).** `BridgeGateway implements ClaudeGateway`: `send()` parks a job; `bridge.run(label, fn, summary?, lane)` ties jobs to an op (AsyncLocalStorage); `shalav_next_job` hands out jobs, `shalav_submit_job` resolves them and waits (45 s) for the op's next job, result or error. `callStructured` zod corrections are just the next job (`parentJobId`, delta only). Dedupe ("Same instructions as job #N") is per op. Up to 3 jobs per call (image cap ~1.5 MB), answered by parallel submits. `cancel(opId)` rejects with `aborted`.
- **Two lanes** (Claude Desktop shares one MCP connection across chats, no chat id): *build* lane = "▶️ בניית תוכנית" → `shalav_next_job({build:true})`, plan build jobs only; *study* lane = "▶️ המשך" → card requests (`shalav_request`, newest click only) first, then exercise/practice jobs. A second Build/Update plan while a build chat is active returns `joined: true` and is handed off in the same chat. `wait(op)` hands a build chat any course's queued build job.
- Not done: `jobs.json` persistence; sampling fast path (§5.3). Jobs don't survive a server restart.

**Cards (M4, M14d, M15–M16a, M19–M23, M31, M45).** One single-file React bundle; the `view` in `structuredContent` picks the view. Every result carries a rising `card` number; an older card folds itself away ("replaced by a newer card"); a remounted card keeps its number. Sticky header with back arrow and pin (`pip`, only if the host offers it). "Press Enter" banner after a request. Look: lecture-hall board (whiteboard light / chalkboard dark), Rubik + Gveret Levin handwriting, axe AA in he/en × light/dark. Settings language applies at once; Home and Course refetch on a language switch. Empty answer fields take the card's direction. Nudge button after 20 s of "Waiting for Claude…".

**Rendering (M18a, M20–M22d, M25b, M26–M28, M30).** Markdown + KaTeX (mhchem, `\blue/\green/\pink/\orange` via `\htmlClass`), board boxes (`> [!definition|theorem|lemma|proof|example|note|warning] title`), ` ```rows ` blocks aligned at the relation with reason/name columns ordered by reading direction, `displayToRows`, `fenceDisplays`, `balanceDollars`, `escapeCurrency`, Hebrew pulled out of inline math, arrows mirrored in Hebrew sentences, `ltr-token` islands, per-block `dir` from words, shrink-to-fit (down to 60%). Figures: plot/geometry/SVG in cards (Mermaid/WaveDrom left out for size). Details in `OUTPUT_ALIGN.md`.

**Universities (M14a, M14c).** Technion / HUJI / Reichman / Braude; chosen once with `shalav_choose_university` and locked in `shalav.json` (reset = delete the data folder); v1 data locks as Technion. Only Technion has an online catalog (8-digit ids, 6-digit padded); others enter the course by hand. Non-Technion id formats unverified.

**Courses and plan (M5, M13b, M17, M40, M41, M48, M52–M53).**
- Add course creates only the course (no AI). The course card's one button **Build plan / Update plan** (`plan_build_request`): generate from the syllabus if no plan → scan pending files → refine with materials and example exercises (adds stages, never deletes; no minimum stage count) → **enrich** kept stages per unit (`submit_stage_additions`: techniques, edge cases, theorems; never objectives; union merge; split in parts so every line is seen). Refine input is grouped by stage, 1.5k chars per stage round-robin across files. Traps (`edgeCaseFocus`), `keyPoints` and page `notes` are captured at scan time and reach enrich.
- Verified with real Claude (headless): 01040195 → 7 units / 101 stages, plan.md readable.
- Delete units/stages (`plan_remove`, inline confirm, refused during a build): ids kept, prerequisites inherited, `plan_replaced` maps deleted to null, index tags dropped (page becomes uncovered).
- **Translate** (`course_translate_request`): plan and course name into the settings language, cached per language in `.shalav/translations.<lang>.json`, saves chained.
- **Custom courses** (`type: "customCourse"`, id `C…`, `course_custom_create`): name, description, goal, level 1–5; 12–60 stages; prompts drop the university; boundary baseline = the student's level.
- **Materials from the internet** (custom courses only, `course_web_request`, `submit_web_materials`): 1–10 `.md` files, no duplicates by name/text/source URL (up to 2 follow-up rounds), balanced over units by coverage.

**Files and scanning (M6, M29, M34–M37, M40–M47, M50–M51 + fix).** `files_list` polls every 1.5 s while something moves (build, a scanning or build-held file, upload, Moodle) and every 5 s otherwise (idle ticks skip while the window is hidden, one refresh when shown) and scans the folders, so outside adds/deletes/renames/edits show by themselves (`stamp` = size:mtime, only changed files hashed; rename keeps the scan; edit = remove + new file; one record per content across both folders). Uploads via `file_upload_chunk` with a byte progress bar. Index queue: 2 files per course, 3 overall, page batches 3 in parallel (output equals serial); text-first PDFs (images only for scans/figures/crops; spacers ≤4 px ignored). Removing or editing a file mid-scan cancels it and withdraws its jobs. Card: lists open when they fit one page (10 rows) and collapsed when longer, decided once per zone (U7), scan-state legend that filters, split ring, 10 per page sorted by `Intl.Collator`, subgrid rows, ⋯ menu (Open, Re-scan, Delete with inline confirm), solved/unsolved exercise counts, "waiting to scan" during a build.

**Moodle import (M14b, M17a–c, M24–M24c, M36, M39).** Shalav's own Chromium (downloaded once in-process into `<config>/browsers`, ~186 MB, progress bar); login window for SSO/MFA, then cookies copied and the import continues headless on profile `moodle-profile-chromium`. Login check needs the logout link (Technion gives guest access after expiry). Search by number (whole number, 6-digit legacy, combined "02340114/7", tiles parser), up to 5 courses (main, groups, hidden), all sections; links before the first section and admin pages ignored; `filename*` and UTF-8 names decoded; 4 requests in parallel. `briefRole` sorts files by the first 2 pages' text (no AI) and drops video lists and course-admin files. Not verified on a logged-in Technion course page (`parseCourse` sections).

**Learn (M7, M16–M18, M20a, M25c–d, M49).** `shalav_start_lesson` returns tutor instructions (MCP rule 10, teach first then quiz), `[STATUS]`, materials excerpt, boundary, recap. Content goes through `teach_step` cards (≤ ~900 chars, Continue / Explain differently / I have a question → `answer_question` popup, Back to the step / 60 s "answered in the chat?" note); "Explain differently" blocks quiz tools until the next `teach_step`. Tutor tools under v1 names: `present_mcq`, `ask_open_question` (text and/or photos/PDF), `assign_exercise`, `record_check_result`, `update_assessment` (returns fresh `[STATUS]`), `consult_materials`; plus `show_figure`. Lesson card: objectives, mastery, Complete stage / Complete anyway (lists missing), Next stage, Learn again. When the materials' language differs from the settings language, quotes keep the original wording plus a translation.

**Exercises (M8, M31).** Exercise card: statement, crops, upload (photos or PDF → up to 12 page images, drop zone), Hint 1–3, Show full solution, Grade → Grade card; the grade JSON goes back to the tutor.

**Settings and context (M10, M45).** `shalav_settings` (language, read-only data folder, learning criteria, locked university, sync conflict copies listed and ignored by readers). `shalav_context` = knowledge boundary for side questions.

**Packaging (M11, M33).** MCPB manifest 0.3, `user_config` data_folder + language; release workflow `.github/workflows/release.yml` (never run); README / INSTALL.en / INSTALL.he describe the MCPB install.

---

## Recent steps (kept in full)

## M56: the solving loop, and Practice on the board
- New solving loop for written exercises, built on the existing exercise run and card:
  - The question stays on the board. Two choices under it: **Get a clue** and **Submit full solution** (photos or PDF).
  - Get a clue: the work so far (optional) is checked for a mistake first. If there is one, the board points to the first mistake without fixing it; otherwise it gives one small clue for the next step only.
  - After a clue: **I didn't understand the clue** explains the same clue again in other words (added under it on the board, as many times as needed); **Thank you** goes back to the two choices.
  - Submit full solution: the full review (steps, what's missing, the corrected key step). Perfect = score over 95 and every final answer right (new grader field `finalAnswerCorrect`); then the board says so and the loop ends.
  - Clues, explanations and the grade use the course material and the nearest example exercises with their solutions (the grade weighs reasoning, explanations and the course's conventions).
  - Clues count as hints for mastery (at most 3).
- Where the loop is used:
  - Practice: every exercise.
  - Learn: an exercise of difficulty 4–5 in a stage that isn't a concept or definition stage. Intro stages keep the 3 hints.
- Practice mix follows the level (from the last 10 practice scores): more exercises the better the student does (level 2: 1 in 3, 3: 6 in 10 as before, 4: 8 in 10, 5: all). At difficulty 4–5 new exercises are written as real exam questions (exam wording and length, in parts).
- Practice looks like the lesson slides: every screen is a board with a handwritten, underlined title; MCQ options are drawn boxes, feedback is in ink. No sticky notes.
- The "Correct" grade chip had too little contrast; it now uses white (light) / dark (dark) text.
- Tests: item mix by level, server round trip of the loop (intro stage keeps hints; clue with the work attached, 2 re-explanations, Thank you; 96 with a wrong final answer is not perfect, with it right is), e2e of the loop in he/en, light/dark.

## M57: Practice modes, single question, homework with the tutor
- Practice opens on a choice of three modes (on the board): **Solve homework**, **Single question**, **Normal practice** (the existing scope picker; still locked until a stage is completed). A running session or homework reopens where it was.
- Homework / single question:
  - The student uploads the pages (photos or PDF, up to 12). The host model reads them (job `submit_homework`): each question transcribed faithfully in its language with LaTeX, the pages it's on, and the assignment's name. A single question is exactly one.
  - Homework then asks how to solve it: **Solve with the tutor**.
  - Each question runs the solving loop (M56); its original pages show with it and go to the grader. There is no plan stage, so the course material is ranked by the question's text, plus the nearest example exercises.
  - A perfect answer (over 95 and every final answer right) puts the pages the student submitted (their own handwriting) into the solution file, and the question gets a ✓ in the question list. **Next question** goes to the next unsolved one; any question can be opened from the list.
  - **Download solutions (k)** is always there (disabled until one is solved). It builds `solution.pdf` from the accepted pages in question order (one A4 page per photo, `@napi-rs/canvas`, nothing downloaded) and opens the system's Save as dialog (macOS `osascript`, Windows `SaveFileDialog`, Linux `zenity`); the card shows where it was saved.
  - Homework writes no progress events: it doesn't move mastery or mistakes.
  - Single question: after a perfect answer, **New question**.
- State: `.shalav/homework/current.json` per course (kept under its id when left).
- Tests: images to PDF (pages, sizes, photos embedded), server round trip (read job with the pages; loop card with the question's page; 96 with a wrong final answer not accepted, right one accepted; no events; open another question; download cancelled, then saved with 1 page; single question keeps one), e2e (modes, homework flow with download, single question) in he/en, light/dark.

## M58: homework solved by the AI, as a PDF
- After the homework is read, the second choice is **Let the AI solve it**.
- One job per question (study lane; the card sends ▶️ Continue): a complete, exam-level solution that justifies every step. Each job gets:
  - the question with its original page(s);
  - the course material ranked by the question's text;
  - the nearest example exercises with their solutions, so the solution has their format and level of detail.
  - Each solution is saved as it lands; after a failure, Try again continues from the first unsolved question.
- Then the solutions are printed to an A4 PDF: the assignment's name, and per question its statement (shaded) and its solution.
  - The page is built on the server (react-markdown, with KaTeX as MathML, so no fonts or CSS ship; math stays left-to-right inside Hebrew text).
  - It is printed with Shalav's own Chromium, the one Moodle import uses; the first time it downloads once, and the card shows the percentage.
  - The PDF is kept with the homework (`.shalav/homework/<id>.pdf`), so downloading it again is instant.
- The card, on the board: the questions with ✓ as they're solved, "Solving question k of n…", then the PDF step, then **Download solutions** (the same Save as dialog as M57).
- Tests: solutions page (MathML, direction, escaped title), server round trip (2 solve jobs with the question and its page, then ready; the downloaded file holds the name, questions, solutions and math; printing stubbed), e2e (choice, progress, browser-download step, ready, download) in he/en, light/dark.

## M57/M58 fix: Practice opens without a completed stage; homework isn't held to Shalav progress
- The course card's Practice button was disabled until a stage was completed; homework and single questions don't need that, so it is enabled whenever there's a plan (normal practice still says it's locked). The `shalav_practice` description says the same.
- Homework clues and grading no longer get the knowledge boundary built from Shalav progress ("not learned yet"); homework follows the course's own schedule, so they use the course material and example exercises (as the AI solve already did).

## M59: Test practice (past exam questions only)
- Practice has a fourth mode, **Test practice**. It serves only questions from past exams in the course files. It needs a plan but no completed stage. When no exam is found, its chooser says so and asks for exams to be added and scanned.
- Exams are recognized by file name (`moed`, `exam`, `final`, `midterm`, `quiz`, `test`, `מועד`, `מבחן`, `בחינה`, `בוחן`, `בחן`). Only scanned files count, so the pool grows as the scan goes on. An exam and its solution twin (`_sol`, `sol`, `_with_answers`, `פתרון`) are one question set; the copy with the solution is served.
- Burned: each served question is written to `.shalav/test-practice.json` (`burned`: file, question label, key = file without the solution suffix + question number and part) and is never served again, across sessions.
- What a session covers: **The whole course** (default), **Main subjects** (units of the plan, e.g. for a midterm), or **Quiz material from the course** (the student uploads it; the host model picks the stages it covers, job `submit_test_scope`). A question is in scope when its own stage is one of those, and nothing it needs comes later in the plan (earlier prerequisites are fine: in the real course, almost every unit-4 quiz question needs unit-2 stages).
- A miss is any answer that isn't perfect on the first submission (over 95 and the final answer right). A miss that the student fixes on a retry still counts. After a miss:
  - The board shows a stern note, and up to 2 similar questions on the same concept follow: an unburned exam question of that stage, else a new exam-level question like the missed one, generated and verified (solvable, matching its reference solution; one regeneration).
  - A perfect follow-up ends the run of follow-ups. Two misses after the first one mark the concept **weak**: "needs more practice" is noted on the board, and the concept is listed in the Test practice chooser.
  - Weak concepts come up first half of the time. Four perfect answers in a row on a weak concept make it **learned** ("under control").
- Variety: questions avoid the last 3 subjects served when possible. When every exam question in scope is burned, a new one is generated for a weak concept, or else for a subject the exams test.
- The answer is scored once, when moving on or ending the session (a Retry after an error, or End, doesn't score it twice; the last answer of a session counts).
- Grading and clues for test questions use the whole course material, not the Shalav-progress boundary (`Ex.open`). Attempts still write progress events.
- Tests: unit (exam names from the real course folder, burn keys of twins and parts, pool, pick never serves burned / follows the concept / generates when out / scope, follow-ups → weak → learned). Server round trip (burned twin with the solution, stern note + same-stage question, generation like the missed question + verification, weak concept in the file, scope from quiz notes). e2e (scope choices, quiz notes read, question left count, stern and weak notes) in he/en, light/dark.

## M60: saved lessons and practice sessions (`.chat_history`)
- Every lesson and practice session is saved under `<data folder>/.chat_history/<course>/<id>.json` (+ `<id>.jsonl` since M86), one file each. The files survive closing Claude Desktop, and copying the data folder to another computer takes them along. Each one has a title, a type and the time of its last action (a slide, a question, an answer, a button press). Writes to one file go one at a time, so a slide and a click arriving together both land. A deleted conversation is never recreated by a late write.
- Lessons: the conversation is created with the lesson's first card. It records:
  - the tutor's cards (slides, questions with their answer key, exercises, figures, answers to questions, check results, assessments);
  - the student's card actions (Continue, Explain differently, questions, answers, MCQ choices).
  - Shalav can't see text typed straight into the Claude chat.
- Continuing a lesson happens in the current chat (Shalav can't reopen an old Claude chat). `shalav_start_lesson` has `resume` (an id, or `"latest"`):
  - the tutor gets the system prompt, the status and `THE LESSON SO FAR` (the newest 12k characters), and continues from the checkpoint;
  - the card opens on the last card shown. An MCQ gets its answer key back; an exercise is opened again with a new run.
  - **Earlier slides (n)** browses that lesson's slides, read-only, with Previous / Next and **Back to where I stopped**.
  - The "continue learning" prompt uses `resume: "latest"`.
- Course card: when the course has saved lessons, **Learn** asks **Start new lesson** / **Load older lesson**; with none it starts as before.
- Practice card: with saved sessions, the first screen asks **Start new practice** (the 4 modes) / **Load older practice**.
  - Sessions are labeled Homework / Single question / Test practice / Normal practice, with a type filter.
  - Opening one continues it where it was, an ended one too. Normal and test sessions keep their engine state (`PState.cid`); a homework keeps its questions and accepted pages.
  - A running session has **Back** to this screen.
- Lists (both): newest first, title and last action date/time. Open or delete per row; checkboxes, **Select all** (only what the filter shows), **Delete selected (n)**, with a confirm. Deleting a running practice session or homework ends it.
- Card-only tools: `history_list`, `history_delete`, `history_slides`, `practice_resume`; card request `{ kind: "resume" }`.
- A deleted session stays deleted: a practice conversation is created once (a new session, or one from before M60) and only updated after that. A session restored from the device's log whose conversation was deleted is dropped.
- A resumed MCQ that was answered before leaving keeps that answer; it is not recorded again.
- The server instructions and `shalav_start_lesson` say that continuing means `resume: "latest"`, and that without `resume` a new lesson starts. So typing "let's continue" after reopening Claude Desktop goes back to the checkpoint.
- Not yet: a graded lesson exercise isn't logged (a resumed exercise opens ungraded, and the transcript lacks the grade).
- Tests:
  - unit: store, sort, concurrent writes, no recreate after delete, checkpoint, transcript cap;
  - server: a lesson saved by one server is continued by a **new server** on the same data folder (transcript, the MCQ card with its key working, slides); a card resume request; delete;
  - practice: 5 sessions listed by type, an ended normal session continues at its open question, a homework comes back, deleting running ones ends them;
  - e2e he/en, light/dark: lesson chooser, list, delete with confirm, open; practice filter + select all of the filter; slide browsing.

## M61: student knowledge graph — engine + gentle layer (M61–M69 done; M75–M77 close the gaps of the approved plan)
Plan: `~/.claude/plans/when-a-job-is-flickering-hellman.md` (approved; read it first). Engine = **tutor-mcp v0.6.1** (Go binary, MIT; BKT+FSRS, misconceptions, next-activity). Shalav's event log is the truth; the engine is derived.
- `src/core/domain/knowledge/graph.ts`: nodes from plan stages (concept/theorem/technique/edge), id `S003/kind/fnv1a(label)` (`G/…` = course-wide), `requires` edges (prereq stages + in-stage concepts); `graphOf` adds `node_added`/`node_linked` events; `engineNames` (engine concept name = unique label, kept once given).
- `control.ts` (gentle layer): per node decaying average of answers (half-life 12 answers, prior K=3 that fades; custom level prior 1→0.05 … 5→0.85, academic 0.1); legacy stage-level answers count at half weight; `assessment_updated` 0.2 weight; `rawStars` × engine retention; `shownStars` hysteresis (up at next half star, down only 0.35★ below); `questionStars(d, m)=round(d+2(0.5−m))`; `targetDifficulty(m, stretch)` → ~3★ (4★ stretch).
- Events (`dataSchemas.ts`): optional `nodes: {id, score}[]` on `check_answered`/`attempt_graded`; new `node_added`, `node_linked`, `node_observed`. `mapEvents` remaps node-id stage prefixes on `plan_replaced`. `store.onEvent` listener.
- `src/server/knowledge/`: `install.ts` (download per OS/arch from GitHub release, SHA256SUMS pinned, `tar -xf`, into `<config>/engines/`), `engine.ts` (`EnginePool`: one process per course `--local --data-dir`, idle 10 min, max 2, calls serialized), `knowledge.ts` (`createKnowledge(engineFor|null)`: per-device dir `<course>/.shalav/knowledge/<device>/{map.json, engine/}`; syncs plan+tutor nodes → `init_domain`/`add_concepts`/`set_goal_relevance`, replays unsent answers → `record_interaction`; `summary(n)` = graph, control, retention, shown stars, examReady, focus, misconceptions; falls back to log-only for 10 min on engine error). `main.ts` wires the real engine; `createServer(…, knowledge)` defaults to log-only (tests never download).
- Spike facts: BKT swings (8–30 good → 0.94; 2 misses → 0.51 → 0.27), hence the gentle layer; answers without the assessment-attempt protocol are "unverified" (we use estimate + `retention_estimate`); no API to seed mastery (prior is Shalav-side).
- Tests: `knowledge.test.ts` (core, 12) and `src/server/knowledge/knowledge.test.ts` (fake engine, fallback; real binary with `TUTOR_MCP_BIN=…/tutor-mcp`).

## M62: node-tagged evidence + the graph the tutor writes
- `src/core/domain/knowledge/tag.ts`: `candidates(g, stageIds)` (the stages' nodes, then course-wide ones, ≤40), `listText` ("3. [concept] גבול — control 40%"), zod `nodeFields` (`nodeResults: {n, score}[]`, `newNodes: {kind skill|convention|misconception, label, why, stageIds, sameAs?, score}[]`, both default `[]`), `nodeRules` prompt text, `applyNodes` (numbers → ids, unknown numbers/stages dropped; a label already in the graph, normalized, any kind, is that node; ≤300 dynamic nodes; writes `node_added` with the evidence ref).
- Graders: `submit_grade` / `submit_check_grade` get the fields; the prompts list the exercise stages' nodes; `attempt_graded` / `check_answered` store `nodes`. Homework: none.
- Tutor: [STATUS] lists the lesson's nodes with control, numbered (`active.nodes`; numbers stay put, new nodes appended). `present_mcq.nodes` → the card's `check_answered` gets per-node 1/0; `record_check_result` gets the fields (open → on the event; MCQ → `node_observed`). New tool `update_knowledge_graph` (add / link / observe). Prompt rule 9b.
- Skipped: generator and indexer node tags (practice MCQs and generated exercises still count for their stages' nodes at half weight); add when question stars (M65) need the exact nodes.
- Tests: grader keeps node results + a new convention, drops unknown number/stage (practice.test); lesson: [STATUS] numbers, MCQ tags, the tutor's "Cites statute + section" skill created once (a second spelling maps to it), later observations raise its control (learnTools.test).

- Fix: a wrong MCQ tagged with nodes, then `record_check_result` scoring them again, counted the miss twice; tagged nodes are now skipped there.
- `candidates` lists course-wide nodes first (≤15 kept), so a tutor-written skill never falls off a long list.

## M63: mastery and practice selection on the graph
- `reduceProgress`: stage `mastery` = max(older formula, mean control of **all** the stage's nodes with prior 0). No student goes back; the self-rated level of a custom course gives no completion credit. `criteria.ts` unchanged.
- `select.ts`: `levelOf(ctx)` (graph + control, custom prior); `skill(ctx)` = 2 + 3 × control of the completed stages' nodes (3.5 before any); `targetDifficulty(ctx, stageIds)` = control.ts target (~3★ for this student, 4★ after 3 answers ≥85 there), min 2; `pick`/`scoreExercise` fit each exercise to its own stages; `generate` aims at the focus stage. `weak()`/`focusStage()` read progress mastery, so they follow the graph through `reduceProgress`.
- Deferred to M64 (needs `KnowledgeService` in the practice engine): the engine's focus concept, misconceptions and due reviews in selection and summaries.
- Tests: reduce (0 with nothing answered, the tutor's 0.9 kept, one mastered node of two = ~half), select (level and target from control, custom prior, stretch), practice tests set the student's control for the item mix.

## M64: Customized practice (custom courses) + the tutor's knowledge digest
- Scope `{kind:"upto", unitId}` (`select.ts` `uptoStages`; `scopeSchema`): completed stages of the units up to and including it. `Practice.produceUpto`: E items only, always generated at the target difficulty (a course exercise only when generation fails), solving loop as all practice exercises; title "Up to <unit>".
- `focusStage(…, hot)` / `chooseFocus(ctx, scope, hot)`: stages the engine points at (`hotStages(summary)`: focus concept, active misconceptions, controlled nodes with retention < 0.7) rank first (+0.5). `Practice` gets them through a `hot()` callback from `registerPracticeTools(…, knowledge)`. Also fixed: normal `pick` now gets `course` (custom prior).
- Card: `PracticeData.custom` + `allUnits {id,title,ready}`; a custom course shows only Normal and Customized; Customized lists every unit, disabled ("Nothing learned yet") when nothing up to it is completed. i18n `practice.modes.custom*`, `practice.custom.*`. test-host `?custom=1`.
- Tutor: [STATUS] (now async) ends with "The student's knowledge now" (`digest()` in `knowledge.ts`): ★ level (custom) or ★ + exam-ready % (academic), 5 weakest nodes of what was learned, misconceptions, reviews due, engine focus, target difficulty for assign_exercise, the 100/100 + gentle rule. Waits ≤ 5 s for the engine summary, else no digest.
- Tests: select (`upto`, hot), practice (Customized generates only exercises), knowledge (hotStages, digest), learnTools ([STATUS] digest), e2e practice-modes (custom: 2 modes, disabled unit, start).

## M65: stars in the cards + web gathering at the student's level
- `starsFor(ctx, d, stageIds, nodeIds?)` (select.ts) = `questionStars(d, control of what it tests)`; quick questions use `CHECK_DIFFICULTY` (MCQ 2, open 3). Frozen when served: practice `Item.stars` (persisted in PState; `produce()` wraps `make()`), lesson MCQ/Open card data (saved with the lesson, so resume keeps them), lesson exercises in the run record (`exercises.open`/`adopt(…, stars)`).
- Cards: read-only `Stars` in `ui.tsx` (half stars, `role="img"`, RTL-mirrored half); Exercise badge (replaces "Difficulty n/5" when stars exist), lesson MCQ/Open, practice M/O badges; course card "Your level ★" + academic "Exam-ready n%" (`CourseData.knowledge`). i18n `stars.*`.
- `shownLevel(summary, course)`: a custom course shows max(self-rated level, graph stars) (also in the tutor digest). `quickSummary(k, n, ms)` caps waits (course card 3 s, lesson 5 s).
- `gatherWeb(…, level)`: half the documents at the student's level now, half one level up (top level: perfect it); the course card's web level is the same number.
- Tests: select (starsFor), practice (frozen MCQ stars), learnTools (MCQ card stars), knowledge (shownLevel floor), web (current/next prompt), courseTools (card knowledge), e2e exercise/course/lesson star labels.

## M66: replay acceptance check
- The real data roots (`~/Documents/Shalav`, `ShalavTest`) have no events yet, so the check runs on a synthetic history: `progress/replay.test.ts` (36-stage plan, ~3.9k events of every kind, seeded). It stays as a test (speed bound, mastery in 0..1); `REPLAY_OUT=<file>` writes every stage's status and mastery.
- One-off diff against pre-M63 `5ba733e` (a worktree running the same test): 0 status changes, 0 mastery drops, 11 of 36 stages higher (max +0.10); reduce 7 ms → 11 ms.
- Rerun on real data once it exists: the same diff with the real `plan.json` and events.

## M67: the course card's "watch out" list from the engine
- `watchList(summary, progress mistakes, lang)` (knowledge.ts): the engine's active misconceptions, one row per mistake tag (its course label when known), counts summed, the stages of their nodes, top 5. Null when the engine is off or sees none: the card keeps the progress mistakes (unresolved). The practice summary and the tutor's [STATUS] mistakes are unchanged (the tutor's digest already lists the engine's misconceptions).
- Test: knowledge (labels from the course tags, engine off → null).

## M68: assign_exercise defaults to the student's target difficulty
- `difficulty` is optional in `assign_exercise`; left out, a new exercise gets `targetDifficulty(lesson, its stages)` (about 3★ for this student). The digest names it as the default. The engine's `difficulty_target` tie-break was skipped (another engine call for a rounding tie; add if targets look off).
- Test: exerciseTools (no difficulty → 2 for a new student, 3★).

## M69: the generator tags what it tests
- `submit_generated_exercise` and each `submit_practice_check` item return `nodes` (numbers of the focus stages' listed graph nodes, shown with the student's control; the prompt says to aim at the weakest). `generate.ts` `nodeList()` maps numbers to ids (unknown ones dropped): `GeneratedExercise.nodeIds` (schema default [] keeps old files valid), `Check.nodeIds`.
- Used by: question stars (`starsFor` on the tested nodes), practice MCQ answers (`check_answered.nodes` per node, 1/0). Open answers and exercises were already tagged by their graders.
- Tests: practice (prompt lists nodes, generated exercise keeps a known node only, MCQ evidence per node).

## M70–M73: teacher's notes + course facts (the conventions part was removed, see "Conventions revert" below)
## M70: teacher's notes role, web-file marker
- `TEACHER_DIR` "הערות המרצה" (`paths.teacher`, conflicts SKIP); role `"teacher"` in FileIndex, `fileTools` (upload, list `FilesData.teacher`, open folder), `scanCourse` walks it; `imageNeeded` is always true for it.
- Web files: `gatherWeb` appends the content sha to `.shalav/web-files.json` **before** writing the file; `register()` sets `FileIndex.origin = "web"` (the course-facts check never reads them).
- Card: third zone "Teacher's notes & comments" with a hint (only the teacher's comments count). i18n `files.teacher*`. test-host `?files=teacher`.
- Tests: import (teacher role, web origin), web (sha recorded), fileTools (teacher upload), e2e course (teacher zone).

## M71: teacher-notes analysis, graded-work evidence, misconceptions; the eval CliGateway
- `ingest/teacher.ts`: `indexTeacher` (queue role teacher) sends page batches (6, parallel 3) to `submit_teacher_notes` with ONE numbered list of all graph nodes (≤300, shared by every batch) and the known mistake tags. Stores `materialPages` with **only the teacher's writing** (the model's `text`, never the raw page; `kind` graded_work|rubric|remark), `exercises: []`, and `FileIndex.teacherItems` (requirement|deduction|praise: rule, quote, points, exercise, when, level, forms, types, stageIds, resolved node ids, `concerns`, `mistake`). Teacher files never reach examples / exam pool / generation; `retrieve.ts` reads material **and** teacher pages (consult_materials, lesson brief).
- The queue runs **one teacher file per course at a time**, so a second homework uploaded together sees the first one's tags and evidence.
- `teacherEvidence` (queue, after the record is written): once per file sha (`refId`). `node_observed` context `"teacher"`, mean score per node; weight 2 in `control.ts`. Deductions → `mistake_tag_defined` + `mistake_observed` (context teacher). A tag seen in ≥2 distinct works/answers (teacher files, graded attempts, checks) → one `misconception` node (`G/misconception/<tag>`, origin `"teacher"`) + `node_linked misconception_of` its concept; every later repeat writes `node_observed` 0 on it. **This is how the graph learns what the student finds hard from the teacher's own marks.**
- Eval: `src/test/eval/cliGateway.ts` (`claude -p`, isolated, `EVAL_PROCS` per process (default 4), `EVAL_CACHE=<dir>` replays identical requests), `vitest.eval.config.ts`, `pnpm eval:teacher` (real model, spends tokens; ask first). `teacher.eval.ts` + `fixtures/teacher/` passed 3 runs in M71.
- Tests: `teacher.test.ts`.

## M73 (kept part): course facts
- The graders return `disputed` (≤3: claim, believed, points, finalAnswer, 3-6 search phrasings) instead of deducting for a name / section / date / definition / notation from their own knowledge (`DISPUTE_RULES`, `prompts/facts.ts`). `practice/facts.ts` ranks every scanned course file by those words (material + teacher pages, exercise statements + solutions; never web files): 4 best pages + 2 best of the exercise's stages per doubt, ≤16k chars shared equally; a page counts only if it is at least as relevant to the doubt as the key the grader was given (reference solution, example solutions, expected points), ranked in the same BM25 call; no page → no call. One `submit_fact_check` job: wrong → points off (+ final answer flipped), note with source; conflict (teacher, then a clearly newer file, else) → note only; right / unsaid → nothing. The tutor gets the rule only (check consult_materials before marking a course fact wrong).
- `gradeAttempt` takes an optional typed `answerText` (framed as typed).
- Tests: `practice/facts.test.ts`.

## Conventions revert (2026-10-23, user's decision)
Learning "how answers are written in this course" (conventions) from example solutions and the teacher's notes, and applying it in grading and writing, was removed: it could not reach high accuracy. Two paid rounds of the semantic eval (~$30 of CLI estimate) left all 6 hard fixtures failing, and each round of prompt fixes created new regressions (finer rules overflowed the grader's 12-convention list, separation narrowed the teacher's rule, invented "not when" exceptions, over-strict checks). Removed: the registry and reconcile build step, `knowledge/conventions.ts`, the conventions prompts, `Ctx.conventions`, the C1… lists in the graders / writers / clues / generator / tutor [STATUS], `record_check_result.conventions`, `node_retired`, dormant nodes, the scan's solution `occurrences` / `absences` / `answerForms` / `question` / `part`, the conventions eval and fixtures, and the M74 card list (never built). The plan is in `archive/CONVENTIONS_PLAN.md`.
Kept: the teacher's notes (M70 folder + zone, M71 analysis, evidence weight 2, misconception nodes), the course-facts check, the web-file marker, `CliGateway` + the teacher eval. Consequence: the teacher's rubric rules no longer change grading or solutions; they still reach the tutor and the graders' reading material (consult_materials, lesson brief), and the teacher's marks and repeated mistakes still feed the knowledge graph. The grader- and tutor-made graph nodes of kind "convention" (M62) are unchanged.

## Known-limits cleanup (2026-10-23)
- A graded lesson exercise is saved in the lesson's `.chat_history` conversation (entry kind `grade`: score, verdict, summary) through `exercises.onGraded`, set by the learn tools. Test: `exerciseTools.test.ts`.
- 200 unused v1 i18n keys deleted from `he.json` / `en.json` (onboarding, API key, sync, usage, Ask, old screens). Found by searching `src` + `e2e` for each key; dynamic `prefix.${x}` keys kept.

## M75–M77: closing the knowledge-graph plan (user's request, 2026-10-23)
The approved plan was never committed; its final text (2026-10-22 14:47) was recovered from the session transcript. An audit against the code found: control failing the plan's required behaviour (tests loosened), no high-stakes mark, no install progress, no engine re-seed after a reset/upgrade, plan revisions not published, missing evidence (assessment gaps, missed edge cases, check mistake tags), web topics not weighted to the student's weak concepts, no rename / part_of in update_knowledge_graph, a thin real-binary test, and 5 unrecorded deviations.
- **M75 (done):** two-speed control (`control.ts`: long memory 36, slump ≥5 of last 10 → also a short memory 6, take the lower; prior fades at 12); tests at the plan's exact thresholds + stars never drop after 1-2 misses on one node; DECISIONS.md "M61 — Deviations" and "M75".
- **M76 (done):** engine gaps closed (`knowledge.ts`): academic courses `mark_domain_high_stakes` once (`highStakes` in map.json); a stage renumbered by Update plan keeps its engine concept, retention/focus/misconceptions only for nodes of the current graph (`publish_curriculum_revision` not used: DECISIONS "M76"); map.json `engine` version, a new release or an unknown domain → fresh domain re-seeded from the log once; the one-time engine download shows in the course card (`installing` → `CourseData.engineInstall`, he/en `stars.engineInstalling`). Tests: fake engine (high-stakes once, renumber keeps history, wiped DB and new release re-seed), real binary (academic, DB wiped → re-seeded), e2e `course.spec.ts` engine download.
- **M77 (done; the last step of the plan):** the engine now gets the tutor's assessment gaps (failed `DIAGNOSTIC_ASSESSMENT`, knowledge gap), a check's mistake tag (`misconception_type`), and missed edge cases (`missedEdges` in `graph.ts`: the stage's edge nodes by label, score 0, also in `control.ts`; the grader copies the [edge] label). Web gathering names the engine focus + 5 weakest answered nodes (`studyFocus`). Rename / `part_of` dropped (DECISIONS "M77"). Real-binary test of the plan's checks (frontier focus, 2 misses after 8 good stay > 0.6, sustained misses < 0.3, a review due after 90 days by moving the engine DB's review dates). Run it with `TUTOR_MCP_BIN=~/Library/Application\ Support/il.shalav.app/engines/tutor-mcp-v0.6.1/tutor-mcp pnpm exec vitest run src/server/knowledge/knowledge.test.ts`.
  Also open from M76: prerequisite changes between existing concepts are not sent to the engine (DECISIONS "M76").

## M78: Interactive slides (user's request, 2026-10-23)
One `teach_step` can carry `beats` (2–8): the card plays them locally. **Next** (הלאה) reveals the next beat's text and the figure parts tagged with that beat, with no request to Claude. **Back** and the arrow keys move between beats (← is forward in Hebrew). On the last beat the main button is Continue again. A question sends `beat {n, of}`, so Claude knows which beat is on screen.
- **Text.** Every beat is laid out from the start. Beats not reached yet are `visibility: hidden`, so the card's height never changes. Earlier beats are muted. Each beat is its own `<Markdown>`, so every rule in OUTPUT_ALIGN applies.
- **Figures.**
  - geometry: `beat` and `color` (blue/green/pink/orange) on each element. Elements are hidden and shown with JSXGraph `hideElement`/`showElement`, without a redraw.
  - plot: `beat` on data and annotations. A beat change redraws the plot.
  - svg: `data-beat`, `data-focus` and the classes `m-blue|green|pink|orange`, `flow`, `drift` (`--dx`/`--dy`) and `pulse` (`cards.css`). SMIL is stripped.
  - `\blue{word}` in plain text colours the word to match its drawn part.
- **Size.** A slide card is `max-w-5xl`. With a figure, the figure gets the larger column (1.3fr) once the card is ≥ 56rem (container query); narrower cards put it above the text. Figures fill their column (up to 560px tall inline). A full-screen button shows when the host offers it (`data-mode=fullscreen`: bigger text, figures up to 72vh). Plot and geometry redraw on resize.
- **Server.** Each beat is capped at 900 chars and the whole slide at 3600. A figure beat beyond the slide's beats is rejected. The log holds every beat. The tutor prompt has an "Interactive slides (beats)" section. A beat slide counts as one step for the quiz rhythm.
- **Tests.**
  - `specs.test.ts`: beat and colour fields, a part before its points, the sanitizer keeping `data-*`/`class`/`style` and dropping `<animate>`.
  - `learnTools.test.ts`: beats round-trip, caps, a figure beat out of range.
  - `tutorMcp.test.ts`.
  - e2e `slides.spec.ts`: the 4 samples `beatsFn|beatsCircuit|beatsPhoto|beatsCell` × light/dark, stepping through every beat (the beatsFn drawing grows at each beat), a 720px run (the figure above the text at the board's width) and full screen (bigger figure and text). Screenshots per beat are in `e2e/tests_output/slides/`.
- 🧪 **Desktop check.** Does Claude Desktop offer `fullscreen`? How wide is the inline card (side-by-side or stacked)? Does Claude use beats on a function-investigation stage?
- **Review fixes (2026-10-23).**
  - Every piece of text in a figure is checked against the figure's background (`figures/contrast.ts`). Text under 4.5:1 takes the board's text colour. The geometry axes and their numbers are drawn in the board's ink.
  - Geometry no longer has its own resize observer. It used `dontSetBoundingBox` and shifted the graph; JSXGraph's built-in resize keeps the view.
  - `until` (`data-until`) hides a part after a given beat, e.g. CO₂ and H₂O once they react.
  - Beats are tiny steps (one sentence, one calculation line or one new drawn part), up to 16 per slide.
  - The samples were redone with finer beats: beatsFn has 7 beats, beatsPhoto 5.
  - The e2e test checks the contrast of figure text at every beat. Slide screenshots are viewport shots, so the sticky header no longer lands in the middle.
- The "ResizeObserver loop completed" warning in the Vite log comes from geometry figures and predates M78. It is harmless and is not a page error.

## M79: server-drawn figures, figure_guide, TikZ, the biology library (2026-10-23)
- **Pipe.** `src/server/figures/render.ts`: `SERVER_KINDS` (tikz, bio), `renderFigure(kind, source)` (cached), `BEAT_MARK` (`@n` / `@n-m` at a line's end, in `%`, `#` or `//` comments), `themeColors`, `ownIds`. The app-only tool `figure_render` gives the card the SVG (never the model's context). teach_step / show_figure render server kinds when sent, so an error reaches Claude. `figure_guide({kind})` (`src/server/figureTools.ts`) returns a kind's conventions from `src/core/claude/prompts/figureGuides.ts`.
- **Card.** `figures/Remote.tsx` fetches through `setFigureRenderer` (set in `Cards.tsx` from `callTool`) and shows the result with `Svg` (beats, colours, contrast guard; 4 MB cap). `Svg` adds the shading kit (`shade-*` gradients) and the credit line (`data-credit` → `.fig-credit`). `cards.css`: `fig-paper-*`, `shadow`, `glow`.
- **TikZ** (`src/server/figures/tikz.ts`): node-tikzjax's WebAssembly TeX engine; text → paths with opentype.js and the BaKoMa fonts; one render at a time; the TeX error line goes back to Claude. Packages: circuitikz, chemfig, pgfplots, tikz-3dplot, tikz-cd, amsmath, amssymb. Build: `build-server.mjs` stages `dist/tikz/{tex,ttf}` and `dist/biolib`; `pack-mcpb.mjs` copies them, plus `THIRD_PARTY_NOTICES.md`. `smoke:mcpb` renders TikZ and a library figure over stdio.
- **bio:** 49 parts in `assets/biolib/` (manifest with license and author per part). See DECISIONS M79.
- **Prompt.** One line per kind (`CATALOGUE`) plus "call figure_guide before the first figure of a kind"; the general beat and colour-link rules stay.
- **Samples** (`test-advanced.ts`): beatsCircuit (TikZ), beatsIncline (TikZ, 5 beats), beatsMethane (TikZ ball-and-stick, 3 beats), beatsPhoto and beatsCell (bio), beatsCircuitSvg (the hand-drawn svg). `slides.spec.ts` covers all 7 (not run yet: e2e at the end of M83).
- **Tests.** `render.test.ts` (beat groups, paths, colours, balanced groups, ids, package/TeX errors, library parts and credit), `learnTools.test.ts` (tikz in teach_step, `@n` beyond the slide, errors, figure_guide, figure_render), `tutorMcp.test.ts`.
- 🧪 **Desktop check.** Does the TeX engine (WebAssembly) run in Claude Desktop's Electron utility process (cold render ~0.5 s)? Does Claude call figure_guide before a new kind?

## M80: Graphviz, Mermaid with beats, Vega-Lite (2026-10-23)
- **Kinds.** `graphviz` and `vegalite` are server kinds (`src/server/figures/graphs.ts`; `render.ts` `SERVER_KINDS`, card `Figure.tsx` `REMOTE`). `mermaid` is a figure kind again, drawn in the card (`figures/Mermaid.tsx`: `mermaidBeats` + `showBeat`, `.fig-mermaid` CSS for `class A m-blue`). Guides in `figureGuides.ts` (each guide's example is rendered by `render.test.ts`).
- **Shared:** `src/core/render/figures/beats.ts` (`BEAT_MARK` now also `%%`, `beatAttrs`, `MARK`, `markColors`). `themeColors` works per tag.
- **Samples:** beatsAutomaton (Graphviz DFA, 3 beats), beatsFlow (Mermaid flowchart with Hebrew labels, 4), beatsRegression (Vega-Lite, 2), added to `slides.spec.ts` (not run yet). A quick dev-server check of all three passed (beats toggle, no errors); the Mermaid `>` label needed quotes (guide says so).
- **Tests:** `render.test.ts` (Graphviz/Vega beats, colours, errors; the guide examples of tikz/graphviz/vegalite render), `mermaid.test.ts`, `tutorMcp.test.ts`. `smoke:mcpb` renders Graphviz and Vega-Lite in the packed server.

## M81: course images, maps, music, chord charts (2026-10-23)
- **Kinds.**
  - `image` and `map` are server kinds (`src/server/figures/{image,map}.ts`, `SERVER_KINDS`, card `REMOTE`).
  - `abc` (abcjs) and `chords` (svguitar) are drawn in the card (`figures/{Abc,Chords}.tsx`, `Figure.tsx` `F`). The server checks the `K:` line and `{"chords": [...]}`.
  - Guides are in `figureGuides.ts`. `render.test.ts` renders the map and image examples.
- **Course images.**
  - The new tool `course_page({file, page})` returns the page image with a grid of page fractions. `consult_materials` marks pages with "has a figure".
  - The image source's crop and marks are page fractions. teach_step/show_figure add the lesson's course number to the source. The sanitizer keeps JPEG/PNG data URIs on `<image>` in server drawings only.
- **Maps:** Natural Earth 50m (world-atlas) with d3-geo. Projections: mercator, equalEarth, naturalEarth, orthographic, conic. Layers: countries, route, points, label, each with beats.
- **Music:** `% @n` per music line. Play uses WebAudio tones and plays only the lines on the board (abcjs's synth needs a CDN sound font).
- **Samples:** beatsHeart (image, dev course 999 from `e2e/fixtures/devCourse.ts`, which `/__figure` creates), beatsMap, beatsScale, beatsChords. They are in `slides.spec.ts` SAMPLES but not run there yet. A quick dev-server check passed in both themes: no errors, abc line 2 hidden until beat 2.
- **Sizes:** `cards.html` grew from 3.2 to 4.1 MB, `server.mjs` from 11.6 to 12.5 MB. `smoke:mcpb` renders a map (75 tools).
- **Tests:** `render.test.ts` (map, image, grid), `music.test.ts` (abcBeats, parseChords), `specs.test.ts` (data URI only on server `<image>`), `learnTools.test.ts` (image course, abc/chords checks, course_page).
- 🧪 **Desktop check.** Does Claude call course_page before an image figure, and are its marks on target? Does Play sound in Claude Desktop's card (WebAudio after a click)?

## M82: Pikchr, bytefield, Verovio, chess, Go, syntax trees, star maps, SMILES, OpenMoji, draw-in, sketch (2026-10-23)
- **Server kinds:** `pikchr`, `bytefield`, `score` (Verovio), `tree` in `src/server/figures/diagrams.ts`; `chess`, `go` in `boards.ts` (pieces from `assets/chess`, staged to `dist/chess`); `sky` in `sky.ts` (data in `assets/sky`).
  - Pikchr beats: a colour per marked line, tagged after one layout.
  - bytefield and score are shown whole.
- **Card kinds:** `smiles` (`figures/Smiles.tsx`). In `svg`/`bio` figures, `class="draw"` (strokes drawn in at their beat, CSS) and `class="sketch"` (rough.js, loaded only when used) are new.
- **OpenMoji:** 100 `om-*` pictograms in the part library (`assets/biolib`, credit shown).
- **`data-own-bg`:** text inside it is skipped by the contrast guard and the e2e contrast check (Go, the night sky).
- **Catalogue lines shortened:** 20 kinds, under 1,600 characters.
- **Samples:**
  - In `slides.spec.ts` SAMPLES: beatsPipeline, beatsChess, beatsGo, beatsTree, beatsSky, beatsMolecules, beatsEconomy (bio with OpenMoji, draw and sketch).
  - In `render.spec.ts` WHOLE: scoreCadence, ipv4.
  - Not run in e2e yet. A dev-server check passed in both themes: no errors.
- **Sizes:** `cards.html` 4.4 MB, `server.mjs` 23.4 MB, `shalav.mcpb` 60 MB. `smoke:mcpb` renders pikchr, score, chess, sky and tree (75 tools).
- **Tests:** `render.test.ts` (each guide example: Pikchr beats, bytefield/Verovio, chess moves/castling, Go capture, tree subtrees, sky names and errors), `music.test.ts` (parseSmiles), `learnTools.test.ts` (smiles/chess checks), `tutorMcp.test.ts` (catalogue size).
- 🧪 **Desktop check.** Verovio and Pikchr WebAssembly in Claude Desktop's utility process. The size of `server.mjs` and the time to load it.

**M82 review fixes (2026-10-23, done).**
- SMILES: own atom palette per theme in `Smiles.tsx` (`THEMES`, all ≥ 4.5:1). The contrast checks (`contrast.ts`, the `lowContrast` helper in `slides.spec.ts`) judge the element holding the glyphs (`<text>` of coloured `<tspan>`s → each tspan) and skip `mask, clipPath, defs`.
- teach_step counts implicit beats: chess/go moves default to their order, tree `Label@n` (`learnTools.ts`, test in `learnTools.test.ts`).
- `smoke:mcpb` renders bytefield and go too (passes).
- Vega-Lite renders with `aria: false` (axe `aria-prohibited-attr` on beatsRegression, an M80 sample never run before).
- e2e run: `slides.spec.ts` all 21 samples × 2 themes, `render.spec.ts`, `step.spec.ts`: all pass.
- **Decided (user, 2026-10-23): Verovio stays in `server.mjs`** (23.4 MB, most of the growth since M81); revisit if the Desktop check shows a slow start (see DECISIONS M83). Cold start (spawn → listTools, packed server, this Mac): ~0.9 s first run, ~0.44 s after.
- Screenshots of each M81/M82 tool: `e2e/tests_output/tools/` (light theme, last beat).

## M83: 3D scenes with three.js (2026-10-23)
- **Kind `scene`** is drawn in the card (`figures/Scene.tsx`, `Figure.tsx` `F`; three.js is a lazy chunk). It takes declared JSON: objects (box, sphere, cylinder, cone, torus, plane, arrow, line, label) with `beat`/`until`, and camera `views` by beat. The schema `parseScene` is in `specs.ts`, so the server checks it in `badFigure`. The guide is in `figureGuides.ts`. The catalogue now has 21 kinds and is still under 1,600 characters.
- **Card.** Lit, shaded materials. The frame is fixed (the bounds of all parts). The camera moves to each beat's view. The student can drag to turn the scene (no zoom or keys). Labels are HTML pills hidden by `showBeat`. The canvas renders only on change, and its WebGL context is freed on unmount.
- **Sample:** beatsCube (diagonals of a cube: line, arrow, sphere, axes, a camera move at beat 3) in `slides.spec.ts` SAMPLES. The spec now waits for `:is(svg, canvas)` and checks `[data-beat]` anywhere in the figure. For the scene it checks that every beat's canvas frame is different, with the labels hidden during the grab, so the meshes really draw. The whole `slides.spec.ts` passes (49 tests). The full-screen test's `.pinned-figure svg` locator needed `.first()` (beatsCell has nested svg parts).
- **Sizes:** `cards.html` grew from 4.4 to 5.2 MB. `server.mjs` is still 23.4 MB (three.js isn't in it).
- **Tests:** `specs.test.ts` (the guide example parses, label/colour errors), `learnTools.test.ts` (an arrow without `from` gives a readable error; a scene beat beyond the slide's beats is refused).
- **Not done:** 3Dmol.js for PDB proteins (optional, on the roadmap).
- 🧪 **Desktop check.** Does WebGL run in Claude Desktop's card iframe? Does dragging the scene work there? (Without WebGL the figure shows its fallback.)

**Handoff after M83 (2026-10-23).** The M79–M83 drawing roadmap is done and committed. Not yet done: `render.spec.ts` and `step.spec.ts` for the user's end-of-roadmap run, and the user's review of the screenshots in `e2e/tests_output/slides/`.

---

## M84 (T5): grading sends the completed stages once
- With a knowledge boundary (lesson exercises, normal practice), the grading prompt no longer repeats the completed stages as a separate "Completed stages (may be cited)" list; the boundary's `- Learned:` line already has them (same ids and titles, same `completed`/`completed_override` set). The citing rule now reads "Results from the stages on the "Learned:" line of the KNOWLEDGE BOUNDARY below may be cited without proof." About 350-550 tokens less per graded attempt with 40 completed stages.
- Without a boundary (homework, single question, test practice) the prompt is byte-identical to before. `checkGradingPrompt`, the course-facts check (`DISPUTE_RULES`, `settleDisputes`, typed answers) and the M77 `[edge]` label sentence are unchanged. Dead `GradeOpts.completedTitles` removed.
- Tests: `prompts/practice.test.ts` (frozen pre-T5 prompt at eabd051: equal without a boundary in 4 shapes; with one, equal up to exactly the two edits; each completed id once; facts and [edge] text kept; check prompt unchanged), practice engine (no list, Learned line, new rule), server homework and test practice (list still there).

## M85 (R3): BM25 tokens cached per page
- `retrieval/bm25.ts`: `rank` gets each doc's tokens from `tokenCache` (key = doc id, in pagesFor `sha:page`), reused only when the stored text is the exact same `text + " " + summary` string; a re-scan (new summary, new teacher transcription) re-tokenizes. LRU by entries, `TOKEN_CACHE_MAX` 5000, process memory only. df/idf/avg/tf stay per call (they depend on the candidate set). Scores, order and ties are bit-identical.
- Tests: `retrieval.test.ts` "bm25 token cache (R3)": warm == cold (toStrictEqual) and tokens reused, re-scanned summary reorders pagesFor exactly as uncached, 200 random Hebrew/niqqud/Greek/math docs, LRU eviction.

## M86 (R7): append-only lesson history (`.chat_history/<course>/<id>.jsonl`)
- A lesson action no longer rewrites the whole saved lesson. `<id>.json` is now the header (title, type, stage, last-action time, practice state, and the entries saved before this step); new entries are appended to `<id>.jsonl`, one per line. `loadConv` = header entries, then the jsonl lines. The header is rewritten on every action (a few hundred bytes for a lesson) so the list order is unchanged.
- No migration: an old `<id>.json` loads as before, and its entries stay inside it; new entries go to the jsonl.
- `listConvs` reads headers only (no full lesson parse per row). `loadConv` waits behind pending writes, so a resume never sees a half-written line. `createConv` drops a stale `<id>.jsonl`; `deleteConvs` removes both files; `addEntry` after delete still writes nothing.
- An older Shalav on the same folder sees practice sessions fully, old lessons up to this step, and newer lessons without their history (title and date only).
- A crash in the middle of an append loses that entry (and the next one, if it is appended onto the partial line); a sync conflict copy `<id> (1).jsonl` is ignored and reported in Settings.
- Tests: history.test.ts: old layout loads and appends without moving entries; same transcript/checkpoint/MCQ key/graded-exercise entry in both layouts; concurrent appends in order; nothing written after delete; list order; both files deleted; jsonl conflict copy ignored; stale log dropped on create; partial and CRLF lines.

## M87 (R1): index records cached by file signature
- `listFileIndexes` keeps the last parse of each index file (per Fs instance → index dir → file name) and reuses it while `stat` gives the same size:mtime:ctime:inode; it stats before reading, keeps nothing parsed within 3 s of the file's last change (coarse clocks), never keeps a null, drops entries of files that are gone, and returns a structural copy (callers mutate). `readFileIndex` / `writeFileIndex` are unchanged (read-modify-write guards read disk). New `Fs.stat` (nodeFs: node stat; memFs: a content version).
- Files card poll, practice, hints and consult now stat unchanged index files instead of re-parsing them; results are identical.
- Tests: indexStore (fresh-parse equality after write / dropIndex / same-length external overwrite / invalid then fixed; no reads when unchanged; copies; stat failure; two courses; new fs), import (rename keeps the record = fresh parse), node (stat; real disk inside and after the 3 s window).

## M88 (U8): build summary counts newly read files
- `fileTools.indexPending` returns `{ indexed, read }`: `indexed` = every indexed file of the course (unchanged; still gates refine/enrich in `build()`), `read` = this build's files indexed at the end (membership from the `state` map, so removed/edited-away files drop out; status from disk, so failed ones are not counted).
- The build summary says `built from N course file(s)` / `updated from N newly read course file(s)` / `updated (no course file was newly read)` when refine ran with nothing new; "it already covered every topic" stays gated on `indexed`. The refine condition line is unchanged.
- Tests: `fileTools.test.ts` U8 (2 read → 1 more read with 2 indexed → nothing new still refines → a password-protected file fails and is not counted); L86 regex wording.

## M89 (A8): real idle minutes in [STATUS]
- `[STATUS]` "Minutes since last activity" was always 0. Now `idleMinutes(events, active.at, now)` (`learn/recap.ts`): whole minutes (floored, ≥ 0) since the later of the course's newest studying event (stage started/completed/reopened, check, graded attempt, hint, solution, assessment; scan, plan and graph events don't count) and the open lesson's last saved action (`active.at`, set by every `log()`; the saved conversation's `updatedAt` on resume). 0 when there is none. No cap.
- Fresh start: the time since the last activity before this lesson (`s.events` is the snapshot from before `stage_started`). Resume: `[STATUS]` is computed before the "came back" entry. `update_assessment` is 0 (it just wrote). Every other `[STATUS]` line is unchanged; no prompt text changed.
- Tests: progress.test `idleMinutes` (nothing yet, floor, non-studying events ignored, lesson action vs event, clock ahead); tutor.test (only the idle line varies); learnTools.test with `Date` faked (fresh course 0, resume 60 from the saved lesson, lesson_status 0 with the other lines identical, new lesson 90 from the MCQ event).

## M90 (U7): file zones open by default when they fit one page
- `Files.tsx` `latch()`: a zone's `open` is decided at its first non-empty `files_list` (open when ≤ `PAGE` rows), in the same callback as `setD`; it only writes unset zones, so the 1.5 s poll never moves a zone the student (or the default) set. The header, the legend filter (still force-opens) and the empty-zone view are unchanged.
- Tests: `Files.test.tsx` (short open / long collapsed / collapsed stays through polls / grows past a page stays open / empty zone decided later); course.spec updated for open short zones (stickiness checked over 3.5 s in the Translate test). Screenshots: `card-files-open-*` new, the other file-zone shots show open lists.

## M91 (U2): step question pop-up can be left
- `Step.tsx`: the question pill has **Back to the step** at any time (no tool call: the queued question stays, Enter still sends it; the beat on screen stays). After 60 s from Send (between Waiting's 20 s Nudge and the 90 s press-Enter banner) a note says Claude may have answered in the chat (`step.late`, `step.back`; the beat button stays `step.beatPrev`).
- The poll (`step_answer`, every 2 s, skipped while the page is hidden) keeps going after the note, after Back and while beats are revealed, until the answer, a new question, Continue / Explain differently, or unmount; a late answer pops up with its own question (`pending = {q, since}`). The question still carries M78's `beat`. Card-only: no server, prompt or transcript change.
- test-host `?view=step&noanswer=1` (+ `window.__answer = true` to answer). Tests: `Step.test.tsx` (fake timers: note at 60 s, late answer, Back sends nothing, newer `since`, Continue drops it, beat slide: `beat` in the question, arrows ignored in the box, Back keeps the beat and the poll, unmount), e2e step (Back, note, late answer; screenshots `card-step-timeout-*`); slides e2e unchanged and passing.
- The question pill tint went from `bg-primary/10` to `bg-primary/5`: on the light whiteboard it measured 4.48:1 (below 4.5) once axe checked it while shown.

## M92 (R8): the lesson warms the knowledge engine
- `EnginePool.warm(course)` starts the course's tutor-mcp process into a free slot only (never evicts; no-op when it runs or the pool is full; idles out like a used one); `Engine.warm?`.
- `KnowledgeService.warm(n)`: process only (no compute, no engine tool call, no map.json write, `installing` untouched); skipped without an engine or during the 10-min backoff; a failed start sets the backoff like a failed summary.
- `shalav_start_lesson` warms after the stage checks, before the material reads, so the first [STATUS] after the engine idled out keeps "The student's knowledge now" more often. On a machine without the engine the warm may start the one-time download (the lesson's own compute would a moment later; progress in the course card only). Course card, practice and Home do not warm (see DECISIONS).
- Tests: knowledge.test (free slot only, failed start retried; warmed summary = unwarmed summary and engine calls; backoff; start_lesson warms once, first).

## M93 (R2): Files poll slows when idle
- `Files.tsx`: `fast` = `live` || upload (`busy`/`sent`) || `moodle.busy` (install, login, sync) || any row (materials, exercises, teacher) `indexing` or `inBuild`; 1.5 s when fast, 5 s otherwise (`FAST_MS` / `IDLE_MS`). Idle ticks skip while `document.visibilityState` is hidden; `visibilitychange` to visible refreshes at once. Fast keeps polling hidden (its scan cancels a running build's work on files deleted outside). `active` / `wasActive → reload()` unchanged.
- Outside folder changes show within ~5 s (was 1.5 s) or when the window shows again; in-card actions refresh at once as before. Builds still scan at start (`claim`).
- Tests: `Files.poll.test.tsx` (fake timers: idle 5 s, fast 1.5 s per reason incl. hidden, live, fast→idle with one reload, hidden pause + refresh on show); `course.spec.ts` outside-folder wait 4 s → 8 s, U7's Translate stickiness wait 3.5 s → 5.5 s; `Files.test.tsx` poll step 5 s.

## M94 (U1): card errors in the student's language
- `src/cards/errors.tsx`: `errorKey(raw, fallback?)`: an existing i18n key → itself; `aborted` → `job.stopped`; missing course data / attachment, `ENOENT|EACCES|EPERM|ENOSPC|EROFS|EBUSY`, browser download → `errors.courseMissing|fileMissing|disk|download`; else the card's fallback; invalid model output → `errors.invalidOutput`; else `errors.generic`. `ErrorNote`: the sentence in `role="alert"`, the raw message in a closed Details (`dir="auto"`), none for a key. i18n `errors.*`.
- Used by Practice (both error spots), TestPractice (fallback `homework.failed`), Exercise (was always `exercise.failed`), Homework (read: `homework.failed`; AI solve: `homework.solveFailed`, a stop shows `homework.paused`), Course build failure (`plan.failed`; the raw text was a hover title). AddCourse / CustomCourse errors got `role="alert"`. Files keeps `file.*` / `moodle.err.*`.
- Server error strings and card data are unchanged (the model reads them). test-host `?err=<message>` sets the exercise fixture's error.
- Tests: `errors.test.tsx` (keys, rules, fallbacks, keys are plain sentences in he/en, render), e2e exercise (translated key; unknown message → `errors.invalidOutput` + Details).

## M95 (U3): chunked answer uploads
- Answer files (exercise, open question, homework, test scope; `AnswerFiles.tsx`) go through the card-only `attachment_upload_chunk` ({number, id nonce, name, mime, index, total ≤ 15, data ≤ 4 MB base64}); the card sends its prepared blob (resized photo or the original PDF) in 2 MB chunks with a byte bar (`Importing`, label `learn.uploading`). The last chunk calls the same `saveAnswerFile` with the same bytes; `attachment_upload` is removed.
- `src/server/chunks.ts` `chunkedUploads(prefix)`: in-order reassembly in a fresh temp dir (`shalav-ans-` / `shalav-up-`), removed on finish, failure, out-of-order and after 10 idle minutes; `file_upload_chunk` uses it with its old key and replies. Files.tsx progress now divides bytes by bytes (the inner `total` shadowed the byte total).
- A rejected tool call no longer leaves the card stuck on "Uploading…".
- Tests: exerciseTools (3-chunk JPEG = direct `saveAttachment` sha, 3-chunk 2-page PDF = direct `saveAnswerFile` shas in order, same-name parallel uploads, out of order, >12 pages → `grade.tooManyPages`, >15 chunks, temp dir empty), fileTools unchanged; e2e exercise, practice-modes, practice-test, course, lesson.
- 🧪 Claude Desktop: a ~10-page phone PDF from an exercise card (bar, 10 chips, grading sees the pages); two photos at once; a 13-page PDF shows the error and frees the card; no `shalav-ans-*` left in `$TMPDIR`.

## M96 (U6): confirm before skipping an unanswered practice item
- Practice card: "Next question" on an unanswered item (exercise: no grade and not perfect; MCQ: nothing selected; open: no result) opens an inline confirm (alertdialog, focus on "Keep answering", Escape/Keep return focus to Next, a click elsewhere closes it). Test practice text: each question is served once, a skipped one won't come back. "End session" asks only in test practice (the shown question is already burned); in normal practice End never asks. Exercise items read `practice_state` once before deciding (the grade can be ahead of the 2.5 s poll). While an exercise answer is being graded, the confirm says so. Card-only: `practiceSkip.ts` (`unanswered`, `itemKey`); engine, events, server tools, scoring and evidence unchanged.
- Tests: unit `practiceSkip.test.ts`; e2e practice (skip asks / Escape / Keep / keyboard skip, answered Next and normal End don't ask), practice-test (skip text, survives the poll, three skips, End asks).

## M97 (R4): the lesson's course load parses the event log once
- `readJsonlDir` (lib/fs/jsonl.ts) keeps each `*.jsonl` file's parsed lines keyed by its exact text: an unchanged file is not parsed again, an appended one parses only the new lines (after the old text's last "\n"); a rewrite or another device's sync is a new text. Every reader gets it (lesson `load`, `loadCtx` for knowledge/practice/grading, `recomputeProgress`, teacher evidence). No `Fs` change, nothing persisted. Under vitest the cached events are deep-frozen, so a caller that mutates a loaded event fails a test.
- learnTools: `criteria` once per loaded course × stage × rules × language (it does not depend on `now`); the [STATUS] digest's target difficulty reuses `status()`'s graph and control instead of `levelOf`. Every `reduceProgress` call stays as it was (mistake weights decay with `now`).
- update_assessment: 4 full log parses → 0 (hits + one-line tails), one reduce and one graph build fewer; lesson_state polls no longer parse.
- Shared event objects: audited at the plan's base (`eabd051`, incl. M73 facts, M75 control, M76/M77 `interactions()` / `syncEngine` / `missedEdges`): read-only everywhere; `interactions()`' `of()` and `mapEvents` hand out the cached event's own arrays, so an in-place edit there must copy first. At M97 the full suite under the freeze guard (after A8 and R8) found no mutating caller.
- Tests: fs (hit + frozen, external append, same-length rewrite, partial line, truncation, two courses, schema, conflict copy), progress (own append seen), learnTools (golden [STATUS] / update_assessment / lesson_status / lesson card written on the code of the day (after A8 and R8, `Date` faked) before the change and checked against the old code; warm = cold parse).

## Drawing roadmap M79–M83 (agreed with the user, 2026-10-23)
Goal: slides can draw for any course, including unusual ones, in a professional look, with beats.

**Architecture (M79):**
- **Rendering.** Heavy kinds render on the server to SVG: Node/WebAssembly (TikZ, Graphviz, Vega, Pikchr, bytefield, d3-geo) or the server's own Chromium (Mermaid, Verovio, SmilesDrawer, d3-celestial, snapshots). The card stays one small file.
- **Generic beats.** A source line ending with a marker `@n` (in the language's comment syntax) is drawn from beat n; `@n-m` means from beat n until beat m. The server renders one SVG per beat on a fixed canvas, and the card swaps them.
- **Context budget.** The lesson instructions carry only a short catalogue: one line per kind, filtered by course type. A new tool, `figure_guide({ kind })`, returns that kind's conventions and one example when Claude decides to use it. Today's figure formats move into it as well. Render errors list the exact problem and the valid names.
- **CDN check.** A spike tests whether a CDN declared in the card resource's CSP (`resourceDomains`, MCP Apps SDK) loads in Claude Desktop. If it does, big libraries can load in the card only when used (three.js, abcjs).
- **Hebrew.** TikZ, Graphviz and Pikchr labels are Latin/math only; the Hebrew stays in the slide text. Chromium-rendered kinds support Hebrew and get e2e checks for it.
- **Dark mode.** Black in rendered SVG becomes the theme's text colour. The contrast guard (`figures/contrast.ts`) catches the rest.

**Steps (1 commit each, stop after each):**
- **M79:** server rendering pipe + `@n` beat markers + `figure_guide` + course-filtered catalogue + CDN/CSP spike.
  - Biology library: Servier Medical Art (CC BY 4.0, visible credit) + a shading kit (gradients, shadows, textures injected by the card).
  - **TikZ** via node-tikzjax (LPPL-1.3c; circuitikz, pgfplots, tikz-3dplot, chemfig): circuits, physics, mechanics, optics, chemistry, architecture.
  - Redo the photosynthesis and cell samples from library parts; add circuit, inclined-plane and molecule samples.
- **M80:** **Graphviz** (EPL; graphs, automata, trees, data structures, ER) · **Mermaid** (MIT; flowcharts, sequence, state, Gantt, mind maps, timelines, Sankey, git) · **Vega-Lite** (BSD; statistics, economics, finance).
- **M81:**
  - **Annotated course images:** figure crops from the student's PDFs, with arrows, circles and labels by beat (art history, microscopy, historical maps, machines).
  - **abcjs** (MIT; music, with sound) and **svguitar** (MIT; chord charts).
  - **d3-geo** + Natural Earth (public domain; maps for geography, history, politics).
- **M82:**
  - **Pikchr** (public domain).
  - **bytefield-svg** (EPL; packet formats).
  - **d3-celestial** (BSD; star maps).
  - Chess/Go boards from FEN/SGF (own small code).
  - Linguistics syntax trees from brackets.
  - **SmilesDrawer** (MIT; molecules from SMILES).
  - **Verovio** (LGPL; classical scores).
  - Lucide icons (have) / **OpenMoji** (CC BY-SA, credit) pictograms.
  - **Vivus** (MIT; strokes drawn as a beat appears) / **rough.js** (MIT; sketch look).
  - Optional **bpmn-js** (its bpmn.io logo must stay visible); Mermaid covers most of the same need.
- **M83:** **three.js** (MIT): declarative scene JSON (no Claude-written code), with objects and camera viewpoints by beat. Labels are HTML over the canvas, so Hebrew works.
  - Spike first: card size or CDN loading, and WebGL in Claude Desktop.
  - Replaces 3Dmol.js and JSCAD. 3Dmol.js stays an option only for PDB proteins.
- **Later, if wanted:** a sandboxed simulation frame (Matter.js, p5.js) with no access to Shalav's tools.

**Requirements for every drawing (user, 2026-10-23):** text always contrasts with what it sits on; a graph never shifts between beats; used-up parts leave (`until`); beats are tiny steps; drawings look professional and realistic, not plain line art (the old hand-drawn beatsPhoto/beatsCell look was rejected). All tools on the roadmap are approved (three.js after the 2D ones); the Servier credit is OK.
**Run (user, 2026-10-23):** M79–M83 in one go, a commit per step, e2e only at the end for the user to review the screenshots.

**Licenses:**
- All of them are free, including for commercial use.
- Visible credit: Servier and OpenMoji. Visible logo: bpmn-js.
- All others need only a third-party licenses file in the `.mcpb`, generated at build time.
- Record each license in `DECISIONS.md` when the tool is added.

---

## Open items

**🧪 Manual checks in Claude Desktop (user only; see also `ACCEPTANCE.md`)**
- Files poll: a file dropped in Finder shows within ~5 s; minimized then restored shows it at once; scanning chips still move every ~1.5 s during a build.
- Install `dist/shalav.mcpb` on a clean macOS user and on Windows: no API key asked; data folder created; unsigned-extension warning?
- Cards in a real chat: light/dark, he/en, pin floats, banner placement, Back keeps the card, one card on screen.
- Lesson: short step cards one per message, figures, MCQ/open cards, first message teaches with no question, Continue / Explain differently / question each need one Enter; resume with "continue" in a new chat.
- Exercise + solving loop: photo/PDF upload, Claude reads handwriting, clue → re-explain → Thank you, grade card.
- Practice: all 4 modes; homework PDF Save as; Test practice burn + follow-ups; load older sessions.
- Build: Build plan → "▶️ בניית תוכנית" chat works through jobs (several per call); Update plan on course B during A's build joins chat 1; a lesson in a second chat meanwhile; remove a file mid-build and it stays gone.
- Moodle: Chromium download bar → login window → closes → Importing bar; only the course's own files (materials + exams).

**Known limits / not done**
- Knowledge engine: `syncEngine` assigns `m.sent` only after the whole replay loop, so a failure mid-replay (crash, eviction) resends the answers already sent after the backoff (duplicate `record_interaction`); fix = record each event id as it is sent.
- Knowledge engine: `EnginePool` evicts the least-recently-used engine even mid-call; that compute fails and the global `downUntil` turns the engine off for every course for 10 min.
- Knowledge cache: a compute that started before an event can still fill the cache after `onEvent` cleared it (stale until the post-event compute ends).
- `shownStars` drops 0.5★ per compute when raw is more than 0.35★ below the shown stars, so the number of computes (timing) changes the shown stars.
- Jobs, active lesson state and exercise runs are in memory (lost on server restart; saved lessons/practice resume via `.chat_history`).
- Exercise ↔ solution link only within ~5 pages (6-page scan batches); a separate solutions file isn't linked.
- Content generated before a language change stays in the old language until Translate or a rebuild.
- `.mcpb` unsigned, icon a placeholder, release workflow never run, Windows untested (trash, paths, Save as dialog).
- Non-Technion course id formats and Moodle URLs unverified; HUJI/Reichman/Braude Moodle address is pasted by the student.
