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

## M61 — Deviations from the approved knowledge-graph plan (recorded in M75; they were only in Progress.md and code comments)
- The prior's K=3 pseudo-answers fade with the answer count (so full control is reachable), and answers from before M62 (no `nodes`) count for all their stage's nodes at half weight. The plan's formula had a fixed prior.
- Engine data lives per device: `<course>/.shalav/knowledge/<device>/{map.json, engine/}` (two engines writing one synced SQLite file would corrupt it; the log rebuilds it). The star hysteresis is kept in `map.json`, not `level.json`. The binary is installed in `<config>/engines`, not the data root's `bin/` (one per machine, not synced).
- Without an engine, stars are still shown, from the log alone (no forgetting). The plan said cards show no stars then; the log is the truth, so a missing engine only loses forgetting.
- `get_next_activity` and `check_mastery` are not called: the focus comes from `get_olm_snapshot.focus_concept`, and mastery thresholds are Shalav's own (criteria.ts), so Shalav never depends on the engine's fast BKT estimate for a level.
- The cards have two `Stars`: the clickable picker in `CustomCourse.tsx` (self-rating) and the read-only display in `ui.tsx` (M65). Different jobs, so not merged.

## M75 — Control: two speeds (the plan's required behaviour, exactly)
- No single half-life meets both "30 good + 2 misses drops ≤ 0.08" (needs ≥ ~28 answers) and "8 of the last 10 missed → < 0.5" (needs ≤ ~7). M61 used 12 and loosened the tests to fit (< 0.13, < 0.6), failing both. Now: a long memory (36 answers) normally, and in a slump (≥ 5 misses, score < 0.5, in the node's last 10 answers) the lower of it and a short memory (6). Results: 2 slips −0.078; 8 of 10 → 0.42; steady 80% stays 0.78–0.81; after 10 misses, 10 good answers bring it back from 0.38 to ~0.74. The prior fades with a 12-answer half-life as before, so a new student rises as fast (10 good → 0.86).
- The cost: the 5th miss in 10 drops the node in one step (0.83 → 0.55). Course stars average all nodes and have hysteresis, so they absorb it; a question's stars on that node can jump.
- "Shown stars never drop after 1-2 misses" holds when the misses hit some of the course's nodes (tested with 3). If they hit every node (a one-stage course, untagged legacy answers), 0.078 × 5 = 0.39★ can cross the 0.35★ hysteresis by a hair, as the plan's own 0.08 limit would.
- Control is Shalav's, not the engine's: the engine's BKT keeps no history (the M61 spike: two misses after 8 or after 30 correct answers alike drop it 0.94 → 0.27), so it never gets gentler with use; only its FSRS retention improves with a long history, and that is applied on top.

## M76 — Engine gaps (tutor-mcp v0.6.1, tools checked on the real binary)
- High-stakes: `mark_domain_high_stakes(domain_id)` exists (idempotent, one-way). Academic courses call it once after the domain exists (also for domains made before M76); map.json records `highStakes`. It blocks "demonstrated" claims and intrusive suggestions without a human-reviewed evaluation; Shalav sends only unverified observations and reads estimates, so nothing it shows changes. (`init_domain` also takes `high_stakes`; one path for new and old domains is simpler.)
- Plan revisions: `publish_curriculum_revision` exists but is not used. It takes engine concept ids, one operation per call (rename / update_metadata / split / merge / remove / repair_prerequisites), `remove` is leaf-only, and update_metadata resets estimates. New nodes go through `add_concepts` with `expected_version` as before. A node the plan no longer has stays in the engine but never surfaces: retention, focus and misconceptions are read only for nodes of the current graph, and stars / exam-ready / due reviews iterate the graph. A stage renumbered by Update plan (`plan_replaced` id map, `S003/…` → `S004/…`) keeps its engine concepts: each new id map is applied once to map.json's id → name keys (`moved` counts the applied ones; missing = all, as names were never remapped before), so the history carries over instead of a duplicate "label · stage" concept, also when a label repeats in several stages. Nodes of a removed stage, and an old id a moved stage took over, are kept as `gone/<id>` so their names are never given to another node. Prerequisite changes between existing concepts are not sent (the engine is only used for focus/retention/misconceptions).
- Re-seed: map.json keeps `engine` (the release that holds `domainId`; missing = v0.6.1, the only release before M76, so no user re-seeds on rollout). A different release → `delete_domain` (a tombstone; best-effort) and a fresh domain from the log. An engine error saying the domain is unknown (`domain not found`, `get domain by id … no rows` from get_olm_snapshot, `curriculum version not found` from get_curriculum_snapshot) → reset domainId / sent / highStakes, keep the names, sync again once (the new domain gets every node's goal relevance, not only new nodes'); a second failure falls back to the log for 10 minutes as before.
- Install progress: the course card shows "Preparing the study engine (once, n%)…" while the one-time download runs (the knowledge service's `installing`), and reloads every 3 s meanwhile. The download starts on the first summary of a course with a plan.

## M77 — Closing the knowledge-graph plan
- The tutor's `assessment_updated` gaps reach the engine as failed `DIAGNOSTIC_ASSESSMENT` interactions (`KNOWLEDGE_GAP`, the gap in `notes`), not as misconceptions: a gap is free text, and as `misconception_type` every assessment would add rows to the course card's watch list and the digest. A gap counts against the stage node whose label it contains (or that contains it, normalized), else the stage's first node (one miss per node per assessment). The tutor repeats a stage's current gaps on every `update_assessment`, so a gap is sent only when it appears (or reappears after being dropped). Its `mastery` is still not sent; Shalav's own control is unchanged (the 0.2-weight nudge).
- `edgeCasesMissed` matches the exercise stages' edge nodes by label containment (normalized; under 4 characters only an equal label, so a one-word item doesn't hit unrelated nodes), and the grader is told to copy an [edge] node's label exactly. A matched edge node scores 0, in the engine and in control (weight 1), also when the grader didn't tag it; an attempt with no node tags still counts for its stage at half weight.
- A check's first mistake tag goes to the engine as `misconception_type` on its failed nodes (`LOGIC_ERROR`), as attempts already did.
- Web gathering (custom courses) names the engine's focus, then the 5 weakest nodes the student has answered on, as topics to weight more, within the per-unit spread. Before any answer nothing is added, not even the focus (every node sits at the prior, so "weakest" would just be the first plan nodes).
- Dropped from `update_knowledge_graph`: rename and `part_of`. Nothing would read `part_of` (`graphOf` treats every `node_linked` as `requires`, so it would quietly become a prerequisite), and engine concept names are fixed once given, so a rename would only change Shalav's label. Duplicates are already caught by normalized labels and `sameAs`.
- Not backfilled: map.json's `sent` already holds every older event, so gaps, edge cases and check tags from before M77 never reach the engine; a re-seed would send them, but the engine has no time field (`record_interaction` takes no timestamp), so a replayed log lands all at once "now" and inflates FSRS stability. Hence also no forced re-seed.
- The real-binary test moves the engine's review dates back in its SQLite DB (`concept_states.last_review` / `next_review`, Go time format) to show forgetting, since the engine has no clock to set; it checks focus on Shalav's side of the gentle layer: 2 misses after 8 good keep control > 0.6 (the engine's BKT falls to ~0.3), sustained misses bring it under 0.3.

## M64 — Customized practice generates; the engine only reorders
- Customized practice (custom courses) always generates a new exercise, as asked ("a loop of generated exercises"); an existing course exercise is served only when generation fails, so the loop never stops for one bad job. Normal practice keeps the full mix.
- The engine's focus/misconceptions/reviews only add a bonus to the focus stage (+0.5); they never pick outside the scope, and practice works the same without the engine.
- The tutor's digest waits at most 5 s for the engine; a slow engine drops the digest for that [STATUS] instead of stalling the lesson.

## M65 — Stars
- A custom course never shows below its self-rated level (max(level, graph stars)): the graph prior maps level 2 to ~1.25★ over the whole course, and showing a 2★ student "1★" on day one would read as a downgrade. Gentle: it only goes up from the self-rating. Academic courses show the graph stars as they are, plus exam-ready %.
- Question stars use control from the event log, not the engine's retention: they must be computed synchronously when a question is served, and forgetting already shows in the course stars and the tutor's reviews.
- Quick questions have no difficulty of their own: MCQ counts as 2/5, an open question as 3/5.
- A lesson exercise reopened from a saved lesson gets its stars again (its run is rebuilt); MCQ/Open cards keep the saved ones.

## M66 — Replay check on a synthetic history
- Both real data roots have empty event logs, so the M63 acceptance replay used a seeded synthetic history instead (kept as a test). Stage status cannot change by construction (it comes from events, not mastery); the diff confirmed it and that mastery only rises.

## Conventions revert (2026-10-23) — learned answer-writing conventions removed
- The user removed the conventions feature (M70 solution practices, M72 reconcile, M73 applying, M74 card): it could not be made accurate enough. Two paid eval rounds (~$30) left all 6 hard fixtures failing, and every prompt fix brought new regressions. The M72 and M73 entries below are history only, except M73's course-facts bullets, which are still in force.
- Kept on purpose: teacher's notes (they are extra material, and the teacher's marks and repeated mistakes tell the knowledge graph what the student finds hard), the course-facts check, the web-file marker it relies on, the eval CliGateway and the teacher eval.
- The real data root had no conventions data (no `.shalav/conventions.json`, no `node_retired` events), and the event reader skips lines that no longer parse, so the schemas were removed outright.

## M70 — Teacher's notes are a folder role; web files are marked by content
- Teacher notes are a third role folder ("הערות המרצה"), like the other two, so the folder scan, deletion and rename handling work unchanged; Moodle never imports into it.
- A web-gathered file is recognized by its content sha, written to `.shalav/web-files.json` before the file lands (the folder scan may pick it up at once). Its solutions are Shalav's own and never teach conventions.

## M71 — Teacher evidence is written once per file content
- Graded-work evidence carries the file sha as `refId`; a sha already in the log is never written again (re-scan, plan replace). An edited file is a new sha and writes new evidence; the old file's events stay, because the event log is append-only.
- Repeated mistakes are matched by tag, not by a second AI job: the teacher-notes prompt sees the tags already used and reuses one for the same mistake. Two distinct works or answers with the tag make the misconception node.
- A teacher file's stored page text is the model's transcription of the teacher's writing only; the raw page (which holds the student's answer) is never stored.
- Teacher files of one course are scanned one at a time (the tag list and the repeat count read the log), so a waiting teacher file holds one of the course's two queue slots; material and exercise files are unaffected.

