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
- [ ] M7. Learn (🧪)
- [ ] M8. Exercises and grading
- [ ] M9. Practice
- [ ] M10. Settings and context
- [ ] M11. Packaging (MCPB) and docs (🧪)
- [ ] M12. Cleanup (delete Tauri/sync/API code, move to src/core)
- [ ] M13. Hardening + acceptance checklist v2

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
