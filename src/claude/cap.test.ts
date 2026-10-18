import { describe, expect, it, vi } from "vitest";
import { makeCapGate } from "./cap";

describe("cap gate", () => {
  it("warns once at 80 %, asks at 100 %, remembers Continue, refuses on Stop", async () => {
    const warn = vi.fn();
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const g = makeCapGate({ loadSpent: async () => 8, capUsd: () => 10, warn, confirm });
    await g.beforeRequest();
    await g.beforeRequest();
    expect(warn).toHaveBeenCalledTimes(1);
    g.record(2);
    await expect(g.beforeRequest()).rejects.toMatchObject({ kind: "cap_stopped" });
    await g.beforeRequest();
    await g.beforeRequest();
    expect(confirm).toHaveBeenCalledTimes(2);
  });
});
