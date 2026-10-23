import { act, fireEvent, render, screen } from "@testing-library/react";
import i18n from "i18next";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@/core/i18n";
import type { Go, Host, StepData } from "../types";
import { Step } from "./Step";

const data = { view: "step", language: "he", theme: "light", titleMd: "T", bodyMd: "B", figure: null } as unknown as StepData;
const slide = { ...data, beats: [{ md: "b1" }, { md: "b2" }, { md: "b3" }] } as StepData;
let answerMd: string | null = null;
const callTool = vi.fn<Host["callTool"]>(async () => ({ structuredContent: { answerMd } }));
const go = vi.fn<Go>(async () => undefined); // typed, so toHaveBeenCalledWith accepts the request
const btn = (k: string) => screen.getByRole("button", { name: i18n.t(k) });
const tick = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
const ask = (text: string) => {
  fireEvent.click(btn("step.ask"));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: text } });
  fireEvent.click(btn("step.send"));
};
const polls = () => callTool.mock.calls.filter(([n]) => n === "step_answer");
// braces, not a comma expression: a function returned from beforeEach is run as its teardown
beforeEach(() => {
  vi.useFakeTimers();
  answerMd = null;
  callTool.mockClear();
  go.mockClear();
});
afterEach(() => vi.useRealTimers());

it("notes after 60 s that the answer may be in the chat, keeps polling, and a late answer still pops up", async () => {
  render(<Step data={data} go={go} callTool={callTool} />);
  ask("Why?");
  expect(go).toHaveBeenCalledWith({ kind: "step", action: "question", text: "Why?" }); // no beats: no beat field
  expect(screen.getByRole("status")).toHaveTextContent("Why?");
  await tick(58_000);
  expect(screen.queryByText(i18n.t("step.late"))).toBeNull();
  await tick(2_000);
  expect(screen.getByText(i18n.t("step.late"))).toBeInTheDocument();
  answerMd = "Because.";
  await tick(2_000);
  const pop = screen.getByRole("dialog");
  expect(pop).toHaveTextContent("Why?");
  expect(pop).toHaveTextContent("Because.");
  expect(screen.queryByText(i18n.t("step.late"))).toBeNull(); // never over the open pop-up
  const n = polls().length;
  await tick(10_000);
  expect(polls().length).toBe(n); // the answer stops the poll
  fireEvent.click(screen.getAllByRole("button", { name: i18n.t("step.close") }).at(-1) as HTMLElement);
  expect(btn("step.again")).toBeInTheDocument();
});

it("Back returns to the step at once without a request; a later answer still shows; a new question has a newer since", async () => {
  render(<Step data={data} go={go} callTool={callTool} />);
  ask("Q1");
  await tick(2_000);
  const since1 = (polls().at(-1)?.[1] as { since: number }).since;
  fireEvent.click(btn("step.back"));
  expect(btn("step.again")).toBeInTheDocument();
  expect(go).toHaveBeenCalledTimes(1); // Back sends nothing
  expect(callTool.mock.calls.every(([n]) => n === "step_answer")).toBe(true); // no shalav_request / clear
  answerMd = "A1";
  await tick(2_000);
  expect(screen.getByRole("dialog")).toHaveTextContent("Q1");
  fireEvent.click(screen.getAllByRole("button", { name: i18n.t("step.close") }).at(-1) as HTMLElement);
  answerMd = null;
  await tick(1_000);
  ask("Q2");
  await tick(2_000);
  expect((polls().at(-1)?.[1] as { since: number }).since).toBeGreaterThan(since1);
  expect(go).toHaveBeenLastCalledWith({ kind: "step", action: "question", text: "Q2" });
});

it("Continue drops the pending question; the Continue pill has no Back", async () => {
  render(<Step data={data} go={go} callTool={callTool} />);
  ask("Q1");
  fireEvent.click(btn("step.back"));
  fireEvent.click(btn("step.next"));
  expect(go).toHaveBeenLastCalledWith({ kind: "step", action: "next" });
  expect(screen.queryByRole("button", { name: i18n.t("step.back") })).toBeNull();
  const n = polls().length;
  await tick(10_000);
  expect(polls().length).toBe(n);
});

it("on a beat slide: the question says the beat, arrows in the box do not move beats, Back keeps the beat and the poll", async () => {
  render(<Step data={slide} go={go} callTool={callTool} />);
  const part = (n: number) => screen.getByText(i18n.t("step.beat", { n, of: 3 }));
  fireEvent.click(btn("step.beatNext")); // the main button reveals beat 2, no request
  expect(part(2)).toBeInTheDocument();
  expect(go).not.toHaveBeenCalled();
  fireEvent.click(btn("step.ask"));
  const box = screen.getByRole("textbox");
  fireEvent.keyDown(box, { key: "ArrowRight" });
  fireEvent.keyDown(box, { key: "ArrowLeft" });
  expect(part(2)).toBeInTheDocument(); // typing keys stay in the box (M78 guard)
  fireEvent.change(box, { target: { value: "Why?" } });
  fireEvent.click(btn("step.send"));
  expect(go).toHaveBeenLastCalledWith({ kind: "step", action: "question", text: "Why?", beat: { n: 2, of: 3 } });
  // the beat's Back (step.beatPrev) and Back to the step are two buttons with their own names
  expect(btn("step.beatPrev")).not.toBe(btn("step.back"));
  fireEvent.click(btn("step.back"));
  expect(part(2)).toBeInTheDocument(); // Back keeps the beat on screen
  fireEvent.click(btn("step.beatNext")); // revealing a beat after Back keeps the question pending
  expect(part(3)).toBeInTheDocument();
  expect(go).toHaveBeenCalledTimes(1);
  answerMd = "A";
  await tick(2_000);
  expect(screen.getByRole("dialog")).toHaveTextContent("Why?");
});

it("clears its timer on unmount, and a read-only slide has no buttons", () => {
  const { unmount } = render(<Step data={data} go={go} callTool={callTool} />);
  ask("Q1");
  const during = vi.getTimerCount();
  unmount();
  expect(vi.getTimerCount()).toBeLessThan(during); // the poll interval is gone (React keeps its own timers)
  render(<Step data={data} go={go} callTool={callTool} readOnly />);
  expect(screen.queryByRole("button")).toBeNull();
});
