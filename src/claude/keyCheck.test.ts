import { describe, expect, it } from "vitest";
import { keyErrorKey } from "./keyCheck";

describe("keyErrorKey", () => {
  it("maps statuses to 12.8 copy keys", () => {
    expect(keyErrorKey({ status: 401 })).toBe("api.invalidKey");
    expect(keyErrorKey({ status: 400, message: "Your credit balance is too low" })).toBe("api.noCredit");
    expect(keyErrorKey({ status: 400, message: "bad" })).toBe("api.failed");
    expect(keyErrorKey(new Error("fetch failed"))).toBe("net.offline");
    expect(keyErrorKey({ status: 529 })).toBe("api.failed");
  });
});
