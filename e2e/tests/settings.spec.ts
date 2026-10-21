import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, THEMES } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`settings card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`lang=${lang}&theme=${theme}`));
      await page.getByRole("button", { name: lang === "he" ? "הגדרות" : "Settings" }).click();
      await expect(page.getByText("/Users/me/Documents/Shalav")).toBeVisible();
      await expect(page.getByText(lang === "he" ? "הטכניון" : "Technion", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toContainText("dev1 (1).jsonl");
      await page.getByRole("spinbutton").first().fill("3");
      await expect(page.getByRole("spinbutton").first()).toHaveValue("3");
      await axe(page);
      await page.screenshot({ path: `e2e/shots/card-settings-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });
