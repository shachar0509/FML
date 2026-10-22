import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vite.config";

// pnpm eval:* — real-model semantic evals through `claude -p` (spends tokens; never part of pnpm test)
export default mergeConfig(base, defineConfig({ test: { include: ["src/test/eval/**/*.eval.ts"], environment: "node", testTimeout: 900_000, hookTimeout: 900_000 } }));
