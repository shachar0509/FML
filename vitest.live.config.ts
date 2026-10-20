import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vite.config";

// Real-API checks: SHALAV_LIVE_KEY=... pnpm vitest run -c vitest.live.config.ts [file]. Never run in CI.
export default mergeConfig(base, defineConfig({ test: { include: ["live/**/*.live.test.ts"], exclude: [], testTimeout: 1_800_000, hookTimeout: 600_000 } }));
