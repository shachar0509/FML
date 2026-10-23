import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import "@/core/i18n";
import type { FileRow, FilesData } from "../types";
import { Files } from "./Files";

const rows = (n: number, from: number): FileRow[] =>
  Array.from({ length: n }, (_, i) => ({ sha: `s${from + i}`, name: `f${from + i}.pdf`, pages: 1, status: "indexed", error: null, exercises: 0, solved: 0 }));
const list = (m: number, e: number, t: number): FilesData => ({
  view: "files", language: "he", theme: "system", number: "1", moodle: null,
  materials: rows(m, 0), exercises: rows(e, 100), teacher: rows(t, 200),
});
const zone = (name: RegExp) => screen.getByRole("button", { name });
const poll = () => act(() => vi.advanceTimersByTimeAsync(1500));

afterEach(() => vi.useRealTimers());

it("opens a zone that fits one page, keeps it as decided through the poll", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let next = list(3, 0, 12);
  render(<Files number="1" callTool={async () => ({ structuredContent: next })} reload={() => undefined} />);
  const mats = await screen.findByRole("button", { name: /חומרי לימוד/ });
  expect(mats).toHaveAttribute("aria-expanded", "true"); // 3 files
  expect(zone(/הערות המרצה/)).toHaveAttribute("aria-expanded", "false"); // 12 files
  expect(screen.queryByText("f200.pdf")).toBeNull();
  expect(screen.queryByRole("button", { name: /תרגילים לדוגמה/ })).toBeNull(); // empty: no header

  fireEvent.click(mats); // the student collapses a short zone
  next = list(12, 1, 2); // materials past a page, exercises appear, teacher shrinks
  await poll();
  await waitFor(() => expect(zone(/תרגילים לדוגמה/)).toHaveAttribute("aria-expanded", "true")); // decided at its first files
  expect(zone(/חומרי לימוד/)).toHaveAttribute("aria-expanded", "false"); // the student's choice wins
  expect(zone(/הערות המרצה/)).toHaveAttribute("aria-expanded", "false"); // decided once, not re-derived

  next = list(3, 15, 2); // exercises grow past a page while open
  await poll();
  await waitFor(() => expect(screen.getByRole("navigation", { name: /תרגילים לדוגמה/ })).toBeVisible()); // pager: 15 rows
  expect(zone(/תרגילים לדוגמה/)).toHaveAttribute("aria-expanded", "true"); // stays open
  expect(zone(/חומרי לימוד/)).toHaveAttribute("aria-expanded", "false");
});
