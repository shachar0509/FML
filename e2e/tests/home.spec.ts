import { expect, test } from "@playwright/test";
import { axe, box, host, LANGS, pageErrors, THEMES } from "./helpers";

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

for (const lang of LANGS)
  test(`home layout: centred title, settings in the far corner, two add buttons (${lang})`, async ({ page }) => {
    await page.goto(host(`lang=${lang}&theme=light&custom=1`));
    const title = await box(page.getByRole("heading", { level: 1 }));
    const gear = await box(page.getByRole("button", { name: lang === "he" ? "הגדרות" : "Settings" }));
    const row = await box(page.locator("ul > li").first());
    expect(Math.abs(title.x + title.width / 2 - (row.x + row.width / 2))).toBeLessThan(4); // centred over the course boxes
    if (lang === "he") expect(gear.x).toBeLessThan(row.x + 4); // top-left in RTL
    else expect(gear.x + gear.width).toBeGreaterThan(row.x + row.width - 4); // top-right in LTR
    expect(gear.y).toBeLessThan(title.y + title.height);
    const academic = await box(page.getByRole("button", { name: lang === "he" ? /הוספת קורס אקדמי/ : /Add academic course/ }));
    const custom = await box(page.getByRole("button", { name: lang === "he" ? /יצירת קורס אישי/ : /Create custom course/ }));
    expect(Math.abs(academic.width - custom.width)).toBeLessThan(2);
    expect(academic.width).toBeGreaterThan(row.width * 0.45);
    expect(academic.width).toBeLessThan(row.width * 0.5);
    expect(academic.y).toBeGreaterThan(title.y + title.height); // under the title
    // a custom course shows "Custom course" instead of its number and credits
    const mine = page.locator("ul > li").filter({ hasText: lang === "he" ? "תורת המוזיקה" : "Music theory" });
    await expect(mine).toContainText(lang === "he" ? "קורס אישי" : "Custom course");
    await expect(mine).not.toContainText("Cm1abc");
    await axe(page);
    await page.screenshot({ path: `e2e/tests_output/home/card-home-layout-${lang}.png` });
  });
