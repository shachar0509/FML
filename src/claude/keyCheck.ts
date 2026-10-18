import { listModelIds, makeClient } from "./sdk";

export type KeyCheckError = "api.invalidKey" | "api.noCredit" | "net.offline" | "api.failed";

/** Maps an SDK error (status + message) to a 12.8 copy key. */
export function keyErrorKey(e: unknown): KeyCheckError {
  const { status, message } = (e ?? {}) as { status?: number; message?: string };
  if (status === 401 || status === 403) return "api.invalidKey";
  if (status === 400 && /credit/i.test(message ?? "")) return "api.noCredit";
  if (status === undefined) return "net.offline";
  return "api.failed";
}

/** Spec 12.2: key check = models.list. Returns null when the key works. */
export async function checkApiKey(apiKey: string): Promise<KeyCheckError | null> {
  try {
    await listModelIds(await makeClient(apiKey.trim()));
    return null;
  } catch (e) {
    return keyErrorKey(e);
  }
}
