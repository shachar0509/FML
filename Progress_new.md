# Progress

**CURRENT PHASE: v2 — MCP connector.** Governing doc: `Shalav — MCP Connector Transition Plan v2.md`. The v1 spec stays normative only where v2 keeps it (data layout §3, plan rules §4, progress §8, prompts §10, figures §11.3, knowledge boundary §6.8).
Rules: work only on branch `dev`; one commit per step with tests; update this file after every step; record silent-spec choices in `DECISIONS.md`; stop after each step so the user can compact. Steps marked 🧪 need a manual Claude Desktop check by the user; list what to check.
Environment: Node 22, pnpm, Playwright chromium. Never store keys in files.

Status: plan v2 §9 (M0–M13) is done, plus follow-ups M14–M60. The v1 desktop app (Tauri, API key, Drive sync, Ask panel) is deleted; it lives in git tag `desktop-v1-final` (= `01640cb`).

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
  - e2e: one spec per card in `e2e/tests/` (`home`, `shell`, `course`, `lesson`, `step`, `exercise`, `practice`, `settings`, `render`). Run only what changed: `pnpm e2e:changed [ref]`, or `pnpm exec playwright test <spec>`. Screenshots go to `e2e/tests_output/<spec>/`; ask the user to check them, delete them on approval.
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

**Files and scanning (M6, M29, M34–M37, M40–M47, M50–M51 + fix).** `files_list` polls every 1.5 s and scans the folders, so outside adds/deletes/renames/edits show by themselves (`stamp` = size:mtime, only changed files hashed; rename keeps the scan; edit = remove + new file; one record per content across both folders). Uploads via `file_upload_chunk` with a byte progress bar. Index queue: 2 files per course, 3 overall, page batches 3 in parallel (output equals serial); text-first PDFs (images only for scans/figures/crops; spacers ≤4 px ignored). Removing or editing a file mid-scan cancels it and withdraws its jobs. Card: collapsed lists, scan-state legend that filters, split ring, 10 per page sorted by `Intl.Collator`, subgrid rows, ⋯ menu (Open, Re-scan, Delete with inline confirm), solved/unsolved exercise counts, "waiting to scan" during a build.

**Moodle import (M14b, M17a–c, M24–M24c, M36, M39).** Shalav's own Chromium (downloaded once in-process into `<config>/browsers`, ~186 MB, progress bar); login window for SSO/MFA, then cookies copied and the import continues headless on profile `moodle-profile-chromium`. Login check needs the logout link (Technion gives guest access after expiry). Search by number (whole number, 6-digit legacy, combined "02340114/7", tiles parser), up to 5 courses (main, groups, hidden), all sections; links before the first section and admin pages ignored; `filename*` and UTF-8 names decoded; 4 requests in parallel. `briefRole` sorts files by the first 2 pages' text (no AI) and drops video lists and course-admin files. Not verified on a logged-in Technion course page (`parseCourse` sections).

**Learn (M7, M16–M18, M20a, M25c–d, M49).** `shalav_start_lesson` returns tutor instructions (MCP rule 10, teach first then quiz), `[STATUS]`, materials excerpt, boundary, recap. Content goes through `teach_step` cards (≤ ~900 chars, Continue / Explain differently / I have a question → `answer_question` popup); "Explain differently" blocks quiz tools until the next `teach_step`. Tutor tools under v1 names: `present_mcq`, `ask_open_question` (text and/or photos/PDF), `assign_exercise`, `record_check_result`, `update_assessment` (returns fresh `[STATUS]`), `consult_materials`; plus `show_figure`. Lesson card: objectives, mastery, Complete stage / Complete anyway (lists missing), Next stage, Learn again. When the materials' language differs from the settings language, quotes keep the original wording plus a translation.

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
- Every lesson and practice session is saved under `<data folder>/.chat_history/<course>/<id>.json`, one file each. The files survive closing Claude Desktop, and copying the data folder to another computer takes them along. Each one has a title, a type and the time of its last action (a slide, a question, an answer, a button press). Writes to one file go one at a time, so a slide and a click arriving together both land. A deleted conversation is never recreated by a late write.
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

