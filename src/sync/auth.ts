import { secretDelete, secretGet, secretSet } from "@/lib/secrets";
import { ReconnectError, OfflineError } from "./types";

export const REFRESH_ACCOUNT = "google_refresh_token";
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
const CLIENT_SECRET = import.meta.env.VITE_GOOGLE_CLIENT_SECRET ?? "";
export const googleConfigured = CLIENT_ID !== "";
const SCOPE = "https://www.googleapis.com/auth/drive.file openid email";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rand = (n: number) => b64url(crypto.getRandomValues(new Uint8Array(n)));

export async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = rand(48);
  return { verifier, challenge: b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))) };
}

export function authUrl(port: number, challenge: string, state: string, clientId = CLIENT_ID): string {
  const p = new URLSearchParams({
    client_id: clientId, redirect_uri: `http://127.0.0.1:${port}`, response_type: "code", scope: SCOPE, code_challenge: challenge,
    code_challenge_method: "S256", access_type: "offline", prompt: "consent", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export function emailFromIdToken(idToken: string): string {
  const payload = idToken.split(".")[1] ?? "";
  const json = new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
  return (JSON.parse(json) as { email?: string }).email ?? "";
}

type TokenResp = { access_token?: string; expires_in?: number; refresh_token?: string; id_token?: string; error?: string };

async function tokenCall(body: Record<string, string>, fetchFn: typeof fetch): Promise<TokenResp> {
  let res: Response;
  try {
    res = await fetchFn(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...body }),
    });
  } catch (e) {
    throw new OfflineError(e instanceof Error ? e.message : String(e));
  }
  const j = (await res.json().catch(() => ({}))) as TokenResp;
  if (!res.ok) {
    if (j.error === "invalid_grant") throw new ReconnectError("invalid_grant");
    throw new Error(`Google token error: ${j.error ?? res.status}`);
  }
  return j;
}

const httpFetch = async (): Promise<typeof fetch> => (await import("@tauri-apps/plugin-http")).fetch as typeof fetch;

/** Access token kept in memory, refreshed 60 s before expiry (14.2). */
export function createTokenSource(o: { getRefresh?: () => Promise<string | null>; fetchFn?: () => Promise<typeof fetch>; now?: () => number } = {}) {
  let cached: { token: string; exp: number } | null = null;
  const now = o.now ?? Date.now;
  return {
    async token(): Promise<string> {
      if (cached && cached.exp - 60_000 > now()) return cached.token;
      const refresh = await (o.getRefresh ?? (() => secretGet(REFRESH_ACCOUNT)))();
      if (!refresh) throw new ReconnectError("no refresh token");
      const r = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh }, await (o.fetchFn ?? httpFetch)());
      if (!r.access_token) throw new Error("Google: no access token");
      cached = { token: r.access_token, exp: now() + (r.expires_in ?? 3600) * 1000 };
      return cached.token;
    },
    clear() {
      cached = null;
    },
  };
}

const PAGE = `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;margin-top:20vh"><h2>You can return to Shalav</h2><h2 dir="rtl">אפשר לחזור ל-Shalav</h2>`;

/** Loopback PKCE sign-in (14.2). Stores the refresh token in the credential store; returns the account email. */
export async function signIn(): Promise<string> {
  const oauth = await import("@fabianlars/tauri-plugin-oauth");
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  const { verifier, challenge } = await pkce();
  const state = rand(16);
  let unlisten = () => {};
  const urlP = new Promise<string>((resolve, reject) => {
    void oauth.onUrl(resolve).then((u) => (unlisten = u));
    setTimeout(() => reject(new Error("Sign-in timed out")), 5 * 60_000);
  });
  const port = await oauth.start({ response: PAGE });
  try {
    await openUrl(authUrl(port, challenge, state));
    const u = new URL(await urlP);
    if (u.searchParams.get("state") !== state) throw new Error("Sign-in state mismatch");
    const code = u.searchParams.get("code");
    if (!code) throw new Error(u.searchParams.get("error") ?? "Sign-in cancelled");
    const r = await tokenCall(
      { grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: `http://127.0.0.1:${port}` },
      await httpFetch(),
    );
    if (!r.refresh_token) throw new Error("Google returned no refresh token");
    await secretSet(REFRESH_ACCOUNT, r.refresh_token);
    return r.id_token ? emailFromIdToken(r.id_token) : "";
  } finally {
    unlisten();
    await oauth.cancel(port).catch(() => undefined);
  }
}

export async function revokeAndForget(): Promise<void> {
  const refresh = await secretGet(REFRESH_ACCOUNT);
  if (refresh) await (await httpFetch())(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: "POST" }).catch(() => undefined);
  await secretDelete(REFRESH_ACCOUNT);
}
