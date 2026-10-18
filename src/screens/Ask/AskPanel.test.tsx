import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeClaudeGateway, usage0 } from "@/claude/fake";
import i18n from "@/i18n";

const gw = new FakeClaudeGateway([{ content: [{ type: "text", text: "ANSWER-X" }], usage: usage0 }]);
vi.mock("@/claude/runtime", () => ({ claude: () => gw }));
const { AskPanel } = await import("./AskPanel");

beforeEach(() => i18n.changeLanguage("en"));

describe("AskPanel", () => {
  it("chips when empty, answer after send, New question clears", async () => {
    render(<MemoryRouter><AskPanel onClose={() => undefined} /></MemoryRouter>);
    const chip = screen.getByText("What does this notation mean?");
    fireEvent.click(chip);
    const box = screen.getByPlaceholderText(/Ask anything small/) as HTMLTextAreaElement;
    expect(box.value).toBe("What does this notation mean?");
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("ANSWER-X")).toBeTruthy());
    expect(screen.queryByText("Remind me what … is")).toBeNull();
    expect(gw.calls[0]?.task).toBe("ask");
    fireEvent.click(screen.getByText("New question"));
    await waitFor(() => expect(screen.queryByText("ANSWER-X")).toBeNull());
    expect(screen.getByText("Remind me what … is")).toBeTruthy();
  });
});
