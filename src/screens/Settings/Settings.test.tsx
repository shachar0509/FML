import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { DEFAULT_SETTINGS } from "@/domain/schemas";
import { useSettings } from "@/stores/settings";
import { SettingsScreen } from "./index";

vi.mock("@/lib/storage", () => ({ defaultDataRoot: async () => "/d", readJson: async () => null, writeJson: async () => undefined }));
vi.mock("@tauri-apps/api/path", () => ({ appConfigDir: async () => "/cfg" }));
vi.mock("@/lib/secrets", () => ({ API_KEY_ACCOUNT: "k", secretGet: async () => "sk-ant-abcdefgh1234", secretSet: vi.fn(), secretDelete: vi.fn() }));
vi.mock("@/domain/usage/usage", async (orig) => ({
  ...(await orig<typeof import("@/domain/usage/usage")>()),
  readUsage: async () => {
    const e = (task: string, course: string | undefined, n: number) => ({
      ts: new Date().toISOString(), task, model: "m", courseNumber: course,
      input_tokens: n, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
    });
    return [e("tutor", "104031", 1000), e("grading", "104031", 500)];
  },
}));

const open = (tab: string) => {
  render(<SettingsScreen />);
  fireEvent.mouseDown(screen.getByRole("tab", { name: tab }), { button: 0 });
  fireEvent.click(screen.getByRole("tab", { name: tab }));
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  useSettings.setState({ settings: structuredClone(DEFAULT_SETTINGS) });
});

describe("Settings", () => {
  it("warns on model change and Cancel reverts", async () => {
    open("Claude");
    const sel = (await screen.findByLabelText("Teaching")) as HTMLSelectElement;
    const def = sel.value;
    const other = Array.from(sel.options).find((o) => o.value !== def)?.value ?? "";
    expect(other).not.toBe("");
    fireEvent.change(sel, { target: { value: other } });
    expect(await screen.findByText("Change the model?")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText("Change the model?")).toBeNull());
    expect(useSettings.getState().settings.models.tutor).toBeUndefined();
    expect((screen.getByLabelText("Teaching") as HTMLSelectElement).value).toBe(def);
  });

  it("warns when turning thinking off; confirm applies, cancel keeps", async () => {
    open("Claude");
    const sw = await screen.findByRole("switch", { name: "Think carefully before grading" });
    fireEvent.click(sw);
    fireEvent.click(await screen.findByText("Cancel", { selector: "button" }));
    await waitFor(() => expect(screen.queryByText("Change the model?")).toBeNull());
    expect(useSettings.getState().settings.grading.thinking).toBe(true);
    fireEvent.click(sw);
    fireEvent.click(await screen.findByText("Change anyway"));
    expect(useSettings.getState().settings.grading.thinking).toBe(false);
  });

  it("Learning restore defaults", async () => {
    useSettings.getState().update({ learning: { ...DEFAULT_SETTINGS.learning, minExercises: 5 } });
    open("Learning");
    fireEvent.click(await screen.findByText("Restore defaults"));
    expect(useSettings.getState().settings.learning).toEqual(DEFAULT_SETTINGS.learning);
  });

  it("Usage renders tables from the log", async () => {
    open("Usage");
    expect(await screen.findByText("1,502 tokens")).toBeTruthy();
    expect(screen.getByText("Checking solutions")).toBeTruthy();
    expect(screen.getAllByText("104031").length).toBe(1);
  });
});
