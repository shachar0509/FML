import { appConfigDir } from "@tauri-apps/api/path";
import i18n from "@/i18n";
import { toast } from "@/components/ui/toaster";
import { costUsd, logUsage, readUsage, summarizeMonth } from "@/domain/usage/usage";
import { API_KEY_ACCOUNT, secretSet } from "@/lib/secrets";
import { useSettings } from "@/stores/settings";
import { makeCapGate } from "./cap";
import { initClaude, initClaudeFromKeyring } from "./runtime";

const gate = makeCapGate({
  loadSpent: async () => {
    const d = new Date();
    return summarizeMonth(await readUsage(await appConfigDir()), `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`).total.usd;
  },
  capUsd: () => useSettings.getState().settings.usage.monthlyCapUsd,
  warn: () => toast({ message: i18n.t("usage.warn80") }),
  confirm: async () =>
    (await import("@tauri-apps/plugin-dialog")).ask(i18n.t("usage.capBody"), {
      title: i18n.t("usage.capTitle"),
      kind: "warning",
      okLabel: i18n.t("usage.continue"),
      cancelLabel: i18n.t("usage.stop"),
    }),
});

// Usage goes to the device-local usage.jsonl (spec 9.7); the cap gate runs before every request.
const hooks = {
  beforeRequest: () => gate.beforeRequest(),
  onUsage: async (e: Parameters<typeof logUsage>[1]) => {
    gate.record(costUsd(e) ?? 0);
    await logUsage(await appConfigDir(), e);
  },
};

/** Called after a successful key check: persist to the credential store, then build the gateway. */
export async function saveAndConnect(apiKey: string) {
  const key = apiKey.trim();
  await secretSet(API_KEY_ACCOUNT, key);
  await initClaude(key, hooks);
}

/** App startup: gateway from the stored key, if any. */
export const connectFromKeyring = () => initClaudeFromKeyring(hooks);
