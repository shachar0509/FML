import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { DEFAULT_SETTINGS } from "@/domain/schemas";
import { useSettings } from "@/stores/settings";
import { Sync } from "@/screens/Settings/Sync";
import { SyncIndicator } from "./SyncIndicator";

const m = vi.hoisted(() => ({ state: {} as Record<string, unknown>, available: true }));
vi.mock("@/sync/runtime", async () => {
  const { create } = await import("zustand");
  return {
    get syncAvailable() {
      return m.available;
    },
    useSyncStatus: create(() => m.state),
    connectSync: vi.fn(),
    disconnectSync: vi.fn(),
    syncNow: vi.fn(),
    retrySync: vi.fn(),
  };
});

const setStatus = async (status: object, extra: object = {}) => {
  const { useSyncStatus } = await import("@/sync/runtime");
  (useSyncStatus as unknown as { setState: (s: object) => void }).setState({ status: { pending: 0, lastSyncAt: null, error: null, ...status }, email: null, conflicts: [], ...extra });
};
const ui = () => (
  <MemoryRouter>
    <SyncIndicator />
    <Sync />
  </MemoryRouter>
);

beforeEach(async () => {
  m.available = true;
  await i18n.changeLanguage("en");
  useSettings.setState({ settings: { ...structuredClone(DEFAULT_SETTINGS), dataRoot: "/d" } });
});

describe("sync UI", () => {
  it.each([
    [{ kind: "off" }, "Sync is off"],
    [{ kind: "syncing", pending: 3 }, "Syncing 3 files…"],
    [{ kind: "offline" }, "Offline · changes will sync later"],
    [{ kind: "error", error: "boom" }, "boom"],
    [{ kind: "synced", lastSyncAt: new Date().toISOString() }, "Synced · this minute"],
  ])("tooltip for %j", async (status, text) => {
    await setStatus(status);
    render(ui());
    expect(screen.getByRole("button", { name: "Sync status" }).getAttribute("title")).toBe(text);
  });

  it("shows email, disconnect and conflicts when connected", async () => {
    await setStatus({ kind: "synced", lastSyncAt: new Date().toISOString() }, { email: "a@b.c", conflicts: [{ relPath: "courses/x.json", at: "t" }] });
    render(ui());
    expect(screen.getByText("a@b.c")).toBeTruthy();
    expect(screen.getByText("Disconnect")).toBeTruthy();
    expect(screen.getByText("Show in folder")).toBeTruthy();
  });

  it("is unavailable without a client id", async () => {
    m.available = false;
    await setStatus({ kind: "off" });
    render(ui());
    expect(screen.getByText("Sync is not available in this build")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sync status" })).toBeNull();
  });
});
