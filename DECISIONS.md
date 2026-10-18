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
