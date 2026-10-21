import { expect, test } from "@playwright/test";
import { axe, host, LANGS, lastReq, pageErrors, THEMES } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`practice card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`view=practice&lang=${lang}&theme=${theme}`));
      await expect(page.getByRole("radio")).toHaveCount(4);
      await axe(page);
      await page.getByRole("button", { name: lang === "he" ? "התחל" : "Start" }).click();
      await expect(page.locator(".katex").first()).toBeVisible();
      await page.getByRole("button", { name: /^B\b/ }).click();
      await expect(page.getByRole("status").last()).toBeVisible();
      await expect(page.getByLabel(lang === "he" ? "נכון" : "Correct")).toBeVisible(); // the right option is marked
      await axe(page);
      await page.screenshot({ path: `e2e/shots/card-practice-${lang}-${theme}.png` });
      await page.getByRole("button", { name: lang === "he" ? "סיום תרגול" : "End session" }).click();
      await expect(page.getByText(lang === "he" ? "טעות סימן" : "Sign slip")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "ללמוד שוב" : "Learn again" }).click();
      expect(await lastReq(page)).toContain("S001");
      expect(errors).toEqual([]);
    });
