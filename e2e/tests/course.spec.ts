import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES } from "./helpers";

for (const lang of LANGS)
  test(`add-course flow (${lang})`, async ({ page }) => {
    await page.goto(host(`lang=${lang}&theme=light`));
    await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add course/ }).click();
    await page.getByPlaceholder("01040195").fill("01040195");
    await page.keyboard.press("Enter");
    await expect(page.getByText(lang === "he" ? "תיאור הקורס מהקטלוג" : "Catalog description")).toBeVisible();
    await expect(page.getByText(lang === "he" ? /ואז לבנות את תוכנית הלימוד/ : /then build the study plan/)).toBeVisible();
    await axe(page);
    await page.screenshot({ path: `e2e/shots/card-add-${lang}.png` });
    await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add course/ }).click();
    // the course opens without a plan and nothing is sent to Claude: files first, Build plan when ready
    await expect(page.getByText(lang === "he" ? "השלב הבא: קבצי הקורס" : "Next: your course files")).toBeVisible();
    await expect(page.getByText("lecture1.pdf")).toBeVisible();
    expect(await said(page)).toEqual([]);
    await page.getByRole("button", { name: lang === "he" ? "בניית תוכנית" : "Build plan" }).click();
    expect(await said(page)).toEqual([lang === "he" ? "▶️ המשך" : "▶️ Continue"]);
    await expect(page.getByText(lang === "he" ? "לחצו Enter" : "Press Enter")).toBeVisible();
  });

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`course card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`lang=${lang}&theme=${theme}`));
      await page.locator("ul button").first().click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(lang === "he" ? "חשבון" : "Infinitesimal");
      await expect(page.getByText(lang === "he" ? "שכחו את תנאי ההתכנסות" : "Forgot the convergence condition")).toBeVisible();
      await expect(page.getByText("S002").first()).toBeVisible(); // current unit is expanded
      await expect(page.getByText("lecture2.pdf")).toBeVisible(); // Files section
      await expect(page.getByText(lang === "he" ? "5 תרגילים" : "5 exercises found")).toBeVisible();
      await expect(page.getByRole("button", { name: lang === "he" ? "ייבוא קבצי הקורס" : "Import course files" })).toBeEnabled();
      await page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" }).click();
      expect((await said(page)).at(-1)).toBe(lang === "he" ? "▶️ המשך" : "▶️ Continue");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/shots/card-course-${lang}-${theme}.png` });
      await axe(page);
      await page.getByRole("button", { name: lang === "he" ? /גבולות/ : /Limits/ }).click();
      await expect(page.getByText(lang === "he" ? "תקציר: גבולות" : "Limits summary")).toBeVisible();
      expect(errors).toEqual([]);
    });
