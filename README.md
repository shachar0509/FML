# Shalav

Desktop study app for Technion courses (Tauri 2 + React). Spec: `Shalav — Product & Technical Specification v1.md`. Progress log: `Progress.md`.

## 1. Prerequisites
Rust stable, Node 22, pnpm. macOS: Xcode Command Line Tools. Windows: Visual Studio Build Tools (C++) and WebView2.

## 2. Develop
```bash
pnpm install
pnpm tauri dev      # desktop app (needs Rust)
pnpm dev            # UI only in a browser, http://localhost:1420 (no keychain/files/sync)
pnpm test           # vitest, no network
(cd src-tauri && cargo test)
```
Optional `.env.local`:
```
VITE_GOOGLE_CLIENT_ID=...
VITE_GOOGLE_CLIENT_SECRET=...
VITE_SHALAV_DEV_MODEL=claude-haiku-5-5   # use one cheap model for every task
```
Without the Google variables the Sync UI is hidden.

## 3. Google Cloud setup (free)
1. Create a project and enable the **Google Drive API**.
2. OAuth consent screen: **External**, app name Shalav, support email, scopes `drive.file`, `openid`, `email`.
3. Publish the app to **In production**. These scopes are non-sensitive, so no verification review is needed. In Testing mode refresh tokens expire after 7 days and only test users can sign in.
4. Create an OAuth client of type **Desktop app**; put the id and secret in `.env.local` and in the GitHub secrets.

## 4. Updater keys
```bash
pnpm tauri signer generate -w ~/.tauri/shalav.key
```
Store the private key and its password as GitHub secrets `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Put the public key in `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`). Replace `<owner>/<repo>` in the updater endpoint and in `capabilities/default.json`.

## 5. Icons
`pnpm tauri icon path/to/1024px-source.png` (the current icons are placeholders).

## 6. Pricing
Fill `src/claude/pricing.json` from Anthropic's pricing page (until then the Usage tab shows tokens only).

## 7. Release
```bash
pnpm version <x.y.z>      # bumps package.json and tags
git push && git push --tags
```
CI (`.github/workflows/release.yml`) tests, builds the universal `.dmg` and the Windows NSIS `.exe`, and publishes them with `latest.json` to GitHub Releases. Required secrets: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_CLIENT_SECRET`. Friends get one link: the release page. See `INSTALL.en.md` / `INSTALL.he.md`.
