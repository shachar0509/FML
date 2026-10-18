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
