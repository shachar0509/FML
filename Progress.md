# Progress

Spec: `Shalav — Product & Technical Specification v1.md` (section 19 = implementation order).
Rules: work only on branch `dev`; update this file after every step; stop after each step so the user can compact.
The app lives in the repo root (spec layout: `src/`, `src-tauri/`, ...). Environment: Node 22, pnpm; **Rust/cargo is NOT installed** on this machine (Rust code is written but not compiled until it is).

## Steps (spec §19)
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
- [ ] 12. Sync
- [ ] 13. Release
- [ ] 14. Hardening

## Log

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
