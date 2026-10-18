import { ClaudeError } from "./errors";
import { createGateway, type GatewayDeps, type UsageEntry } from "./gateway";
import { listModelIds, makeClient, sdkTransport } from "./sdk";
import { modelCatalog } from "./models";
import type { ClaudeGateway } from "./types";
import { useSettings } from "@/stores/settings";
import { API_KEY_ACCOUNT, secretGet } from "@/lib/secrets";

let gateway: ClaudeGateway | undefined;

/** Build the app's gateway from an API key (kept in memory only). Cap dialog / usage log are injected by later steps. */
export async function initClaude(
  apiKey: string,
  hooks: Pick<GatewayDeps, "onAuthError" | "beforeRequest" | "shrinkImages" | "onModelSubstituted"> & {
    onUsage?: (e: UsageEntry) => void | Promise<void>;
  } = {},
): Promise<ClaudeGateway> {
  const client = await makeClient(apiKey);
  gateway = createGateway({
    transport: sdkTransport(client),
    settings: () => useSettings.getState().settings,
    availableModels: modelCatalog(() => listModelIds(client)),
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
