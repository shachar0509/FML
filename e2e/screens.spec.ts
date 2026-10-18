import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const KEY = "settings.json"; // keep in sync with src/stores/settings.ts FILE
const boot = async (page: Page, language: "he" | "en", theme: "light" | "dark" = "light") => {
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify({ onboardingCompleted: true, language, theme, dataRoot: "/tmp/shalav-e2e" })]);
  await page.goto("/");
};
const serious = async (page: Page) =>
  (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");

for (const language of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`home + settings tabs (${language}/${theme}) render without errors or serious a11y issues`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await boot(page, language, theme);
      await expect(page.locator("html")).toHaveAttribute("dir", language === "he" ? "rtl" : "ltr");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/shots/home-${language}-${theme}.png` });
      expect(await serious(page)).toEqual([]);
      await page.goto("/#/settings");
      const tabs = page.getByRole("tab");
      const n = await tabs.count();
      expect(n).toBe(6);
      for (let i = 0; i < n; i++) {
        await tabs.nth(i).click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `e2e/shots/settings-${i}-${language}-${theme}.png` });
        expect(await serious(page), `tab ${i}`).toEqual([]);
      }
      expect(errors).toEqual([]);
    });

for (const language of ["he", "en"] as const)
  test(`add-course dialog and Ask drawer (${language}) have no serious a11y issues`, async ({ page }) => {
    await boot(page, language);
    await page.getByRole("button", { name: language === "he" ? /הוספת קורס/ : /Add course/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `e2e/shots/add-course-${language}.png` });
    expect(await serious(page)).toEqual([]);
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+k");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/shots/ask-${language}.png` });
    expect(await serious(page)).toEqual([]);
  });
