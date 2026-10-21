import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import "@/core/i18n";
import { Waiting } from "./Waiting";

it("shows Nudge only after the delay and re-sends the request", async () => {
  const say = vi.fn<(t: string) => Promise<void>>(async () => undefined);
  render(<Waiting say={say} afterMs={30} />);
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.click(await screen.findByRole("button"));
  expect(say.mock.calls[0]?.[0]).toContain("shalav_next_job");
});
