import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import "@/core/i18n";
import type { FileRow, FilesData } from "../types";
import { Files } from "./Files";

const row = (status: FileRow["status"], extra: Partial<FileRow> = {}): FileRow => ({ sha: `s-${status}`, name: `${status}.pdf`, pages: 1, status, error: null, exercises: 0, solved: 0, ...extra });
const list = (p: Partial<FilesData> = {}) => ({ view: "files", language: "en", theme: "system", number: "01040195", materials: [row("indexed")], exercises: [], teacher: [], moodle: null, ...p }) as FilesData;

let data = list();
let vis: DocumentVisibilityState = "visible";
const callTool = vi.fn(async (name: string) => (name === "files_list" ? { structuredContent: data } : {}));
const polls = () => callTool.mock.calls.filter(([n]) => n === "files_list").length;
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const show = (on: boolean) => act(() => { vis = on ? "visible" : "hidden"; document.dispatchEvent(new Event("visibilitychange")); });
const mount = (props: { live?: boolean; reload?: () => void } = {}) =>
  render(<Files number="01040195" callTool={callTool} reload={props.reload ?? (() => undefined)} live={props.live} />);

beforeEach(() => {
  vi.useFakeTimers();
  callTool.mockClear();
  data = list();
  vis = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => vis });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: unknown }).visibilityState; // jsdom's own getter again
});

it("polls every 5 s when nothing moves", async () => {
  mount();
  await tick(0);
  expect(polls()).toBe(1); // the mount fetch, at once
  await tick(4900);
  expect(polls()).toBe(1);
  await tick(100);
  expect(polls()).toBe(2);
});

const moving: [string, Partial<FilesData>][] = [
  ["a file is scanning", { materials: [row("indexing")] }],
  ["a teacher file is scanning", { teacher: [row("indexing")] }],
  ["a build holds a file", { materials: [row("pending", { inBuild: true })] }],
  ["Moodle is importing", { moodle: { url: "https://m/", connected: true, busy: "sync", last: null, progress: { done: 1, total: 4 } } }],
];
it.each(moving)("polls every 1.5 s while %s, also hidden", async (_, p) => {
  data = list(p);
  mount();
  await tick(0);
  await show(false);
  await tick(1500);
  expect(polls()).toBe(2);
  await tick(1500);
  expect(polls()).toBe(3);
});

it("polls every 1.5 s while a plan build runs (live)", async () => {
  const r = mount();
  await tick(0);
  r.rerender(<Files number="01040195" callTool={callTool} reload={() => undefined} live />);
  await tick(1500);
  expect(polls()).toBe(2);
});

it("drops to 5 s when the last scan ends, reloading the course card on that poll", async () => {
  data = list({ materials: [row("indexing")] });
  const reload = vi.fn();
  mount({ reload });
  await tick(0);
  data = list(); // the server finished scanning
  await tick(1500); // a fast tick brings the list without "indexing"
  expect(polls()).toBe(2);
  expect(reload).toHaveBeenCalledTimes(1);
  await tick(4900);
  expect(polls()).toBe(2);
  await tick(100);
  expect(polls()).toBe(3);
});

it("skips idle polls while hidden and refreshes once when shown", async () => {
  mount();
  await tick(0);
  await show(false);
  await tick(20000);
  expect(polls()).toBe(1);
  await show(true);
  expect(polls()).toBe(2); // at once, not on the next tick
  await tick(5000);
  expect(polls()).toBe(3);
});
