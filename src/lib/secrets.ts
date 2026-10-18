// Thin wrapper over the Rust keyring commands (spec 15.2). The key lives in memory only after startup.
import { invoke } from "@tauri-apps/api/core";

export const API_KEY_ACCOUNT = "anthropic_api_key";
export const secretGet = (account: string) => invoke<string | null>("secret_get", { account });
export const secretSet = (account: string, value: string) => invoke("secret_set", { account, value }).then(() => undefined);
export const secretDelete = (account: string) => invoke("secret_delete", { account }).then(() => undefined);
