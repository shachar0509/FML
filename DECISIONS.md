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