## M61: student knowledge graph — engine + gentle layer (M61–M65 in progress)
Plan: `~/.claude/plans/when-a-job-is-flickering-hellman.md` (approved; read it first). Engine = **tutor-mcp v0.6.1** (Go binary, MIT; BKT+FSRS, misconceptions, next-activity). Shalav's event log is the truth; the engine is derived.
- `src/core/domain/knowledge/graph.ts`: nodes from plan stages (concept/theorem/technique/edge), id `S003/kind/fnv1a(label)` (`G/…` = course-wide), `requires` edges (prereq stages + in-stage concepts); `graphOf` adds `node_added`/`node_linked` events; `engineNames` (engine concept name = unique label, kept once given).
- `control.ts` (gentle layer): per node decaying average of answers (half-life 12 answers, prior K=3 that fades; custom level prior 1→0.05 … 5→0.85, academic 0.1); legacy stage-level answers count at half weight; `assessment_updated` 0.2 weight; `rawStars` × engine retention; `shownStars` hysteresis (up at next half star, down only 0.35★ below); `questionStars(d, m)=round(d+2(0.5−m))`; `targetDifficulty(m, stretch)` → ~3★ (4★ stretch).
- Events (`dataSchemas.ts`): optional `nodes: {id, score}[]` on `check_answered`/`attempt_graded`; new `node_added`, `node_linked`, `node_observed`. `mapEvents` remaps node-id stage prefixes on `plan_replaced`. `store.onEvent` listener.
- `src/server/knowledge/`: `install.ts` (download per OS/arch from GitHub release, SHA256SUMS pinned, `tar -xf`, into `<config>/engines/`), `engine.ts` (`EnginePool`: one process per course `--local --data-dir`, idle 10 min, max 2, calls serialized), `knowledge.ts` (`createKnowledge(engineFor|null)`: per-device dir `<course>/.shalav/knowledge/<device>/{map.json, engine/}`; syncs plan+tutor nodes → `init_domain`/`add_concepts`/`set_goal_relevance`, replays unsent answers → `record_interaction`; `summary(n)` = graph, control, retention, shown stars, examReady, focus, misconceptions; falls back to log-only for 10 min on engine error). `main.ts` wires the real engine; `createServer(…, knowledge)` defaults to log-only (tests never download).
- Spike facts: BKT swings (8–30 good → 0.94; 2 misses → 0.51 → 0.27), hence the gentle layer; answers without the assessment-attempt protocol are "unverified" (we use estimate + `retention_estimate`); no API to seed mastery (prior is Shalav-side).
- Tests: `knowledge.test.ts` (core, 12) and `src/server/knowledge/knowledge.test.ts` (fake engine, fallback; real binary with `TUTOR_MCP_BIN=…/tutor-mcp`).

**Next (not started):** M62 node-tagged evidence (grader `nodeResults`/`newNodes`/`sameAs` by local numbers, tutor `update_knowledge_graph` tool + `present_mcq`/`ask_open_question`/`record_check_result` nodes, generator/indexer nodes) → M63 migration (stage mastery from control with max(old) guard; select/targetDifficulty/itemKind/weak/focus from knowledge) → M64 Customized practice for custom courses (`upto` scope, 2 options, all units with disabled ones) + tutor digest → M65 stars UI (questions frozen at serve, course card stars + exam-ready), web gathering at current+next level, i18n, e2e.

---

## Open items

**🧪 Manual checks in Claude Desktop (user only; see also `ACCEPTANCE.md`)**
- Install `dist/shalav.mcpb` on a clean macOS user and on Windows: no API key asked; data folder created; unsigned-extension warning?
- Cards in a real chat: light/dark, he/en, pin floats, banner placement, Back keeps the card, one card on screen.
- Lesson: short step cards one per message, figures, MCQ/open cards, first message teaches with no question, Continue / Explain differently / question each need one Enter; resume with "continue" in a new chat.
- Exercise + solving loop: photo/PDF upload, Claude reads handwriting, clue → re-explain → Thank you, grade card.
- Practice: all 4 modes; homework PDF Save as; Test practice burn + follow-ups; load older sessions.
- Build: Build plan → "▶️ בניית תוכנית" chat works through jobs (several per call); Update plan on course B during A's build joins chat 1; a lesson in a second chat meanwhile; remove a file mid-build and it stays gone.
- Moodle: Chromium download bar → login window → closes → Importing bar; only the course's own files (materials + exams).

**Known limits / not done**
- Jobs, active lesson state and exercise runs are in memory (lost on server restart; saved lessons/practice resume via `.chat_history`).
- Graded lesson exercises are not logged in `.chat_history` (M60).
- Exercise ↔ solution link only within ~5 pages (6-page scan batches); a separate solutions file isn't linked.
- Content generated before a language change stays in the old language until Translate or a rebuild.
- `.mcpb` unsigned, icon a placeholder, release workflow never run, Windows untested (trash, paths, Save as dialog).
- Non-Technion course id formats and Moodle URLs unverified; HUJI/Reichman/Braude Moodle address is pasted by the student.
- Unused v1 i18n keys remain in `he.json` / `en.json`.
