import { ClaudeError } from "./errors";
import { createGateway, type GatewayDeps, type UsageEntry } from "./gateway";
import { listModelIds, makeClient, sdkTransport } from "./sdk";
import { modelCatalog, TASKS } from "./models";
import type { ClaudeGateway } from "./types";
import { useSettings } from "@/stores/settings";
import { API_KEY_ACCOUNT, secretGet } from "@/lib/secrets";

let gateway: ClaudeGateway | undefined;
let catalog: (() => Promise<string[]>) | undefined;

/** Build the app's gateway from an API key (kept in memory only). Cap dialog / usage log are injected by later steps. */
export async function initClaude(
  apiKey: string,
  hooks: Pick<GatewayDeps, "onAuthError" | "beforeRequest" | "shrinkImages" | "onModelSubstituted"> & {
    onUsage?: (e: UsageEntry) => void | Promise<void>;
  } = {},
): Promise<ClaudeGateway> {
  const client = await makeClient(apiKey);
  catalog = modelCatalog(() => listModelIds(client));
  gateway = createGateway({
    transport: sdkTransport(client),
    settings: () => useSettings.getState().settings,
    availableModels: catalog,
    ...hooks,
  });
  return gateway;
}

/** Startup: read the key from the credential store; undefined = onboarding must ask for it. */
export async function initClaudeFromKeyring(hooks?: Parameters<typeof initClaude>[1]) {
  const key = await secretGet(API_KEY_ACCOUNT).catch(() => null);
  return key ? initClaude(key, hooks) : undefined;
}

export function claude(): ClaudeGateway {
  if (!gateway) throw new ClaudeError("auth", "No API key configured");
  return gateway;
}

/** Settings > Remove key: AI features stay off (claude() throws auth) until a key is connected again. */
export function disconnectClaude() {
  gateway = undefined;
  catalog = undefined;
}

/** Cached models.list ids for the Settings dropdowns; falls back to the default models when unavailable. */
export async function availableModelIds(): Promise<string[]> {
  const ids = (await catalog?.().catch(() => [])) ?? [];
  return ids.length ? ids : [...new Set(Object.values(TASKS).map((x) => x.model))];
}
