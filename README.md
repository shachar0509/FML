# Shalav (שלב)

Study tutor for university courses (Technion, Hebrew University, Reichman, Braude; the student picks one on first use and it is locked), delivered as a **local MCP connector for Claude Desktop**. Students install `shalav.mcpb`; their own Claude subscription does the AI work (no API key, no cost to us). Cards inside the chat (MCP Apps) show the plan, lessons, exercises and practice.

- Install and use: [INSTALL.en.md](INSTALL.en.md) · [INSTALL.he.md](INSTALL.he.md)
- Design: `Shalav — MCP Connector Transition Plan v2.md` (v1 spec `Shalav — Product & Technical Specification v1.md` stays normative where v2 is silent)
- Progress and decisions: `Progress.md`, `DECISIONS.md`
- The old Tauri desktop app is frozen at git tag `desktop-v1-final`.

## Develop
Node 22 and pnpm.
```bash
pnpm install
pnpm test            # vitest, no network
pnpm e2e             # Playwright against the card bundle in a fake host (needs: pnpm exec playwright install chromium)
pnpm typecheck && pnpm lint
pnpm mcp:dev         # build cards + server, open the MCP Inspector
pnpm pack:mcpb       # -> dist/shalav.mcpb
pnpm smoke:mcpb      # unpack it and talk to it over stdio
```
Env overrides: `SHALAV_DATA_FOLDER`, `SHALAV_LANGUAGE` (first run), `SHALAV_CONFIG_DIR`, `SHALAV_CACHE_DIR`, `SHALAV_DOCUMENTS_DIR`, `SHALAV_CARDS_HTML`.

## Layout
`src/server/` MCP server, tools and Host Bridge · `src/cards/` the single-file card UI · `src/domain/`, `src/claude/`, `src/lib/` shared logic from v1 · `mcpb/` manifest and icon · `scripts/` build and pack.

## Release
Push a tag `vX.Y.Z`: `.github/workflows/release.yml` tests, runs `pnpm pack:mcpb` + `pnpm smoke:mcpb`, and attaches `shalav.mcpb` to the GitHub release. The `.mcpb` bundles the macOS (arm64, x64) and Windows (x64) canvas binaries; it is unsigned, so Claude Desktop may show an "unverified extension" notice.
