import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, THEMES } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`home card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`lang=${lang}&theme=${theme}`));
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(lang === "he" ? "חשבון אינפיניטסימלי 1" : "Infinitesimal Calculus 1")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/tests_output/home/card-home-${lang}-${theme}.png` });
      await axe(page);
      expect(errors).toEqual([]);
    });

test("home card empty state", async ({ page }) => {
  await page.goto(host("lang=en&empty=1"));
  await expect(page.getByText("Add your first course to start")).toBeVisible();
});

test("university picker before the first choice", async ({ page }) => {
  await page.goto(host("lang=en&nouni=1"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your university");
  for (const n of ["Technion", "Hebrew University", "Reichman University", "Braude College"]) await expect(page.getByRole("button", { name: n })).toBeVisible();
  await axe(page);
});
