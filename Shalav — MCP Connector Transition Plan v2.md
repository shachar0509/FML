# Shalav v2: from desktop app to MCP connector (transition plan)

Status: **governing document from 2026-10-20.** Where it conflicts with `Shalav — Product & Technical Specification v1.md` ("v1 spec"), this document wins. Every v1 section not mentioned here stays normative: data layout (§3), plan and granularity rules (§4), progress model (§8), prompts (§10), figure formats (§11.3), knowledge boundary (§6.8), and so on.

Implementation follows §9 below, step by step, one commit per step, with tests in the same step. This is the same workflow as v1: update `Progress.md` after every step, record silent-spec choices in `DECISIONS.md`, work on branch `dev`, and stop after each step so the user can compact.

---

## 1. Why

- **Cost.** In v1 every student brings an Anthropic API key and pays per token. Most students already pay for an AI subscription (Claude Pro/Max, ChatGPT Plus). Providers do not let a third-party app spend a subscription through their API, but they *do* let the user's own AI app call third-party tools over MCP. So Shalav becomes an MCP connector: the student's AI app (and their subscription) does the thinking, and Shalav supplies the course data, the rules, the progress tracking and the interactive cards.
- **Friendliness.** Students should not need API keys, billing pages or model choices. They install one extension, then click buttons inside the chat.

## 2. Product in one paragraph

The student installs the **Shalav extension** into Claude Desktop with one click (a `.mcpb` file). In any chat they type "Shalav", or pick **Shalav → My courses** from the prompt menu. A **Shalav card** opens inside the chat. It shows their courses and an **Add course** button. Everything after that is cards with buttons, with the AI tutoring in the chat around them:
- adding a course and building the step-by-step plan,
- adding materials,
- learning stage by stage with MCQ, open-question and exercise cards,
- hints, full solutions and grading of a photographed solution,
- practice, progress and "Watch out for".

All files stay in the local data folder (`~/Documents/Shalav`), in the v1 format.

## 3. Hosts and scope

| Host | v2 support | Notes |
| --- | --- | --- |
| Claude Desktop (macOS, Windows) | **Primary, MUST** | Local MCP server over stdio, packaged as MCPB (Node is bundled with Claude Desktop). MCP Apps cards render. |
| Claude Code / other MCP clients without MCP Apps | SHOULD (text fallback) | The same tools work. Every card tool also returns a readable text/Markdown fallback. |
| claude.ai web / mobile, ChatGPT | Out of scope for v2 | These need a remote HTTPS server, which means hosting and moving student files off the machine. Keep the server transport-agnostic (no stdio assumptions in the tool layer) so a Streamable HTTP deployment can be added later. |

Requirements: the host supports MCP tools, resources and prompts, plus MCP Apps (`io.modelcontextprotocol/ui`, spec 2026-01-26). The server MUST NOT require MCP sampling. Sampling is an optional fast path (§5.3) and is only used when `getUiCapability`/client capabilities advertise it.

