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
