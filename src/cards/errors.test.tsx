import { render, screen } from "@testing-library/react";
import { z } from "zod";
import { expect, it } from "vitest";
import i18n from "@/core/i18n";
import he from "@/core/i18n/he.json";
import en from "@/core/i18n/en.json";
import { STOPPED } from "@/server/bridge";
import { TooManyPages } from "@/core/domain/practice/grade";
import { ErrorNote, errorKey } from "./errors";

// what callStructured throws after the corrections (structured.ts:44)
const zodMsg = `make_exercise: ${z.object({ a: z.string() }).safeParse({}).error?.message}`;

it("keeps keys, maps known messages, falls back", () => {
  expect(errorKey("practice.noItems")).toBe("practice.noItems");
  expect(errorKey("practice.test.generateFailed")).toBe("practice.test.generateFailed");
  expect(errorKey(new TooManyPages().message)).toBe("grade.tooManyPages");
  expect(errorKey(STOPPED)).toBe("job.stopped");
  expect(errorKey("aborted")).toBe("job.stopped");
  expect(errorKey("course not found")).toBe("errors.courseMissing");
  expect(errorKey("plan.json missing", "plan.failed")).toBe("errors.courseMissing");
  expect(errorKey("attachment ab12 not found")).toBe("errors.fileMissing");
  expect(errorKey("ENOSPC: no space left on device, write")).toBe("errors.disk");
  expect(errorKey("Download failed: 404 https://x.y/z")).toBe("errors.download");
  expect(errorKey("model did not call grade_answer")).toBe("errors.invalidOutput");
  expect(errorKey(zodMsg)).toBe("errors.invalidOutput");
  expect(errorKey("plan invalid: S001 has no unit")).toBe("errors.invalidOutput");
  expect(errorKey(zodMsg, "homework.failed")).toBe("homework.failed");
  expect(errorKey("something odd")).toBe("errors.generic");
  expect(errorKey(null, "plan.failed")).toBe("plan.failed");
  expect(errorKey("practice")).toBe("errors.generic"); // an object path is not a key
});

it("every key it can show is a plain sentence in he and en", () => {
  const get = (o: unknown, k: string) => k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], o);
  const keys = ["errors.generic", "errors.invalidOutput", "errors.courseMissing", "errors.fileMissing", "errors.disk", "errors.download", "errors.details", "job.stopped", "practice.noItems", "practice.test.generateFailed", "grade.tooManyPages", "homework.failed", "homework.solveFailed", "plan.failed"];
  for (const k of keys) for (const r of [he, en]) expect(get(r, k), k).toMatch(/^[^{}]+$/); // exists, no {{placeholders}}
});

it("announces the sentence and keeps the raw text under Details", async () => {
  await i18n.changeLanguage("he");
  const { unmount } = render(<ErrorNote raw="something odd" />);
  expect(screen.getByRole("alert")).toHaveTextContent(he.errors.generic);
  expect(screen.getByRole("alert")).not.toHaveTextContent("something odd");
  expect(screen.getByText("something odd").closest("details")).not.toBeNull();
  unmount();
  render(<ErrorNote raw="job.stopped" />);
  expect(screen.getByRole("alert")).toHaveTextContent(he.job.stopped);
  expect(screen.queryByText(he.errors.details)).toBeNull(); // a key has no Details
});
