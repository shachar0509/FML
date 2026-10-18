import { describe, expect, it, vi } from "vitest";
import { authUrl, createTokenSource, emailFromIdToken, pkce } from "./auth";
import { ReconnectError } from "./types";

describe("google auth", () => {
  it("builds a PKCE url, reads the email, caches tokens and maps invalid_grant", async () => {
    const { verifier, challenge } = await pkce();
    expect(challenge).not.toBe(verifier);
    const u = new URL(authUrl(5555, challenge, "st", "cid"));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5555");
    const idt = `x.${btoa(JSON.stringify({ email: "a@b.c" }))}.y`;
    expect(emailFromIdToken(idt)).toBe("a@b.c");

    let t = 0;
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "T", expires_in: 3600 }), { status: 200 }));
    const src = createTokenSource({ getRefresh: async () => "r", fetchFn: async () => f as unknown as typeof fetch, now: () => t });
    expect(await src.token()).toBe("T");
    await src.token();
    expect(f).toHaveBeenCalledTimes(1);
    t = 3_600_000 - 30_000; // inside the 60 s refresh window
    await src.token();
    expect(f).toHaveBeenCalledTimes(2);
    const bad = createTokenSource({ getRefresh: async () => "r", fetchFn: async () => (async () => new Response('{"error":"invalid_grant"}', { status: 400 })) as unknown as typeof fetch });
    await expect(bad.token()).rejects.toBeInstanceOf(ReconnectError);
  });
});
