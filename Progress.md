# Progress

Spec: `Shalav — Product & Technical Specification v1.md` (section 19 = implementation order).
Rules: work only on branch `dev`; update this file after every step; stop after each step so the user can compact.
The app lives in the repo root (spec layout: `src/`, `src-tauri/`, ...). Environment: Node 22, pnpm; **Rust/cargo is NOT installed** on this machine (Rust code is written but not compiled until it is).

## Steps (spec §19)
- [x] 1. Scaffold — DONE (see log)
- [x] 2. Data layer — DONE (see log)
- [ ] 3. Claude layer
- [ ] 4. Onboarding
- [ ] 5. Courses (catalog, plan generation)
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