## M72 — Conventions reconcile (REMOVED in the conventions revert; history only)
- The model only proposes; `judgeUseCase` decides. Ids outside the use case or of the wrong kind are ignored. An absence no draft claims counts as unexplained against every draft of its use case. An explained absence whose notWhen number is out of range counts as unexplained. The boundary 1 in 4 is allowed (3 followed + 1 unexplained passes).
- Absences have no stored id; reconcile names them `<sha8>-a<n>` by their index in the file's patterns (old indexes work unchanged).
- Convention id = nodeId(single stage | G, "convention", rule); taken → rule + " | " + trigger; taken twice → the draft merges its sources into that convention (never overwrites it). Retired ids are not "taken": a convention that qualifies again comes back under its id, with a new node_added.
- Repairs: in map, an id listed twice keeps its first cluster, a missing id is its own cluster, an unknown id is dropped; the same for keys in merge. Separation: an unlabeled item counts as satisfying both triggers. After separation a solutions side keeps only the refs labelled for it and is counted again (≥3, ≥2 files) or dropped into `inconsistent`; notWhen lines are joined, never replaced.
- Incremental: a use case's key is the hash of its item ids (they carry the sha, so a deleted or edited file changes it); unchanged → no job, its conventions kept. When one side of a similar pair runs, the other runs too. `hashes["*"]` (all items + active ids) unchanged → no AI job at all.
- Retire: stored conflicts are checked again each run, so deleting the files alone can retire X when its contradictor's use case is unchanged. Y counts as repeating if accepted this run, or it has ≥1 source and is a teacher convention or sits in an unchanged use case. Two teacher conventions that overlap stay, with an "unresolved (two teacher rules)" conflict.
- A solutions draft matched to a teacher convention only merges sources; a solutions convention that gains a teacher source becomes a teacher convention (its graph node keeps origin "index").
- Teacher evidence on conventions: once per (file sha, node), mean of 0 per deduction and 1 per praise; requirements give none.
- The graph mirrors the registry and is repaired on every run, including runs with no AI job: the registry is written first, so a crash before the events heals on the next build.
- Stars stay fair: a convention node from index/teacher gets no stage-wide (spread) evidence and is dormant until it has its own; dormant nodes are left out of stars, readiness, weakest, meanControl and stage mastery. The engine never forgets a node, so its focus and misconceptions are kept only for ids in the graph.
- Build: reconcile runs next to refinePlan (`Promise.allSettled`, refine's error rethrown only after reconcile settles, so no second build can overlap it); not gated on newly indexed files; a reconcile error is logged and never fails the build.
- A convention's rule, trigger and verify are never cut server-side (the ≤160/240/200 limits are prompt instructions only): the first eval run stored a rule cut mid-sentence ("…repeat that section in the Conclus"), which changes what the grader would check.
- The semantic eval's "every row passes, 3 stable runs" gate is moved from the end of M72 to after M73 (one combined tuning loop with the real grader), to save the user's subscription usage. Before M73 only the law fixture (the lifecycle rules M73 builds on) is run once.
- Eval-only: the judge never sees a convention's conflicts; teacher superiority (`winner` rows) is checked on the registry: each losing convention must have a conflict naming a winner convention.

## M73 — Course facts (in force) and applying the conventions (REMOVED in the conventions revert)
- `candidatesFor`: active only, teacher first; stage filter (a course-wide convention always passes); a part-level use drops whole-level ones; no stageIds (homework, test questions without a stage, the eval rows) = every convention. Over 12, the coarse hints only reorder which 12 are kept; the teacher's order is kept. No caller passes `level` or hints yet: the grader judges part/whole itself from the level line.
- Registry conventions (graph nodes of kind convention with origin index/teacher) are left out of the plain node list (`candidates`), and any plain node score on one (e.g. a grader's newNodes with the same label) is dropped. Only the grader's or tutor's per-convention verdict writes evidence on them, and only when triggered (met 0..1 as given).
- The tutor's [STATUS] numbers the stage's conventions C1…; record_check_result answers by those numbers (the list is recomputed per call; the registry only changes in a build).
- Course facts (user's request): a name, section/article number, date, definition or notation the course defines. The grader never deducts for one from its own knowledge alone; it lists it in `disputed` (≤3) with search phrasings. Math, logic and method errors are graded directly, as before.
- The check (`practice/facts.ts`): word search (BM25) with the grader's phrasings + claim + belief over every scanned course file, material and teacher pages and the exercise files' statements + solutions; web-origin files never count. Per doubt: the 4 best pages anywhere, plus the 2 best of the exercise's own stages (tagged by meaning at scan time); ≤16k chars in all; no page → no AI call. "At least as relevant as the conflicting piece" is exact (conventions step 2): the pieces the grader was given as the key (the exercise's reference solution, each example exercise with its solution from `o.examples`, a check's expected points joined) are ranked with the course pages in the same `rank()` call; a page counts only if its score is ≥ the best of them. No given piece → bar 0. `o.examples` is split back on its `- ` lines (a list inside a statement only splits it further: a lower bar, never a higher one).
- One `submit_fact_check` job for all doubts: wrong → the grader's points are deducted (and finalAnswerCorrect false if it was a final answer), the note with its source is added to the summary/feedback; conflict → a note only; right / unsaid / a verdict without pages → nothing.
- File disagreement: teacher's notes first, then a file that is clearly newer by a year or date in its name or text. Shalav has no edition date (addedAt is the upload time), so otherwise it is "conflict": no deduction.
- Lessons: the tutor grades open answers itself (no server grader), so it gets the rule (check consult_materials before marking a course fact wrong) but not the automatic search.
- Eval: the eval-only judge is gone; each case row is graded by `gradeAttempt` (new optional `answerText`) in a copy of the run's course (registry + scanned files). A key is met when every triggered convention it matches scores ≥ 0.75.

## M78 — Interactive slides
- **Beats build up, they don't replace.** Earlier beats stay on the board, muted, like a teacher writing on the board. Figure parts that have appeared also stay. Beats not reached yet are laid out but invisible, so the inline card (an auto-height iframe) never changes height on Next.
- **One slide counts as one step.** A beat slide counts as one step for the quiz rhythm ("after every 2-3 steps").
- **Caps.** Each beat is capped at `STEP_CHARS` (900). The whole slide is capped at 4 × 900. A figure that names a beat beyond the slide's beats is rejected, so Claude fixes it.
- **No SMIL.** `<animate>`, `<set>` and their kin are in `FORBID_TAGS`. Motion comes only from fixed CSS classes (`flow`, `drift` with `--dx`/`--dy`, `pulse`), and `prefers-reduced-motion` turns them off.
- **Colour.** SVG reuses the text's `m-*` classes; there is no separate set. Geometry reads `--m-*` from the card theme. `\blue{word}` outside math is now allowed in the prompt, but only to link a word to its drawn part. The renderer already supported it (`Markdown.tsx`).
- **Alignment.** A rows derivation lines up within one beat, not across beats, because each beat is its own `<Markdown>`. Figures keep `dir="ltr"`. The prompt asks for Hebrew SVG labels centred with `text-anchor="middle"`.
- **Inline size.** vh can't be used in an auto-height iframe, so figures are capped at `--fig-h` (560px). Full screen sets it to 72vh.
- **Contrast guard.** After drawing, any figure text (SVG `text`/`tspan` fill, an HTML label's colour) below 4.5:1 against the nearest opaque background is recoloured to the board's text colour. Lines and fills are left alone: faint grid lines and tinted areas are intentional. The prompt also forbids fixed black, white or grey in SVG.
- **Tiny beats.** Each beat is a tiny step, because the student sets the pace. There are 2–16 beats per slide. The per-beat (900) and per-slide (3600) caps are unchanged.
- **`until`.** A part can leave as well as arrive. It shows only while beat ≤ `until`.

## M79 — Server-drawn figures, figure_guide, the biology library
- **The drawing never enters the model's context.** teach_step / show_figure carry only the source. The card fetches the SVG with the app-only tool `figure_render`; results are cached on the server (64 entries). The tool still renders once when Claude sends the figure, so a TeX error reaches Claude immediately.
- **TikZ engine.** Only node-tikzjax's TeX engine (`dist/library.js`, WebAssembly) and its files are used. Its own wrapper needs jsdom, memfs and tar-fs, which don't bundle into `server.mjs`; a 10-line tar reader and dvi2html replace them. dvi2html leaves `<g>` and `<svg>` open (the package repaired that with jsdom), so the open groups are closed by count. Renders run one at a time (the engine's state is global). About 25 ms warm, about 0.5 s cold.
- **TikZ text becomes paths.** dvi2html writes `<text>` in the BaKoMa TeX fonts, with glyphs at TeX positions (Ω is at the soft hyphen). The fonts aren't in the card and a CDN is likely blocked, so the server turns each text into a path with opentype.js (MIT). Hebrew isn't possible in TikZ (no Hebrew TeX font); Hebrew words go in the slide text.
- **Beats in TikZ.** A line ending in `% @n` / `% @n-m` is wrapped in `\special{dvisvgm:raw <g data-beat…>}`. It is one render; the card toggles the group; the layout never moves (hidden parts keep their place). One statement per marked line.
- **Colours.** `#000` / `black` become `currentColor` (the board's ink); a white fill/stroke gets class `fig-paper-*` (the card's paper colour, dark in dark mode); the four TikZ colours `m-blue|green|pink|orange` have exact marker values that become `currentColor` plus the `m-*` class. `m-white` / `m-black` are fixed, for lettering on a filled shape. Mixed colours (`m-blue!30`) stay fixed. Shadings keep their real colours.
- **Ids.** Every server drawing's ids get a per-source prefix (TeX names every shading `pgfsh1…`; several figures share a card). The card's shading kit (`shade-*`) keeps its names.
- **Packages and libraries.** circuitikz, chemfig, pgfplots, tikz-3dplot, tikz-cd, amsmath, amssymb (what the engine ships); any other package is an error listing these. A picture's package is loaded even without its `\usepackage` line. arrows.meta, calc, angles, quotes, decorations, patterns, shadows, positioning and 3d are always loaded.
- **Biology library (`bio`).** 49 parts in `assets/biolib/`, from bioicons: 41 Servier Medical Art parts (bioicons files them as CC BY 3.0, not 4.0 as first noted), 5 CC0 parts (Simon Dürr, nUll, Derek Croote, Xi Chen, James Lloyd), and 3 drawn for Shalav (leaf, chloroplast, plant cell: there is no Servier plant part). They were run through svgo (precision 1, ids prefixed with the part name), each viewBox was cropped to its content, and `<style>` was inlined. Left out: parts with English labels drawn in (cell-complete, ribosome, villi, plant cell), flat line art (antibody, neuron, nephron), tiny ones (leaf, seedling), and sarcomere (885 KB). A part is placed with `<use href="#name" x y width height>`; the server replaces each placement with the part itself in a nested `<svg>` (the card's DOMPurify drops `<use>` and `<symbol>`), with ids unique per copy. The credit for the parts used rides on `data-credit`, and the card shows it under the drawing. CC0 and own parts carry no credit.
- **Shading kit.** The card adds radial gradients `shade-blue|green|pink|orange|gray` when a figure uses `url(#shade-…)`, plus CSS classes `shadow` (drop shadow) and `glow`. They live in the card because DOMPurify drops SVG filters from Claude's source.
- **Size.** A server drawing may be up to 4 MB in the card; Claude's own svg stays capped at 50 KB.
- **figure_guide.** The lesson prompt lists the kinds in one line each (about 400 tokens). The kind's format, beat and colour conventions and an example come from `figure_guide({kind})`, once per kind per lesson. The beat and colour-link rules that apply to every kind stay in the prompt.
- **No subject filter for the catalogue.** `courseKind` describes the teaching style (proof-based, computational…), not the subject. Guessing the subject from Hebrew course names isn't worth it for about 400 tokens, so every lesson gets the whole catalogue (advisor review, agreed).
- **No CDN.** Big card-side libraries are bundled as lazy chunks (vite-plugin-singlefile inlines them, so each adds to the card's size), not loaded from a CDN declared in `resourceDomains`. Whether Claude Desktop honours that CSP can't be checked here, and nothing depends on it.
- **Test host.** The dev server answers `figure_render` at `/__figure` with the real renderer (`vite.config.ts`), so e2e draws real TikZ and library figures.

## M80 — Graphviz, Mermaid, Vega-Lite
- **Layout once, tag after.** Graphviz and Vega-Lite lay out the final drawing once; beats tag the output groups (Graphviz `<g class="node|edge">` by its `<title>`, Vega-Lite layers by a generated layer name `beatN` → `beatN_marks`). Rendering a frame per beat would re-layout and move the nodes (the no-shift rule).
- **Graphviz** (`@viz-js/viz`, MIT wrapper of Graphviz, EPL; WebAssembly embedded in the bundle). A marked DOT line marks the nodes and edges it declares (a chain marks each edge). A node shows from the start unless its own line is marked. If no marker names anything in the drawing, it's an error for Claude. Shalav adds Helvetica and a transparent page ahead of Claude's own settings. Hebrew labels work (the card draws the text), but keep them short: Graphviz measures the text itself.
- **Mermaid stays in the card** (it was already bundled; it needs a DOM). `%% @n` markers are stripped before rendering (Mermaid rejects a comment at a line's end). Flowchart and state nodes are matched by id (`…-flowchart-ID-n`, `…-state-ID-n`), with a node appearing on the line that first names it; edges are matched by their order in the source. Other diagram types show whole. Colour: `class A m-blue` plus card CSS, because Mermaid's theme sets fill and stroke and its `style`/`classDef` colours don't follow the dark board. The server only checks the diagram type line (no DOM on the server), so a Mermaid syntax error shows the card's fallback, not a message to Claude.
- **Vega-Lite** (`vega` + `vega-lite`, BSD-3, `renderer: "none"` → `toSVG()`). Beats on layers only (`"beat"`/`"until"`, removed before compiling); scales come from all layers, so axes never move. Shalav's config: transparent background, Helvetica, axes/labels/titles in black (→ the board's ink), a faint grid. Data must be inline.
- **Theme colour names in sources.** `m-blue|green|pink|orange` (quoted or not) are replaced by their exact marker values before Graphviz/Vega render (`markColors`), and `themeColors` (now per tag, merging into an existing `class`) turns them back into the card's colours.
- `server.mjs` grew from 7.8 MB to 11.1 MB (Graphviz WebAssembly, Vega).

- Full screen only (user request, after M80): the card asks the host for `fullscreen` on load and again whenever the host returns it (Esc, its own button); the pin (pip) and full-screen toggle buttons are gone. A card replaced by a newer one goes back inline so it does not cover it. A host without full screen shows the card inline.

## M81 — Course images, maps, music, chord charts
- **Course images (`image`, server).** Claude first calls `course_page({file, page})`. It returns the page image (the indexer's cached page JPEG) with a 10 × 10 grid of page fractions, so Claude can see where to crop and where to point. `consult_materials` headers say "has a figure" for those pages.
  - The crop and every mark use page fractions, and the SVG's `viewBox` is the crop, so nothing is converted.
  - The crop comes from the full-resolution page (`PageSource.crop`: 2400 px for a PDF, a photo's own pixels), so it stays sharp at full screen on a retina display. It rides in the SVG as a PNG/JPEG data URI, placed at the padded box `crop` returns, so the marks keep page units. Without a crop, the cached 1568 px page image is used. All of this stays under the 4 MB cap for server drawings.
  - A mark outside the crop is an error for Claude ("move it or widen the crop"), not a silent clip.
  - `abc` is one voice only, because beats follow staff lines.
  - The sanitizer keeps a `data:image/png|jpeg;base64` href only on `<image>` and only in server drawings. Claude-written `svg` figures still can't embed data.
  - Marks are drawn twice, a paper halo and then the colour, and labels sit on a paper pill. They read on any photo in both themes, where the contrast guard can't see the pixels.
- **The course is in the source.** teach_step/show_figure write the open lesson's course number into an `image` source. `figure_render` has no lesson state, and a saved lesson replays later (history, a restarted server). The file is found by its name or path in the course's indexes, and errors list the files.
- **Maps (`map`, server).** d3-geo (ISC) and topojson-client (ISC), with Natural Earth borders (public domain) from world-atlas `countries-50m` (ISC), bundled into `server.mjs` (+0.9 MB). 110m is too coarse for small countries like Israel.
  - The projection is fitted once to the region and clipped, so layers (countries, routes, points, labels) only toggle.
  - Countries go by Natural Earth's English names. An unknown name lists names with the same first letter.
  - The borders are today's. A historical map is drawn as shaded countries, routes and labels.
  - Labels stay SVG text with a paper halo, so Hebrew works.
- **Music (`abc`, card).** abcjs (MIT) draws ABC notation in `currentColor`; `% @n` on a music line puts that staff line's elements (`abcjs-l<k>`) on beat n.
  - abcjs's own synth fetches its sound font from a CDN, so it is not used (see M79 "No CDN"). Instead, Play schedules abcjs's note events (`setUpAudio`) as WebAudio triangle tones, and only for the lines already on the board.
- **Chord charts (`chords`, card).** svguitar (MIT, with svg.js MIT) needs a DOM, so it stays in the card.
  - Finger dots are outlined in ink on the card's paper, so the number reads in both themes.
  - A chord's beat goes on its chart's SVG parts, and the chart keeps its room while hidden.
- **Card size.** abcjs and svguitar are lazy chunks, but vite-plugin-singlefile inlines them: `cards.html` grew from 3.2 MB to 4.1 MB.
- **Dev fixture.** In the test host, `/__figure` creates course 999 for `image` figures (`e2e/fixtures/devCourse.ts`): a generated textbook page with the library's heart section.

## M82 — Pikchr, bytefield, Verovio, chess, Go, syntax trees, star maps, SMILES, OpenMoji, draw-in, sketch
- **Where each one runs.** Each library was first rendered in Node. Those that worked are server kinds: Pikchr (pikchr-wasm, MIT; Pikchr 0BSD), bytefield-svg (EPL-2.0), Verovio (LGPL-3.0, WebAssembly), and rough.js (works without a DOM, but it is used in the card; see below). SmilesDrawer (MIT) needs a DOM, so it is a card kind (~200 KB).
- **Pikchr beats.** Pikchr's SVG has no groups or ids. Each marked line therefore gets its own colour (`rgb(1,k,7)`), and after the single layout every element in that colour gets the line's beat and its `m-*` class, then turns back into ink. `invis` was not used: it changes the drawing's bounding box, which would shift the layout.
  - Fills become translucent (`fill-opacity` 0.22), so ink text on a filled box reads on both boards.
- **bytefield and Verovio are shown whole.** bytefield's DSL has no comment marker for beats. Verovio's ABC import lays out only one voice, so several staves come from MusicXML. Step-by-step music stays with `abc`.
  - Verovio's glyphs (`<use>` of `<defs>` paths) are inlined because the card drops `<use>`. Its log is switched off.
  - `server.mjs` grew from 12.5 to 23.4 MB (Verovio ~7 MB, bytefield's SCI interpreter, Pikchr). `shalav.mcpb` grew from 57 to 60 MB.
- **Chess.** Own code with Chessnut pieces (Apache-2.0; lichess lists cburnett as GPLv2+, so it was not used).
  - A piece is one element per stay on a square, from its beat until the move that takes it away, so the board never redraws. Captures, castling, en passant and promotion are handled.
  - The board keeps its own wood colours in both themes. Coordinates sit outside the board in ink.
- **Go.** Own code. The stones are shaded with radial gradients, and captures are found by liberty search when a move is played. Text on the wood and on the stones uses fixed colours inside `data-own-bg`.
- **`data-own-bg`.** The contrast guard and the e2e contrast check now skip text inside an element with `data-own-bg`, meaning a drawing with its own backdrop (Go wood and stones, the night sky). Elsewhere text still follows the board.
- **Syntax trees** are brackets turned into DOT and laid out by Graphviz (`ordering=out`). `Label@n` marks a subtree, so no new layout code was needed.
- **Star maps.** d3-celestial's data only (BSD-3, Olaf Frohn; stars to magnitude 6, IAU lines, names including Hebrew), reduced to 180 KB in `assets/sky/` and drawn with d3-geo. The d3-celestial library itself needs a DOM and canvas.
  - The sky is drawn as seen from Earth (east to the left), on its own night background, with the bright `--m-*` values.
- **OpenMoji** (CC BY-SA 4.0). 100 curated pictograms are added to the part library as `om-*`, with the credit line "OpenMoji (CC BY-SA 4.0)". The `bio` kind places them like the biology parts.
- **Vivus → CSS.** `class="draw"` sets `pathLength="1"`, and a stroke-dashoffset transition draws the stroke in when its beat comes. No library is needed.
- **rough.js in the card.** `class="sketch"` redraws a group's shapes by hand with a fixed seed (the same sketch every time). It is loaded only when a figure uses it (~30 KB).
- **bpmn-js is skipped.** Mermaid covers flowcharts, and bpmn-js would require its logo to stay visible.
- **Catalogue.** The one-line kind list stays under 1,600 characters (about 400 tokens) with 20 kinds, because every line was shortened. There is still no subject filter (see M79).
- **Card size.** SmilesDrawer and rough.js took `cards.html` from 4.1 to 4.4 MB.
- **M82 review fixes.** SMILES atoms use Shalav's own palette per theme (each ≥ 4.5:1 on the card and the board; SmilesDrawer's own red/blue/yellow were ~3.8:1 on white). The contrast checks (card guard and e2e) judge the element that holds the glyphs, so a `<text>` of coloured `<tspan>`s is checked per tspan, and text in `mask`/`clipPath`/`defs` is skipped. Vega-Lite renders with `aria: false` (its `aria-label` on plain paths failed axe); the slide's text describes the chart. Chess/Go moves without `beat` and tree `Label@n` count in teach_step's beat-range check.

## M83 — 3D scenes (three.js)
- **Declared, not coded.** Kind `scene`: JSON objects (box, sphere, cylinder, cone, torus, plane, arrow, line, label) with `beat`/`until`, and camera `views` by beat. Claude never writes three.js code. The schema (`parseScene` in `specs.ts`) has no three import, so the server checks a scene in `badFigure` and Claude gets a readable zod error (`z.prettifyError`).
- **In the card, as a lazy chunk.** three.js (MIT) is bundled and inlined like SmilesDrawer (no CDN, see M79). `cards.html` grew from 4.4 to 5.2 MB. three.js isn't in `server.mjs` (still 23.4 MB).
- **Lighting and look.** `MeshStandardMaterial` with hemisphere light and a light that turns with the camera, so the side in view is always lit. A box shows its edges in ink. Background is transparent (the board). Default colour is the shading kit's grey; theme colours come from `--m-*`, and `#rrggbb` is allowed for realism.
- **No shift.** The camera frames the bounding sphere of every part, shown or hidden, so a beat never reframes the scene. Views are explicit camera moves: 0.7 s eased, or instant under reduced motion. The canvas is a fixed 4:3.
- **Drag to turn** (OrbitControls) is on. Zoom, pan and the controls' key events are off: the wheel scrolls the page and the arrow keys step beats. A beat change moves the camera back to that beat's view.
- **Labels are HTML.** They are positioned by projecting each point (not CSS2DRenderer, which hides with `display: none`), sit on a paper pill, use `dir="auto"`, and are hidden by beat with `showBeat` like SVG parts. Hebrew works, and the contrast guard and e2e can read them.
- **Rendering.** Only on change (a beat, a drag, a resize, the camera move), with no continuous loop. Cleanup disposes geometry and materials and forces context loss, because browsers cap live WebGL contexts and a lesson keeps many cards. No WebGL means the figure's fallback.
- **Not added:** 3Dmol.js (PDB proteins) and JSCAD. Ball-and-stick molecules are spheres plus `cylinder` rods with `from`/`to`; SMILES/TikZ cover 2D.
- **Verovio stays in `server.mjs`** (user, 2026-10-23). Cold start is ~0.9 s first run, ~0.44 s after, and moving it to its own file wouldn't shrink the `.mcpb`. Revisit if Claude Desktop starts Shalav slowly (Windows, older Macs): then load it on the first score, like `playwright-core`.

## M84 (T5) — Grading prompt: completed stages only on the boundary's Learned line
- Spec 10.5 sends `{{COMPLETED_STAGE_TITLES}}` and `{{KNOWLEDGE_BOUNDARY}}`, whose Learned line lists the same completed stages (6.8). When a boundary is present the separate list is dropped and the rule reads "Results from the stages on the "Learned:" line of the KNOWLEDGE BOUNDARY below may be cited without proof." It names the Learned line, not all "allowed knowledge", so the Baseline does not become citable. With no boundary (homework, test practice: `boundaryOf` = "") the 10.5 text is kept verbatim.

## M85 (R3) — BM25 token cache
- `rank` reuses a page's tokens only when the page id and its exact text (`text + " " + summary`) match the cached entry. Page text is not fixed per sha (teacher pages are re-transcribed on re-scan, summaries change), so neither the sha nor a summary hash alone is trusted.
- The cache is a 5000-page LRU in process memory, never saved. A course with more candidate pages than that gets no speed-up but the same results.

## M86 — R7: lesson entries in an append-only <id>.jsonl
- The header keeps the M60 schema as is (schema 1, `entries` present, no marker field): a pre-R7 Shalav must still list and open every conversation, and zod strips unknown keys anyway. New conversations have `entries: []` in the header.
- No migration: entries saved before R7 stay inside `<id>.json` forever and the jsonl continues them, so no conversation is ever rewritten in bulk; loading is header entries ++ jsonl lines, by file position (no ids, no sort, no mergeById).
- `updatedAt` stays in the header, rewritten on every action (append first, then header), so the saved-sessions list reads headers only and sorts as before.
- An older Shalav on a newer folder: practice sessions complete; lessons created after R7 show title and date with no history (resume opens the stage card). Accepted: a downgrade degrades without crash or corruption; writing entries into both files would cancel the change.
- A crash mid-append loses that line (and the next, appended onto it); the same risk the event log already has. A schema-invalid jsonl line is skipped, while a bad entry in the header still makes the conversation unreadable, as before.
- `loadConv` runs in the write queue of its id, so readers never see a half-appended line (the atomic rename gave that before).

## M87 (R1) — Index cache keyed on disk, not on our writes
- The key is the file's size, mtime, ctime and inode from `stat`, so edits from another computer (Drive/iCloud) are always seen; there is no in-memory invalidation on write.
- A file changed within the last 3 s is parsed but not kept (git's racy-clean rule: FAT keeps mtime in 2 s steps, Linux ctime is coarse).
- Callers get a structural copy (new objects, shared strings) instead of the cached objects: scanCourse mutates records in place, and freezing would turn an unaudited mutation into a crash.
- Conflict copies in the index folder are still listed as before (no new filtering); a null parse is never cached; `readFileIndex` stays uncached.

## M88 — Build summary counts newly read files (U8)
- The number in the build summary is the files this build read successfully (failed and removed ones not counted), not the course's indexed total. Fresh builds keep "from N course file(s)"; updates say "from N newly read course file(s)" ("newly read" also fits re-scanned and retried files, "new" would not); an update that read nothing but still refined says "(no course file was newly read)".
- Refine (and enrich inside it) still runs whenever the course has any indexed file, even when this build read none: a re-run can add stages and is the only way to redo enrich after a failure. Skipping it at zero new files was considered and not done.

## M89 (A8) — [STATUS] idle minutes
- "Minutes since last activity" = floor((now − last) / 60 000), clamped at ≥ 0. `last` = the later of the course's newest studying event (`stage_started`, `stage_completed`, `stage_reopened`, `check_answered`, `attempt_graded`, `hint_requested`, `solution_revealed`, `assessment_updated`) and the open lesson's last saved action. It is 0 when neither exists, and there is no cap. This replaces "(idle minutes = 0)" in the M7 entry above.
- Teacher-file evidence, plan changes and graph edits are written by scans and builds, not by the student, so they never count. Per-stage `lastActivityAt` is not used: it is per stage and teacher `mistake_observed` touches it.
- The lesson's last action is kept in memory (`active.at`, set by every `log()`) rather than read from `.chat_history` on each status; on resume it starts from the saved conversation's `updatedAt`. A new lesson does not read older conversations: a slides-only session with no check is not seen.
- No prompt rule uses the number (v2 rule 10 recaps from the RECAP block). It is context for the tutor, as in v1 §6.3/§10.2; dropping the line was the alternative, rejected because the resume path has no other gap signal.

## M90 (U7) — File zones open by default when they fit one page
- A zone's default is decided once, at its first non-empty file list in the card: open when it has at most 10 rows (one page). Later growth or shrinking never changes it: a short zone that grows past 10 stays open (with the pager), a long zone trimmed to 5 stays collapsed. An empty zone is decided when its first files arrive.
- The student's toggle and a legend filter (which opens the zone) win over the default for the card's lifetime; the 1.5 s poll never changes `open`.

## M91 (U2): leaving the step question pop-up
- The "may have answered in the chat" note shows 60 s after Send, counted from Send because the card cannot see the Enter press: longer than the 20 s Nudge (that one starts when the model already has the request) and shorter than the 90 s press-Enter banner. Its wording covers both causes (Enter not pressed, answered in plain text).
- The card keeps polling after the note and after Back, because `answer_question` output is shown only by this card; it stops on the answer, a new question, Continue / Explain differently, or unmount. Back only hides the pill: it sends nothing, so the queued question and the transcript are as before.
- Back is offered only for a question, not after Continue / Explain differently (a new step card replaces those; extra clicks there would add requests and transcript notes).
- Back keeps the beat on screen (M78); a later question sends the beat shown at its Send. The arrow keys keep M78's behaviour (ignored only in the question box), also under the pill and the pop-up. "Back to the step" (`step.back`) is its own key, not the beat's Back (`step.beatPrev`), with the same backward arrow.
- Back then another click before Enter replaces the queued question (only the newest click reaches the model); the transcript still shows "Asked: …" for it. Accepted: same inbox rule as any card click. Revealing beats sends nothing and does not replace it.
- Known limit: with one global `answer` and only a time stamp, an answer to an earlier question that arrives after a newer question was sent is shown under the newer one. Rare (Back + a second Send during a running turn); accepted.

## M92 — Warming the knowledge engine (R8)
- A warm starts only the engine process; it never computes a summary. A warm summary would change the number of computes, and the shown-stars hysteresis depends on that number; it would also replay unsent answers (and since M76 a re-seed or the high-stakes mark) earlier, and the engine stamps them on receipt.
- Only `shalav_start_lesson` warms, where its [STATUS] certainly follows. The course card (lead time ms), practice (open calls no summary) and Home (several courses against a pool of 2: an eviction mid-call turns the engine off for all courses) do not.
- A warm uses a free pool slot only and never evicts; with the pool full nothing changes.
- A warm at lesson start may begin the one-time engine download (`bin()` → `ensureEngine`). On a machine without the engine the lesson's own compute (the `stage_started` compute or the [STATUS] summary) starts the same download in the same tool call anyway, and a fresh 30 s cache implies the engine was installed or is in its backoff; so the warm only moves the start earlier by the handler's own work. Its progress (`installing`) still shows only in the course card; the lesson shows none and drops the digest while it runs, as before. No "only if installed" guard.
- A failed warm sets the 10-min backoff, so the summary does not try a second download or spawn (one attempt, as before).
- The 5 s / 3 s waits are unchanged.

## M93 — Files poll cadence (R2)
- `files_list` polls every 1.5 s while a build runs (card's `live`, or any row `inBuild`), a file of any zone is scanning, an upload runs, or Moodle is busy (install/login/sync all fast: progress bars and the login → sync switch); every 5 s otherwise. 5 s: ~3× fewer folder scans while an outside drop still shows "by itself". (Supersedes the poll interval in the M6 "No server-side fs.watch" line.)
- Hidden window (`document.visibilityState`, which follows the top-level window, not the card's scroll position): idle ticks are skipped and one refresh runs when it shows; fast ticks keep running, because the poll's scan is what cancels a running build's work on a file deleted or edited outside the app.
- No immediate refresh on a cadence switch: every in-card action already refreshes, and fast→idle is always seen by a fast poll.

## M94 — Card errors are mapped in the card, from the message text (U1)
- Server and domain error strings stay as they are (English; the model reads them through the bridge and in Claude Code's structuredContent), so no error-code field was added to card data; the card matches the message.
- Order: an existing i18n key → its text; a known actionable class (stopped, missing course data or uploaded file, data-folder I/O, download) → its own sentence; else the card's own failure sentence (homework read, homework solve, plan build, quiz-notes read); else invalid model output → "Claude's answer didn't come back in the right form"; else a generic sentence.
- The raw message stays in a closed "Details" disclosure under the sentence, not a title tooltip (keyboard, touch and screen readers can open it), and outside the alert so only the sentence is announced. A translated key has no Details.
- A stopped AI homework solve shows the paused note (it can continue), not the failure. Quiz-notes read failures reuse `homework.failed` (same sentence).

## M95 — Chunked answer uploads (U3)
- `attachment_upload` is replaced by `attachment_upload_chunk` (no compatibility tool): `cards.html` is served by the same server from the same `.mcpb`, so a card always matches its server; an iframe left open across an update gets the generic upload error and works after reopening. (Supersedes the "no chunking" line under M8.)
- Chunks are 2 MB raw (as course files); the cap is `total ≤ 15` (30 MB raw, today's 40 MB base64), not a byte counter, because the tool is card-only.
- Upload key `number/name/id`, `id` a card nonce from `Date.now()` + `Math.random()` (`crypto.randomUUID` needs a secure context the card iframe may not have).
- The shared reassembly drops the upload on an out-of-order chunk (`file_upload_chunk` used to keep it) and no longer recreates a vanished temp dir (that would reassemble a partial file). Idle uploads are swept after 10 minutes; no sweep at server start.
- No new strings: the bar reuses `learn.uploading`, errors stay `exercise.failed`.

## M96 (U6) — Skip confirm in Practice
- Next asks on any unanswered practice item; End asks only in test practice, because there the question on the board was burned at serve time and ending loses it, while in normal practice nothing is used up (served list per session, no attempt event) and End is a deliberate action.
- "Unanswered" is judged in the card (exercise: no grade and not perfect; MCQ: selected null; open: no result); for an exercise the card reads practice_state once first. It only gates the confirm; the server still scores from its own state. While an exercise answer is being graded, the confirm says so instead of 'not answered'.

## M97 — R4: the event-log cache is keyed by content, not by mtime
- The plan suggested a stamp of file names + sizes + mtimes via a new `Fs.stat`. Keyed by the file text instead: the file is still read (cheap) but parsed only when its bytes changed, so a coarse mtime, a same-size rewrite by a sync tool or an append racing the stamp can never serve old events, and `Fs` needs no `stat`.
- The reduction is not memoized: mistake weights decay continuously and are rounded to 3 decimals and sorted, so even a one-minute bucket could reorder the [STATUS] mistakes. Only `checkAdvanceCriteria` (provably `now`-independent: it reads stage mastery, never mistake weights) and the digest's `levelOf` (same graph as status()) are not recomputed.
- The cached events are shared objects across calls; nothing mutates them, so production code neither copies nor freezes them. Under vitest they are deep-frozen, so a future in-place edit fails a test instead of silently changing [STATUS] or the engine evidence.

## M98 — Watch-list stage titles come from the card's own plan data (U5)
- The course card looks up watch-list stage titles in `data.units` (already translated with `tr`) instead of a new server field; a stage in no unit or deleted from the plan shows its id alone.

## M99 — Continue last lesson on Home (U4)
- The button is the newest saved lesson by last action, the same as `resume: "latest"` and the top of Load older; it is not picked by file time (copied or synced folders change file times).
- It is hidden, not replaced by an older lesson, when the newest lesson's stage left the plan or is locked: the student can still pick another in Load older.
- It is not disabled during a plan build, like Learn.
- The label re-adds the `home.continue` key (deleted as unused in the 2026-10-23 cleanup).
- Model-visible: `shalav_home`'s `structuredContent` gains `lastLesson` (benign; the home text is unchanged).
