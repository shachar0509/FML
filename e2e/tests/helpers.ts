import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page } from "@playwright/test";

export const LANGS = ["he", "en"] as const;
export const THEMES = ["light", "dark"] as const;

/** The card bundle in the fake-host page (src/cards/test-host.tsx); no Claude Desktop needed. */
export const host = (q: string) => `/src/cards/test-host.html?${q}`;

/** The element's box (it must be on screen). */
export async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error("not on screen");
  return b;
}

/** No serious or critical WCAG 2 A/AA violations. */
export async function axe(page: Page) {
  const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad).toEqual([]);
}

/** Page errors so far; check `toEqual([])` at the end of a test. */
export function pageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

/** What the card sent to the chat (sendMessage). */
export const said = (page: Page) => page.evaluate(() => (window as unknown as { __said: string[] }).__said);

/** The last request the card sent the model (shalav_request), as JSON. */
export const toolsCalled = (page: Page) => page.evaluate(() => (window as unknown as { __tools: string[] }).__tools);
export const lastReq = async (page: Page) => JSON.stringify((await page.evaluate(() => (window as unknown as { __reqs: unknown[] }).__reqs)).at(-1));
