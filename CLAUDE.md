# Shalav (v2: MCP connector for Claude Desktop)

Start with `Progress.md` (status, commands, code map, gotchas, open items). It is the handoff between sessions.

## Rules
- Branch `dev`; one commit per M-step, tests in the same commit; update `Progress.md` after every step; silent-spec choices go to `DECISIONS.md`; stop after each step.
- Never store keys in files.

## Reading docs (keep context small)
- `Shalav — MCP Connector Transition Plan v2.md` is the governing doc (391 lines). Read only the section you need: §5 Host Bridge L79, §6 feature mapping L126, §9 steps L280, §10 acceptance L365.
- `Shalav — Product & Technical Specification v1.md` (1861 lines) is mostly obsolete (Tauri, API key, Drive sync, Ask panel). Never read it whole. Only these sections still apply, so read them by line range when the task touches them: §3 data layout L185–417, §4 plan/granularity L418–548, §6.8 knowledge boundary L708–730, §8 progress L859–910, §10 prompts L1029–1345, §11.3 figures L1361–1424.
- `DECISIONS.md`, `OUTPUT_ALIGN.md`, `src/core/i18n/{he,en}.json`, and big sources (`learnTools.ts`, `Markdown.tsx`, `test-advanced.ts`, `test-host.tsx`, `Files.tsx`): grep first, then read only the matching range.

## Tests
- `pnpm typecheck`, `pnpm lint`, `pnpm test`. Reporters are compact (vitest `dot`, Playwright `line`); failures still print in full.
- e2e: run only what changed: `pnpm e2e:changed`, or `pnpm exec playwright test e2e/tests/<spec>.spec.ts`. Never the full suite by default.
- Don't open the screenshots in `e2e/tests_output/`; the user reviews them. Open one only if the user asks or a visual failure can't be understood otherwise.
