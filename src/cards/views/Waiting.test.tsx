import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import "@/core/i18n";
import { Waiting } from "./Waiting";

it("shows Nudge only after the delay and re-sends the request", async () => {
  const go = vi.fn<(r?: unknown) => Promise<void>>(async () => undefined);
  render(<Waiting go={go} afterMs={30} />);
  expect(screen.queryByRole("button")).toBeNull();
  fireEvent.click(await screen.findByRole("button"));
  expect(go).toHaveBeenCalledWith();
});
