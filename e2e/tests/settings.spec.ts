import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, THEMES, toolsCalled } from "./helpers";

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
      await page.screenshot({ path: `e2e/tests_output/settings/card-settings-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

for (const lang of LANGS)
  test(`settings: the language switches at once (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}`));
    await page.getByRole("button", { name: lang === "he" ? "הגדרות" : "Settings" }).click();
    const other = lang === "he" ? "en" : "he";
    await page.getByRole("button", { name: other === "en" ? "English" : "עברית" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(other === "en" ? "Settings" : "הגדרות");
    await expect(page.locator("html")).toHaveAttribute("dir", other === "en" ? "ltr" : "rtl");
    await expect(page.getByRole("button", { name: other === "en" ? "English" : "עברית" })).toHaveAttribute("aria-pressed", "true");
    // Back to Home: fetched again for its course names in the new language
    const homes = (await toolsCalled(page)).filter((n) => n === "shalav_home").length;
    await page.getByRole("button", { name: other === "en" ? "Back to the previous screen" : "חזרה למסך הקודם" }).click();
    await expect.poll(async () => (await toolsCalled(page)).filter((n) => n === "shalav_home").length).toBe(homes + 1);
    expect(errors).toEqual([]);
  });
