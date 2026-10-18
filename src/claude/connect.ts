import { appConfigDir } from "@tauri-apps/api/path";
import { logUsage } from "@/domain/usage/usage";
import { API_KEY_ACCOUNT, secretSet } from "@/lib/secrets";
import { initClaude, initClaudeFromKeyring } from "./runtime";

// Usage goes to the device-local usage.jsonl (spec 9.7). Cap dialog etc. join these hooks in Step 11.
const hooks = {
  onUsage: async (e: Parameters<typeof logUsage>[1]) => logUsage(await appConfigDir(), e),
};

/** Called after a successful key check: persist to the credential store, then build the gateway. */
export async function saveAndConnect(apiKey: string) {
  const key = apiKey.trim();
  await secretSet(API_KEY_ACCOUNT, key);
  await initClaude(key, hooks);
}

/** App startup: gateway from the stored key, if any. */
export const connectFromKeyring = () => initClaudeFromKeyring(hooks);
