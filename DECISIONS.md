# Decisions (where the spec was silent)

- TypeScript pinned to 5.9 (spec says TS 5; typescript-eslint does not support 7 yet).
- Toasts use a small own zustand store instead of sonner.
- Settings persist via plugin-store inside Tauri, localStorage in a plain browser (dev/tests).
- Until onboarding is completed every route redirects to /onboarding.
- Bundle targets include "app" so the dmg can be built on macOS.
- Plan validation uses the 4.4 stage range with ±15 % slack (same tolerance Pass A accepts after two failed corrections), otherwise the two rules would contradict.
- `estimatedMinutes` returned by the model is rounded and clamped to 20-45 instead of failing the whole plan.
- Pass A prerequisites that are out of range or point forward are silently dropped (the DAG rule must hold).
- `initialProgress` (all stages locked except prerequisite-free ones and S001) is a stand-in for `reduceProgress` until Step 6; `progress.md` is also written from Step 6 on.
- Catalog `last_semesters.json` failures fall back to scanning years from 2026 down to 2023 only if the file is unavailable.

## Step 6 — Progress
- `coveredObjectives` are **0-based** indices into `stage.objectives` (spec says "objective index" only); the Step 9 tutor tool must send 0-based.
- `totals.attempts/correctAttempts` count `attempt_graded` events once (not per stage); per-stage counters count per stage. `unreadable` attempts are ignored everywhere. `edgeCaseCorrect` = correct attempts with `hasEdgeCaseFocus`.
- `check_answered` mistake tags use `checkId` as the example's `attemptId` with an empty note; `mistake_observed` likewise uses `refId`.
- `resolved` counts `attempt_graded` with score ≥ 85 strictly newer than the tag's last occurrence (fixed 85, not the Settings bar).
- Integration / exam-prep exercise count = `minExercises + 1` (spec's "3" with default 2).
- `computedAt` is ignored when deciding whether `progress.json` changed; mistake `weight` decays with time, so it can still trigger a rewrite on recompute (rounded to 3 decimals).
- `progress.md` has no timestamps so unchanged content is not rewritten.
- Events with a stage id mapped to `null` by `plan_replaced` are dropped; unknown stage ids (not in the plan) are ignored.

## Step 7 — Ingestion
- Files the user drops that are HEIC on macOS are converted to a temp JPEG and imported under the temp name (Rust `heic_to_jpeg` returns a temp path; spec silent).
- `scanCourse` treats a file with an already-known hash but a missing old path as a rename (updates the record) rather than a duplicate; a same-hash second copy is ignored.
- `plan_replaced.idMap` includes identity entries for unchanged stages; all parts of a split stage (including the one keeping the id) get fresh Pass B details.
- Indexing progress counts request batches, not pages.
- >60-page confirmation uses the native `ask` dialog; declining leaves the record `pending` until Retry.

## Step 9 — Learn
- Tool outcomes (MCQ choice, open answer, skip, consult result, assessment result) are stored as `ui` session lines whose `widgetId` is the tool_use id; the follow-up user message of `tool_result`s is built from them. A turn with non-blocking tools only is continued automatically; blocking widgets pause it.
- Hidden control texts (`[START_LESSON]`, `[RECAP]`, `[REOPENED...]`) are stored as ordinary user messages and hidden in the UI; `[RESUME ...]` is added per request only, never stored.
- A Stop leaves an assistant text `<partial>\n\n[stopped]` in the transcript.
- Tutor teaching language = UI language (Settings has no separate field yet).
- Web fallback in retrieval uses the 10.10 addendum as the system prompt (not the "answer only from pages" prompt).
- Brief for a course with no indexed material files is stored with coverage "none" and no API call.

## Step 10 — Practice
- Practice session state is one snapshot `ui` line (`widgetId: "state"`, latest wins) in this device's `sessions/practice/<deviceId>.jsonl`; counters come from its `results`. Other devices' practice sessions are not resumed.
- Item index increments when an item is produced (prefetched items count). Queued MCQ/open items are discarded when scope or the completed-stage set changes; queue is only consumed by kind (mcq for M, open for O).
- If exercise generation fails twice, the best eligible indexed/generated exercise is served even below 0.45; if none, an MCQ is substituted (7.4/7.5).
- Material digest for hints/solve/generation = the cached lesson brief of the exercise's first required stage (≤700 words, not 600), instead of a per-call retrieval.
- Difficulty for generated exercises = `round(targetDifficulty)`; exercise `type` follows course kind (proof-based→proof, programming→coding, else computation).
- Generated exercises carry `gradingNotes` (schema default ""), and `generated/<deviceId>.json` has `solutions` (default {}); both are backward-compatible.
- Learn `assign_exercise`: card state is a `ui` line `ex:<tool_use id>`; a readable graded attempt answers the tool call with the full grade JSON + hintsUsed + solutionRevealed; the tutor continues when the student presses Continue (or writes). Unreadable attempts do not answer the tool. No "Try again" in Learn.
- Check grading (open answers) uses the grading model without extended thinking; MCQ results record no mistake tags.
- PDF solution uploads are rendered to page JPEGs at upload; more than 12 pages throws `grade.tooManyPages`.
- "Learn again" in the practice summary only appends `stage_reopened` and navigates to the stage (no tutor message is sent until the student writes).

## Step 11 — Settings + Ask
- Tab label keys moved from `settings.<tab>` to `settings.tabs.<tab>` (nested sections needed the names).
- Cap dialog is the native plugin-dialog `ask` with custom labels; "Continue anyway" lasts until restart; month spend is read from usage.jsonl on first request, then accumulated in memory.
- Ask outside a course has no boundary and no tools; inside a course (not Learn) the boundary has no current stage; consult uses the Learn stage, else the first plan stage.
- Remove API key has no confirm dialog (spec silent).

## Step 12 — Sync
- Initial connect takes `startPageToken` before listing, not after (duplicates are no-ops by sha; avoids a missed-change window).
- `conflicts` (last 20 conflict copies) added to sync-state.json for the Sync tab.
- Remote-deleted + locally unchanged goes to OS trash via `trash_path`; local-edited re-uploads as new file.
- Per-device-append conflicts: owner id is the file basename; `shalav.json` compares `updatedAt ?? createdAt`.
- Unknown paths default to user-file (keep-both).
- Spec 18.1 fixtures: tests build fake tool responses inline (typed, zod-validated at use) instead of reading tests/fixtures/claude/*.json.

## v2 — MCP connector transition (2026-10-20)
- Product pivots from a Tauri desktop app (BYO Anthropic API key) to a local MCP connector for Claude Desktop, so students use their existing Claude subscription. Reason: providers don't allow third-party apps to spend consumer subscriptions via API; MCP tools/apps inside the user's own AI app are allowed. Governing doc: `Shalav — MCP Connector Transition Plan v2.md`.
- One-shot AI tasks keep the v1 domain code through `BridgeGateway` (host model answers parked `ClaudeGateway` requests as jobs) instead of rewriting them per feature; MCP sampling is optional, not required (host support unverified).
- Tutoring and Ask run in the host chat; v1 tutor tool schemas become MCP tools; v1 session transcripts/compaction are dropped (the host owns the conversation); resume recap comes from events.
- Primary host: Claude Desktop via MCPB (bundled Node). claude.ai web/ChatGPT need a remote server — out of scope for v2.
- Built-in Google Drive sync dropped; data folder may live in any desktop-synced folder (v1 per-device file design already avoids most conflicts).
- PDF indexing becomes text-first (images only for scanned/figure/exercise pages) to save subscription usage — deviation from v1 §5.4.
- v1 is preserved at git tag `desktop-v1-final`.
- M0 dependency versions (exact pins, each released ≥2 weeks before 2026-10-20 unless noted): `@modelcontextprotocol/server` 2.3.1, `@modelcontextprotocol/core` 2.3.1, `@modelcontextprotocol/client` 2.3.1 (dev, for in-memory tests), `@modelcontextprotocol/ext-apps` 2.0.3, `@napi-rs/canvas` 1.0.10 (1.0.11/12 newer than 2 weeks), `vite-plugin-singlefile` 2.3.3 (2.3.4 was 3 days old), `esbuild` 0.28.2. The MCP TypeScript SDK split into v2 packages `@modelcontextprotocol/{server,client,core}` (stdio transport at `@modelcontextprotocol/server/stdio`); ext-apps 2.x peers on those (`^2.0.0`) and on zod `^4.2.0` (we have 4.6.7), so the legacy `@modelcontextprotocol/sdk` 1.x is not used. pnpm 11 needs `pnpm-workspace.yaml` `allowBuilds: { esbuild: true }`.
- M4 cards: one Vite single-file build (`vite.cards.config.ts` → `dist/cards.html`, ~940 KB with Heebo inlined) served as `ui://shalav/cards.html`; `server.mjs` finds it next to itself (or `../../dist`, or `SHALAV_CARDS_HTML`). All MCP Apps bridge calls live in `src/cards/host.ts` (`Host` interface); views get a `Host`, so Playwright uses a fake one (`src/cards/test-host.tsx`, served by the dev server). Card buttons that need AI use `host.say()` (= `app.sendMessage`) with a short friendly line; the card language comes from `structuredContent.language` (settings), theme from hostContext first, then the setting. Home view is new code in `src/cards/views` (copy of the v1 ring/card), v1 screens are untouched until M12.

## M5 — Courses and plan
- Create/retry are bridge operations started by app-only `*_request` tools that return immediately; the card polls `course_status` every 2.5 s instead of holding a long tool call (a long call would block the iframe and hit host timeouts).
- Card navigation (open course, add course) is card-side via `callTool` and does not touch the chat; only AI work puts a line in the chat (`mcp.buildPlan`).
- `shalav_next_job` waits up to 20 s for a running operation to park its first request (the card-line → model → tool call can outrun the server's first fs work).
- `course_create_request` re-looks the entry up server-side (7-day cache) rather than trusting card-supplied catalog text; manual entries come from the form.
- Catalog preview shows the label "Catalog description" and the "plan is built after adding" note (plan v2 §6.2); the stage detail drawer of v1 became inline expansion of the stage summary.

## M6 — Files and indexing
- Import never enqueues indexing; the card's **Start indexing** (`files_start_indexing`) does, as one `bridge.run` op that waits for the queue to go idle, so `shalav_submit_job` keeps returning the next job. Reason: indexing spends the student's subscription (plan §6.6). Failed files are retried by the same button. No separate Re-index of an already indexed file (YAGNI; Remove + add again).
- The >60-page confirmation dialog of v1 is dropped (Start indexing is the confirmation).
- No server-side `fs.watch`: `files_list` runs `scanCourse` on every call (card open, and each 2.5 s poll while indexing/improving), so files dropped into the folder show when the card is opened/refreshed. Add `fs.watch` only if the delay annoys.
- Upload: raw 2 MiB slices (base64 stays under the 4 MB tool-arg cap), appended in order to a temp file named after the original file, then v1 `importFiles`; an out-of-order chunk is an error and the card shows the status.
- Improve plan = app-only `plan_improve_request` running v1 `refinePlan` as a bridge op; failure is shown in the card (`improving.state = failed`), the old plan stays.
- Passing `text-success` as text colour fails WCAG contrast on light; status "Ready" uses a check icon + normal text.
- `dist/server.mjs` grew to 3.6 MB (pdfjs legacy now reachable through `openSource`).

## M7 — Learn
- The host chat is the lesson; `Lesson` engine/session files/compaction stay untouched (desktop v1, deleted in M12). Event logic was ported into `src/server/learnTools.ts` handlers (same events, same tag normalisation, same criteria).
- The tutor tools keep their v1 schemas, which carry a `stageId` but **no course number**, so the server keeps one in-memory *active lesson* `{course, stage}` set by `shalav_start_lesson`. After a server restart tutor tools answer "No lesson is open. Call shalav_start_lesson first."
- Question cards are not blocking tool calls: `present_mcq`/`ask_open_question` return at once with a card and a server-generated `checkId` (ULID, also the `checkToolUseId` for `record_check_result`); the answer key (`correctIndex`, explanation) stays on the server and is returned only by app-only `check_answer`. The `checkId → key` map is in memory (lost on restart; the card then shows an error). A second press on an answered MCQ returns the stored result and records nothing.
- The student's answer goes to the model as a chat line ("My answer: B) …" / the open text), sent by the card with `say()`; no `<student_answer>` tags in the visible line.
- `consult_materials` and the lesson brief: always raw BM25 pages (≤ 6,000 chars, wrapped in `<materials>`), never a bridge retrieval job. The host model is the tutor, so an extra summarising job only costs subscription and a round trip; web fallback is dropped (the host can search). `getLessonBrief`/`consult` stay for desktop v1.
- `tutorSystem` got an `mcp` flag: rule 10 is replaced as in plan §6.3 plus card/Complete-button wording, and the figure-format block is omitted (chat and cards cannot draw them). v1 text is unchanged when the flag is off.
- `shalav_lesson_status` returns the v1 `[STATUS]` block (idle minutes = 0) plus "criteria met: yes/no". `shalav_start_lesson` appends `stage_started` only for an `available` stage, refuses locked stages, and for a completed stage returns the review card without tutor instructions. Recap (`domain/learn/recap.ts`) comes from the stage's last assessment, check counts, graded scores and a reopen flag.
- Until M8 `assign_exercise` is not registered; the start text tells the model to use `ask_open_question` for written problems. Without graded attempts the criteria cannot be met, so students finish with **Complete anyway** for now.
- Cards: `Next stage` / `Learn this stage again` are chat lines (`mcp.learn` / `mcp.relearn`); the model then calls `shalav_start_lesson`. The lesson card polls app-only `lesson_state` every 4 s so it follows the tutor's progress updates.
- Cards bundle now renders Markdown + KaTeX: `./CodeBlock` and `./Figure` are aliased to stubs in `vite.cards.config.ts` (no Shiki/mermaid; fences show as plain code), and KaTeX CSS is trimmed to woff2 only. `dist/cards.html` 0.97 → 1.77 MB.
- Open-question attachments are not offered yet (`attachment_upload` arrives in M8).

## M8 — Exercises and grading
- `assign_exercise` keeps its v1 schema and returns an Exercise card at once (not a blocking call). Source `index` resolves through `resolveExercise`; `new` builds a `tutor` exercise from `statementMd`/`referenceSolutionMd`. The reference solution never goes into the card data.
- Grade / Hint / Show solution are app-only `*_request` tools (`exercise_grade_request`, `exercise_hint_request`, `exercise_solution_request`) that start the v1 `ExerciseRun` as a `bridge.run` op and return at once; the card then puts a chat line (`mcp.grade/hint/solution`) so the model calls `shalav_next_job`, and polls app-only `exercise_state` every 2 s until `busy` clears. The final `shalav_submit_job` result carries the grade JSON (plus hintsUsed/solutionRevealed) and, in Learn, "continue the lesson, then update_assessment". Unreadable photos return a short "ask for a clearer photo" note and no score (v1 rule).
- Run state (hints, grade, solution) is in memory only (`ExerciseRun` with a no-op save); events (`hint_requested`, `attempt_graded`, `solution_revealed`, tags) are persisted as in v1. After a server restart the card says "expired".
- `attachment_upload({number, name, mime, base64})` takes a course number (the plan's signature had none; Practice in M9 also needs it) and reuses v1 `saveAnswerFile` (images → JPEG 1568, PDF → page JPEGs, max 12). The card shrinks photos itself first (canvas, long edge 1568) so the upload stays small; one call per file, no chunking (cap 40 MB base64).
- Hints/solutions use a raw BM25 digest (≤ 4,000 chars) through the new optional `Env.digest`, not a lesson-brief job: same reasoning as M7, one host round trip less. Desktop v1 is unchanged (no `digest`).
- Open-question attachments are not built: Claude Desktop accepts images pasted in the chat itself, and server-stored images could only reach the model through a job. Exercises (the real written work) do have uploads.
- The Grade card is the v1 `GradeCard` component, imported as-is (step labels are plain text, so `$…$` in a label is not rendered; same as v1).

## M9 — Practice
- **No prefetch.** The v1 engine prefetches the next item; over the bridge that parks a job nobody fetches until the next chat line, so `Practice.prefetchOn = false` on the server. Each Next may therefore need a short wait for Claude (the card says "Preparing…" and sends one chat line). Revisit if the real check shows it is slow.
- Practice exercise items reuse the engine's own `ExerciseRun` (registered through `exercises.adopt`) instead of `exercises.open`, so results land in the session counters.
- Open practice answers are text only (no attachments), same as Learn open questions.

## M10
- `shalav_context` takes no stage-state from the lesson: stageId defaults to `progress.currentStageId`; the boundary is the v1 function unchanged. A bare call with several courses asks which one.
- Conflict copies are detected by file name only (json/jsonl/md); a copy is never merged or deleted by Shalav, only ignored by `readJsonlDir` and listed in the settings card.
- The settings card does not edit the data folder (plan §6.8); the other v1 settings fields (models, usage, sync) stay in the schema, ignored.

## M11
- MCPB manifest version 0.3 (the validated schema in `@anthropic-ai/mcpb` 2.1.2). The `language` user_config is a free string (the schema has no enum); `initNode` accepts only `he`/`en` and uses it for the first run only, so the settings card stays the owner afterwards. `data_folder` always wins over a saved `dataRoot` (it is the user's explicit extension setting).
- Only darwin-arm64, darwin-x64 and win32-x64 canvas binaries ship (plan §10); Windows on ARM and Linux are out of `compatibility.platforms`. Binaries come from `pnpm-workspace.yaml` `supportedArchitectures`, so one Linux CI runner builds the whole package.
- The .mcpb is unsigned (no certificate); `pdf.worker.mjs` and `standard_fonts/` sit next to `server.mjs` because pdfjs resolves them relative to the file that bundles it.
- Claude Code install is documented as clone + build + `claude mcp add`, since there is no published npm package.

## M12
- Kept `claude/{types,errors,structured,tools,practiceTools,tutorTools,fake}` and `prompts/*` except ask/summary; dropped the v1 gateway/models/cache (the bridge replaces them).
- Kept the `learn` dir only for `recap.ts`; the old transcript engine is deleted (history in tag `desktop-v1-final`).
- Kept localStorage fallback in `lib/storage.ts` for the card dev page and tests.
- Server files stay flat (`src/server/*Tools.ts`) instead of `server/tools/`.

## M13
- Nudge button after a fixed 20 s (no per-card tuning). Role `status` stays on the parent; `Waiting` uses `aria-live` only.
- Text hosts: the course/files tools are model-visible instead of adding duplicate "text" tools; upload, photo grading and chunk tools stay card-only.

## M14a
- Course id format: Technion strict (8 digits); HUJI/Reichman/Braude formats could not be verified (web search found nothing official), so they accept short alphanumeric codes and uppercase them. Tighten per university when real numbers are known.
- The university is stored in `shalav.json` (shared by all devices on the data folder), not per device, so two machines cannot disagree. No in-app reset: deleting the data folder is the reset.
- Prompts use `uniName()`; module-level constant prompts say "university" generically.

## M14b
- Moodle via the student's installed Chrome (not a bundled browser: MCPB size) with a persistent profile; no passwords or cookies are handled by Shalav code, and nothing is written outside the browser profile except a "logged in once" marker file.
- One import tool runs login+sync as a background job (MCP calls time out); progress is read through files_list.
- Unknown Moodle addresses are asked from the student instead of guessed.

## M15 — card requests
- No full automation: Claude Desktop's `ui/message` fills the composer only (claude-ai-mcp#1111), sampling is not offered, and `updateModelContext` does not start a turn. Skills don't help either (Claude runs them inside a turn the student started, and an MCPB can't ship one). The student presses Enter once per action.
- The composer shows one fixed word ("▶️ המשך") instead of a request text, because the student asked not to see prompts. The request itself lives in a server-side inbox (last 5, in memory), and the server writes its text from an enum kind. The card never sends free text, except the student's own answer, which goes inside an `<answer>` block.

## M16 — figures in lessons
- Figures go through a tool (`show_figure`) and a card, not fenced blocks: Shalav does not render Claude's chat text. Only plot/geometry/SVG are in the card bundle; Mermaid + WaveDrom would make every card 9.4 MB instead of 3.3 MB. SVG covers trees, automata and circuits.

## M17 — plan on demand
- "Build plan" always ends with a coverage refine (when files are indexed) instead of building the plan straight from the files: indexing maps pages/exercises to stage ids, so a plan must exist first. Refine never deletes stages, so progress survives an update.
- AI jobs before card requests in `shalav_next_job`: the build only advances while Claude is inside a turn; lessons and grading wait until it finishes (Claude cannot run two things at once in one chat).

## M18 — Lesson content in step cards, length enforced by the server
- The student found the chat lessons too long and the plain chat text less readable than the cards. Lesson content now goes through `teach_step` (a card per step) and the server refuses steps over ~900 characters, because a prompt-only rule ("teach slowly") was not followed reliably. Continuing still needs one Enter per step (Claude Desktop cannot start a turn from a card, see M15).

## M20 — A `rows` block instead of Hebrew inside KaTeX
- Board layouts put a Hebrew name beside each aligned formula. KaTeX has no Hebrew metrics and lays `\text{}` out left to right, so names inside `aligned` render badly. A fenced `rows` block keeps the names as normal (bidi-correct) text and renders each formula's lhs / relation / rhs in a CSS grid, which also lines the relations up across rows. Boxes reuse GitHub-alert syntax (`> [!theorem]`) so the Markdown stays readable as plain text.

## M64 — Customized practice generates; the engine only reorders
- Customized practice (custom courses) always generates a new exercise, as asked ("a loop of generated exercises"); an existing course exercise is served only when generation fails, so the loop never stops for one bad job. Normal practice keeps the full mix.
- The engine's focus/misconceptions/reviews only add a bonus to the focus stage (+0.5); they never pick outside the scope, and practice works the same without the engine.
- The tutor's digest waits at most 5 s for the engine; a slow engine drops the digest for that [STATUS] instead of stalling the lesson.
