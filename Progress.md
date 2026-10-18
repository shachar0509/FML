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
- [ ] 6. Progress
- [ ] 7. Ingestion
- [ ] 8. Rendering
- [ ] 9. Learn
- [ ] 10. Practice
- [ ] 11. Settings + Ask panel
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
