import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createGateway } from "@/claude/gateway";
import { makeClient, sdkTransport } from "@/claude/sdk";
import type { ClaudeGateway } from "@/claude/types";
import { technionSource } from "@/domain/catalog/catalog";
import { setDeviceId } from "@/lib/device";
import { setFs } from "@/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";

export const KEY = process.env.SHALAV_LIVE_KEY ?? "";
export const OUT = process.env.SHALAV_LIVE_OUT ?? "/tmp/shalav-live";

/** Fresh in-memory data root + a real gateway. Usage is summed so each run reports its cost in tokens. */
export async function liveEnv(language: "he" | "en" = "he") {
  setFs(memFs());
  setDeviceId("live");
  useSettings.setState((s) => ({ settings: { ...s.settings, dataRoot: "/r", language } }));
  const usage: unknown[] = [];
  const gw: ClaudeGateway = createGateway({
    transport: sdkTransport(await makeClient(KEY)),
    settings: () => useSettings.getState().settings,
    onUsage: (e) => void usage.push(e),
  });
  return { gw, usage };
}

export const catalog = () =>
  technionSource({ cacheDir: "/cache/catalog", fetchText: async (url) => { const r = await fetch(url); return { status: r.status, text: r.status === 200 ? await r.text() : "" }; } });

export function save(name: string, content: unknown) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), typeof content === "string" ? content : JSON.stringify(content, null, 2));
}