Out of scope for v2 (removed from v1):
- the Tauri shell,
- the Anthropic API key and keychain,
- model selection, extended thinking settings, the usage and cost tables, the monthly cap,
- the built-in Google Drive sync (§7.6 replaces it),
- the auto-updater (MCPB reinstall replaces it),
- the web-search server tool (the host's own web search, if any, is used by the host model).

## 4. Architecture

```
Claude Desktop ──stdio/JSON-RPC──▶ shalav-mcp (Node 22, bundled into the .mcpb)
   │  model calls tools                 ├─ core/  (v1 domain + lib + prompts + tool schemas, reused)
   │  cards = MCP Apps iframes ◀─ui://── ├─ server/ (MCP tools, resources, prompts, job bridge)
   │  card buttons → app-only tools      └─ data: ~/Documents/Shalav (v1 layout, unchanged)
   └─ card buttons → app.sendMessage → the model continues the chat
```

Three kinds of work:

1. **Deterministic work runs in the server**, unchanged from v1:
   - catalog lookup, file import and hashing, BM25 retrieval, `reduceProgress`,
   - advancement criteria, practice selection, plan validation and rendering, events and progress files.
2. **One-shot AI work** reuses the v1 domain code *as is* through the **Host Bridge** (§5): plan generation (Pass A/B), plan improvement, material and exercise indexing, grading, hints, solve mode, exercise generation and verification, MCQ/open batches, lesson briefs and retrieval answers. The domain code still calls `ClaudeGateway.send()`. The bridge hands each request to the host model as a **job** and resolves the promise when the model submits the answer.
3. **Conversational AI work (tutoring, Ask)** is done by the host model *directly in the chat*:
   - `shalav_start_lesson` returns the v1 tutor instructions (§10.2, adapted per §6.3) plus the `[STATUS]` and boundary blocks.
   - The v1 tutor tools (`present_mcq`, `ask_open_question`, `assign_exercise`, `update_assessment`, `record_check_result`, `consult_materials`) become MCP tools with the **same schemas** (`src/claude/tutorTools.ts`).
   - The card-producing ones render cards.

### 4.1 Card ↔ chat interaction rules (the friendliness contract)

- **Every user action is a button or a form in a card.** No user ever has to type a command, an id or a path.
- **Card button that needs no AI** (open a course, mark stage started, override completion, change a setting, add files):
  - calls an **app-only tool** (`_meta.ui.visibility: ["app"]`) through `app.callServerTool`;
  - the card re-renders from the result.
- **Card button that needs AI** (Build plan, Hint, Show solution, Grade my solution, Next practice item, Learn this stage):
  - calls an app-only `*_request` tool, which enqueues the domain operation and returns a `jobId`;
  - then calls `app.sendMessage({ role: "user", content: [{ type: "text", text: <short friendly line> }] })`, for example "💡 Hint please (exercise 3)";
  - the server instructions tell the model to call `shalav_next_job` whenever Shalav work is pending;
  - when the job finishes, the model calls `shalav_show` (or the relevant card tool) and the card updates.
- **Card state** comes only from tool results (`structuredContent`) and from app-only reads. Cards never read files themselves.
- **Language and direction:** the card uses `settings.language` (he default, RTL), falling back to `hostContext.locale`. Theme comes from `hostContext.theme`.
- **Text fallback:** every card tool returns `content` with a short Markdown summary and the next actions as numbered options. Hosts without MCP Apps (Claude Code) stay usable through conversation.

## 5. The Host Bridge (core of the transition)

### 5.1 `BridgeGateway implements ClaudeGateway`

`send(req)` does not call any API. It:

1. Creates a **job** `{ id, task, courseNumber, system, messages, tools, toolChoice, createdAt, parentJobId? }` and parks it in an in-memory FIFO queue. The queue is also persisted to `appConfig/jobs.json` for display only; jobs do not survive a server restart.
2. Returns a promise that resolves when the model submits the job.

The model-visible tool **`shalav_next_job`** pops the oldest job and returns it as a tool result. The result contains:
- **Text:** the `system` text as "Instructions", then the `messages` flattened in order. A previous assistant `tool_use` is shown as "You answered: <json>". A `tool_result` with `is_error` is shown as "Fix these problems: …".
- **Images:** every image block, as an MCP image content item.
- **The required answer format:**
  - when `toolChoice.type === "tool"` or exactly one non-server tool is given: "Call `shalav_submit_job` with `jobId` and `input` matching this JSON schema: …" (the tool's `input_schema`);
  - otherwise: "Call `shalav_submit_job` with `jobId` and `text`".

**`shalav_submit_job({ jobId, input? , text? })`**:
1. Resolves the parked promise with a synthetic `ClaudeResponse`:
   - a `tool_use` block (`id: "job-<id>"`, `name`, `input`) or a `text` block;
   - `stopReason: "tool_use"` or `"end_turn"`;
   - `usage` all zeros, `model: "host"`.
2. Then **waits** until one of three things happens:
   - the domain operation parks its next job → returns "Next job is ready" plus that job (saves a round trip);
   - the operation finishes → returns its final result, with the card when one applies;
   - the operation throws → returns the error text and a retry hint.

Effects on the existing domain code:
- `callStructured`'s zod validation and its 2 corrections work unchanged. A correction is simply the next job, with `parentJobId` set and only the delta shown.
- Parallel domain calls (plan Pass B runs 3 units at a time; index batches) park several jobs; the model does them one by one.
- `thinkingBudget`, `maxTokens`, cache control, `priority` and `onText` are ignored. Server tools (`web_search_*`) are dropped from requests.
- `signal`: when the student presses Cancel in a card, every job of that operation is rejected with `ClaudeError("aborted")`.

### 5.2 Context discipline (host context window and subscription limits)

- **Dedupe.** A job whose `system` or first user message is identical to one already shown in this server session is shown as "Same instructions as job #N". The plan header, syllabus and outline are therefore sent once per conversation.
- **Text first for PDFs.** Indexing sends the PDF text layer first. Page images are sent only for:
  - pages with less than 200 characters of text (scans),
  - pages with figures (paint-op heuristic from v1 `lib/pdf.ts`),
  - exercise pages that need crops.
  This is a deliberate change from v1 §5.4, made because image tokens count against the student's subscription limits. The new rule is recorded in `DECISIONS.md`.
- **One conversation per heavy operation.** For long operations (indexing more than 40 pages, a full plan build), the card suggests "Continue in a new chat" by copying a one-line resume prompt. The server-side job state survives as long as Claude Desktop runs.
- **Compact tool results:** at most ~1,500 words per result, except job payloads that need more.

### 5.3 Optional sampling fast path

If the client advertises `sampling`, `BridgeGateway` MAY send the request through `sampling/createMessage` instead of the job queue, with `tools` and `toolChoice` when `sampling.tools` is supported. This is off by default (setting `useSampling`), because hosts may show a consent prompt for every request.

## 6. Feature mapping (v1 → v2)

### 6.1 Onboarding (v1 §12.2)

- Replaced by MCPB install. `manifest.json` `user_config` has:
  - `data_folder`: type directory, default `${DOCUMENTS}/Shalav`;
  - `language`: `he`/`en`, default `he`.
- First run (v1 §15.1) runs on server start: `device.json` and `shalav.json`.
- The first `shalav_home` card shows a one-time welcome: three sentences and "Add your first course".
- No API key exists.

### 6.2 Courses and plan (v1 §4)

Tools:
- `shalav_home` (model): the card listing courses, with "Add course".
- `course_lookup` (app): v1 `technionSource` with Node `fetch`.
- `course_create_request` (app): runs v1 `createCourse` through the bridge and returns a `jobId`. The card shows the v1 checklist.
- `shalav_course` (model + app): the Course Home card (plan, statuses, Watch out for, Files, Learn/Practice).
- `plan_retry_request`, `plan_improve_request` (app).

The add-course preview MUST label the syllabus as "תיאור הקורס מהקטלוג" / "Catalog description". It also adds "After you add the course, Shalav builds a detailed step-by-step study plan (a few minutes)". This fixes the user-reported confusion where the catalog text looked like the plan.

### 6.3 Learn (v1 §6)

The host chat **is** the lesson. The v1 `Lesson` engine (session files, `buildMessages`, compaction, resume prefix) is dropped. Its event-recording logic is kept and moved into tool handlers.

**`shalav_start_lesson({ courseNumber, stageId? })`** (model, also called by the "Learn" buttons through `sendMessage("Let's learn <stage title>")`) returns the lesson card plus instructions text. The instructions are v1 §10.2 with these edits:
- The tool names stay the same, but they are MCP tools: "call present_mcq" means the Shalav MCP tool.
- Rule 10 is replaced:
  - "Start: give a two-sentence overview, then the first chunk."
  - "When the student returns in a new chat, `shalav_start_lesson` includes a recap block; recap in 2-3 sentences, then continue."
- Remove the `[START_LESSON]`/`[RESUME]` control strings.
- Add: "Call `shalav_lesson_status` whenever you need fresh progress data, and at least after every `update_assessment`."
- The `[STATUS]` block is returned by `shalav_lesson_status`, with the same content as v1.
- The recap for a new chat comes from:
  - the last `assessment_updated` event of the stage (`coveredObjectives`, `gaps`, `reviewTopics`, `rationale`);
  - the `check_answered`/`attempt_graded` events of the stage.

v1 `Lesson.open` appends `stage_started` the first time; this behaviour is kept.

Tutor tools as MCP tools, with schemas unchanged:
- **`present_mcq`, `ask_open_question`:**
  - render a question card;
  - the student's answer goes through an app-only `check_answer` call, which records `check_answered` for MCQs and marks the answer visually;
  - then `sendMessage` sends the answer text ("My answer: B" / the open answer) so the model reacts.
  - Open answers are evaluated by the host model in the chat, which then calls `record_check_result` (v1 rule 9).
- **`assign_exercise`:** renders the Exercise Card (§6.4).
- **`update_assessment`, `record_check_result`:** record events (v1 logic in `engine.ts`), then return `advanceCriteriaMet`, the missing list and mistake tag ids.
- **`consult_materials`:** runs v1 `consult()`. Retrieval answers come through the bridge (one job) or, when the BM25 pages are short (under 6,000 characters), as raw page text returned directly. In both cases the text is wrapped in `<materials>`.
- **Lesson card:**
  - stage header, objectives with check marks, mastery bar;
  - **Complete stage** (enabled when the criteria are met) and **Complete anyway** (override dialog that lists the missing items);
  - **Next stage**;
  - read-only view of a completed stage with **Learn this stage again** (`stage_reopened`).
  - A mastery banner appears when the criteria are met (v1 §6.7).

### 6.4 Exercises, grading, hints (v1 §7.6–7.7)

Exercise Card:
- statement, figure crops, **Upload solution** (an image or PDF file picker inside the card), **Hint** (levels 1-3), **Show full solution**, **Grade**.
- Uploads go through the app-only tool `attachment_upload({ name, mime, base64 })`, which stores the file content-addressed exactly as in v1 `lib/attachments.ts`. PDF uploads become page JPEGs with the 12-page limit.
- Grade / Hint / Show solution use the `*_request` + `sendMessage` pattern. They run v1 `gradeAttempt`, `assist` and `revealSolution` through the bridge, and the job carries the solution images.
- The grade result renders the Grade Card in the same card. In Learn, the grade JSON is also returned to the model (as in v1, Step 10 decision) so the tutor continues.

### 6.5 Practice (v1 §7)

`shalav_practice({ courseNumber, scope? })` opens the Practice card:
- scope chooser, the current item, counters, and the summary.
- v1 `Practice` engine is reused unchanged, with the bridge for generation, verification and MCQ/open batches.
- Prefetch is kept, but limited to one item ahead so the chat does not fill with jobs.

### 6.6 Files and materials (v1 §5)

Course card → Files tab: two drop zones (Study materials / Sample exercises) inside the card, plus a file picker. Files reach the server in one of two ways:
- **`file_upload_chunk`** (app-only): base64 chunks of at most 4 MB, reassembled, then v1 `importFiles`;
- **Open folder:** reveals the course folder in Finder/Explorer, using `open` / `explorer.exe` from the server; files put there are picked up on the next `scanCourse`.

The server runs `scanCourse` when a course card opens, and through `fs.watch` while the server runs. Indexing uses the v1 queue, with jobs on the bridge. The card shows per-file status chips and a **Start indexing** button. Indexing runs only after the click, because it spends the student's subscription.

### 6.7 Ask panel (v1 §12.9)

Dropped as a separate UI: the chat is the Ask panel. The model tool **`shalav_context({ courseNumber?, stageId? })`** returns the knowledge boundary, the current stage and the relevant plan excerpt, so side questions respect v1 §6.8.

### 6.8 Settings (v1 §13)

The settings card (`shalav_settings`) keeps:
- language,
- data folder (read-only; changed through the MCPB settings),
- learning criteria (§13.3).

Removed: the Claude tab (models, key, thinking), Usage, Sync and the updater.

### 6.9 Sync (v1 §14)

The built-in Drive engine is removed. Replacement: the data folder may live inside any desktop-synced folder (Google Drive for desktop, OneDrive, iCloud Drive, Dropbox). The v1 data format already avoids most conflicts:
- events and practice sessions are per-device JSONL files;
- per-device generated files;
- content-addressed attachments.

The server handles provider conflict copies (`file (1).json`, `file (conflicted copy).json`) by ignoring them in readers and showing a warning in the settings card. `decideSyncAction` and the Drive code stay in git history (tag `desktop-v1-final`).

## 7. Code inventory: keep / adapt / drop

| Area (v1 path) | Verdict | v2 action |
| --- | --- | --- |
| `domain/dataSchemas.ts`, `domain/schemas.ts` | **Keep** | Settings schema: drop Claude/sync/usage fields with a migration that ignores them. |
| `lib/fs/{paths,atomicWrite,jsonl}.ts`, `lib/{ids,hash,time,device}.ts` | **Keep** | none |
| `lib/fs/fs.ts` (plugin-fs) | **Adapt** | Add `nodeFs()` implementing the same `Fs` port; the Tauri impl is deleted in the cleanup step. |
| `lib/storage.ts`, `stores/settings.ts` | **Adapt** | Settings JSON lives in `appConfig/settings.json` via Node fs; zustand store kept (works in Node). |
| `lib/firstRun.ts` | **Adapt** | Node paths (`os.homedir()`, `appConfig` = OS config dir/`il.shalav.app`). |
| `lib/secrets.ts`, `claude/{sdk,runtime,connect,keyCheck,cap,models,cache}.ts`, `domain/usage` | **Drop** | No API key. `models.ts` `TaskId` type moves to `claude/types.ts`. |
| `claude/gateway.ts` | **Drop** | Replaced by `server/bridge.ts` (`BridgeGateway`). |
| `claude/{types,errors,structured,tools,practiceTools,tutorTools,fake}.ts`, `claude/prompts/*` | **Keep** | Prompts unchanged except the tutor adaptation (§6.3) and the ask prompt (dropped). |
| `domain/{catalog,plan,progress,practice,retrieval,boundary,ingest(core)}` | **Keep** | Replace Tauri imports with injected Node deps (`catalog` fetch, `pageSource` cache dir, `ingest/runtime` native ops). |
| `lib/pdf.ts`, `lib/images.ts` (browser canvas, pdfjs) | **Adapt** | Node: `pdfjs-dist/legacy` + `@napi-rs/canvas` (prebuilt binaries per OS, bundled in the MCPB). The same function signatures. |
| `src-tauri/src/commands.rs` (sha256, import_copy, trash, heic) | **Port to TS** | `node:crypto`; `copyFile` with `name (2).pdf` collision naming; move to OS trash via `trash` npm (or `.shalav/trash/` fallback); HEIC: `sips` on macOS, unsupported note on Windows (as v1). |
| `domain/learn/engine.ts`, `context.ts`, `session.ts` | **Adapt / drop** | Keep the tool-outcome → event logic as functions used by MCP tool handlers. Drop transcript storage, `buildMessages` and compaction. Existing session files stay on disk, unused. |
| `domain/ask/` | **Drop** | Host chat replaces it. |
| `domain/practice/{engine,run,grade,assist,generate,exercises}.ts` | **Keep** | Through the bridge. |
| `render/*` (Markdown, KaTeX, Shiki, figures) | **Keep** | Used inside cards (grade card, exercise statements, solutions). |
| `components/ui/*`, `i18n/*` | **Keep** | Cards use the same components and strings; add `mcp.*` strings. |
| `screens/{Home,CourseHome,Learn/Widgets,Exercise,Practice,Settings(General,Learning)}` | **Adapt** | Become card views: replace `react-router` navigation and direct domain calls with `useShalav()` (tool calls through the `App` bridge). |
| `screens/{Onboarding,Ask,Settings(Claude,Usage,Sync,About)}`, `App.tsx` shell, `routes.tsx`, `sync/*` | **Drop** | none |
| `src-tauri/`, `tauri.conf.json`, release workflow, updater | **Drop** | Replaced by MCPB packaging and a new release workflow. |
| `e2e/` Playwright | **Adapt** | Run card bundles in a test host page (a fake `App` bridge) for RTL/a11y screenshots. |

## 8. Target layout

```
src/
  core/        ← moved from src/{domain,lib,claude,render,i18n,components} (git mv; imports via "@/...")
  server/
    main.ts         stdio entry (bundled to dist/server.js)
    server.ts       createServer(): tools, resources, prompts (transport-agnostic)
    bridge.ts       BridgeGateway + job queue
    native.ts       sha256 / importCopy / trash / heic / openFolder
    tools/          home.ts course.ts files.ts learn.ts exercise.ts practice.ts settings.ts jobs.ts
    resources.ts    ui:// card resources (read the built single-file HTML)
    instructions.ts server instructions text
  cards/
    main.tsx        one React entry; a `view` field in structuredContent picks the view
    useShalav.ts    App bridge hook: callTool, sendMessage, hostContext, view state
    views/          Home, Course, Lesson, Question, Exercise, Grade, Practice, Settings
mcpb/
  manifest.json, icon.png
```

Build:
- `vite build` with `vite-plugin-singlefile` produces one HTML (`dist/cards.html`), served as `ui://shalav/cards.html`.
- `esbuild` bundles the server into `dist/server.js` (Node 22, CJS or ESM, externals: `@napi-rs/canvas`).
- `mcpb pack` builds `shalav.mcpb`.

A single card resource with internal views keeps the CSP simple: one resource, no network, everything inlined.

## 9. Implementation steps (do in order; one commit each; tests in the same step)

Every step must leave `pnpm typecheck`, `pnpm lint` and `pnpm test` green. Steps marked 🧪 also need a manual check in Claude Desktop, which only the user can do; list those checks in `Progress.md`.

**M0 — Freeze v1.** Tag `desktop-v1-final` on `dev`. Add `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `vite-plugin-singlefile`, `esbuild`, `@napi-rs/canvas`. Before choosing versions, check npm for the current stable ones and that ext-apps' peer deps match the SDK major; record them in `DECISIONS.md`. Do not delete anything yet.

**M1 — Node platform layer.**
- `nodeFs()` implementing the `Fs` port.
- `server/native.ts` (TS ports of the Rust commands).
- Settings storage via Node fs.
- `firstRun` with Node paths.
- `catalog` with Node `fetch`.
- `lib/pdf.ts` and `lib/images.ts` working in Node (`@napi-rs/canvas`).
- Tests: run the existing domain tests unchanged, plus a `nodeFs` test on a temp dir, plus `importCopy` collision naming, plus rendering one PDF page to JPEG in Node.

**M2 — MCP server skeleton.**
- `createServer()` with server `instructions`, the `shalav_home` tool (text only for now), and the prompts "Shalav: my courses" and "Shalav: continue learning".
- `main.ts` over stdio.
- Test with the SDK's in-memory client transport: list tools, call `shalav_home`.
- `pnpm mcp:dev` runs the server under MCP Inspector.

**M3 — Host Bridge.**
- `BridgeGateway`, the job queue, `shalav_next_job`, `shalav_submit_job` (with the "wait for next job or result" behaviour), dedupe (§5.2), and cancel.
- Tests:
  - `callStructured` through the bridge, with a correction round;
  - two parallel jobs;
  - abort;
  - an image job (MCP image content).

**M4 — Cards pipeline.**
- `src/cards` single-file build, the `ui://shalav/cards.html` resource, and the `useShalav()` hook.
- The Home view renders from `shalav_home` `structuredContent`; RTL and theme come from settings and hostContext.
- A Playwright test host page with a fake bridge; screenshots for he/en × light/dark; axe.
- 🧪 The Home card renders in Claude Desktop.

**M5 — Courses and plan.**
- `course_lookup`, `course_create_request`, `shalav_course`, `plan_retry_request`.
- Add-course flow in the card, with the catalog label fix (§6.2), the checklist and job progress.
- Course view: plan, statuses, Watch out for.
- Test: create a course through the bridge with fake jobs answered by recorded outline/details fixtures; `plan.json` validates.
- 🧪 Build a real plan for 01040195 in Claude Desktop. Check 66–121 stages and the granularity rules. If they are not met, tune `prompts/plan.ts` and record the change.

**M6 — Files and indexing.**
- Upload chunks, Open folder, scan and watch, status chips, Start indexing, and text-first indexing (§5.2) through the bridge.
- Exercise crops, Improve plan.
- Tests:
  - upload reassembly;
  - text-first page selection;
  - an index job round trip with fixtures.

**M7 — Learn.**
- `shalav_start_lesson`, `shalav_lesson_status`, the tutor tools as MCP tools, the lesson card and question cards, `check_answer`.
- Completion, override, Next stage and reopen.
- The tutor prompt adaptation (§6.3).
- Tests:
  - event sequences for each tool handler (port the assertions from `learn/engine.test.ts`);
  - recap built from events.
- 🧪 A full lesson in Claude Desktop.

**M8 — Exercises and grading.**
- Exercise card, `attachment_upload`, Grade / Hint / Show solution through the bridge, and the Grade card.
- Learn `assign_exercise` integration.
- Tests: grade through the bridge with a fixture; the hint level sequence; solution reveal events.

**M9 — Practice.**
- `shalav_practice` and the Practice view, reusing the engine; prefetch of one item.
- Tests: practice through the bridge (port the `practice.test.ts` flows).

**M10 — Settings and context.**
- `shalav_settings` card (language, learning criteria), `shalav_context` (boundary for side questions), and sync-conflict-copy detection.
- Tests: settings round trip; conflict-copy detection.

**M11 — Packaging and docs.**
- `mcpb/manifest.json` (`user_config`: `data_folder`, `language`), icon, and the `pnpm pack:mcpb` script.
- New `.github/workflows/release.yml`: build and `mcpb pack` on a tag, then attach `shalav.mcpb`.
- Rewrite `README.md`, `INSTALL.en.md` and `INSTALL.he.md`: double-click `shalav.mcpb` → Install in Claude Desktop; Claude Code: `claude mcp add shalav -- node <path>/server.js`.
- 🧪 Install from the `.mcpb` on a clean macOS user and on Windows.

**M12 — Cleanup.**
- Delete `src-tauri/`, `sync/`, the dropped `claude/*` files, `domain/ask`, `domain/usage`, the dropped screens, `App.tsx`/`routes.tsx`/`main.tsx` (the desktop shell), and the Tauri dependencies.
- Move the remaining modules into `src/core/` (§8) with `git mv`.
- Keep all tests green. No TODO/FIXME.

**M13 — Hardening and acceptance (§10).**

## 10. Acceptance checklist v2 (Claude Desktop, macOS and Windows)

1. Double-clicking `shalav.mcpb` installs it. Typing "שלב" or choosing the Shalav prompt opens the Home card in Hebrew, RTL. No API key is asked for anywhere.
2. **Add course** → `01040195` shows the catalog card labelled as the catalog description. **Add** builds a plan with 66–121 fine-grained stages, which shows in the Course card. `plan.md` is readable.
3. `104066` → `01040066`. An unknown number offers manual entry.
4. Dropping a lecture PDF into Study materials copies it into `חומרי לימוד`; **Start indexing** indexes it. Exercises are found in an exam PDF, with crops.
5. **Learn** starts the current stage in the chat. MCQ and open-question cards work by clicking. An exercise card accepts a photo; **Grade** returns a Grade card with steps, missing items and mistakes. **Hint** levels 1-3 and **Show full solution** work.
6. Completion is enabled only when the criteria are met. The override lists the missing items, and the stage shows an amber badge.
7. A new chat → **Continue learning** recaps and continues the same stage.
8. Practice serves only eligible exercises, generates when none qualify, and shows a summary.
9. Mistakes appear in "Watch out for" and influence practice.
10. Switching to English flips the cards to LTR, and new lessons are taught in English.
11. A function graph request renders a `plot` figure inside a card (grade/solution) or in the host's own rendering.
12. A data folder inside Google Drive for desktop on two machines shows the same courses and progress, with no lost events.
13. In Claude Code (no cards), the same flows work through text options.
14. Existing v1 data in `~/Documents/Shalav` opens without migration.

## 11. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| The host model skips calling `shalav_next_job` after a card button | The `sendMessage` text says it explicitly; the server instructions repeat it; the card shows "Waiting for Claude…" and a **Nudge** button that re-sends the message. |
| Long jobs fill the chat context | Dedupe (§5.2), text-first PDFs, the "continue in a new chat" suggestion, one prefetch only. |
| MCP Apps API changes (spec 2026-01-26, SDK 1.x/2.x) | All bridge calls live in `cards/useShalav.ts`; pin versions; Playwright fake-host tests. |
| `@napi-rs/canvas` native binary per OS in the MCPB | Bundle both darwin (arm64 and x64) and win32-x64 prebuilt binaries; declare `compatibility.platforms`. Fallback: text-only indexing with a warning. |
| Grading quality with the host model differs from the v1 forced-tool + thinking setup | The same prompt and schema via `submit_job`; zod corrections are kept. Spot-check during M8. |
| Subscription rate limits interrupting a plan build | Jobs stay parked; the card shows **Resume** (re-sends the nudge). Plan building restarts from Pass A only if the server restarted. |
