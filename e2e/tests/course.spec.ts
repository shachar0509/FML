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
    await page.screenshot({ path: `e2e/tests_output/course/card-add-${lang}.png` });
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
      await expect(page.getByRole("img", { name: lang === "he" ? "50% אונדקסו" : "50% indexed" })).toBeVisible();
      await expect(page.getByRole("img", { name: lang === "he" ? "100% אונדקסו" : "100% indexed" })).toBeVisible();
      await expect(page.getByText(lang === "he" ? "עוד לא נקרא — לחצו על ״עדכון התוכנית״" : "Not read yet — press Update plan")).toBeVisible();
      // delete asks first; Cancel keeps the file
      await page.getByRole("button", { name: `${lang === "he" ? "הסרה" : "Remove"} lecture2.pdf` }).click();
      const ask = page.getByRole("alertdialog");
      await expect(ask).toContainText(lang === "he" ? "בטוחים שאתם רוצים למחוק את lecture2.pdf מתוך חומרי לימוד?" : "Are you sure you want to delete lecture2.pdf from Study materials?");
      await axe(page);
      await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-delete-${lang}-${theme}.png` });
      await ask.getByRole("button", { name: lang === "he" ? "ביטול" : "Cancel" }).click();
      await expect(ask).toBeHidden();
      await page.getByRole("button", { name: `${lang === "he" ? "הסרה" : "Remove"} lecture2.pdf` }).click();
      await ask.getByRole("button", { name: lang === "he" ? "הסרה" : "Remove" }).click();
      await expect(ask).toBeHidden();
      const filesSection = page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" });
      await filesSection.screenshot({ path: `e2e/tests_output/course/card-files-${lang}-${theme}.png` });
      const mats = page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ });
      await mats.click(); // collapse
      await expect(mats).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByText("lecture2.pdf")).toBeHidden();
      await page.waitForTimeout(300); // chevron rotation
      await filesSection.screenshot({ path: `e2e/tests_output/course/card-files-collapsed-${lang}-${theme}.png` });
      await mats.click();
      await expect(page.getByText("lecture2.pdf")).toBeVisible();
      await expect(page.getByText(lang === "he" ? "5 תרגילים" : "5 exercises found")).toBeVisible();
      await expect(page.getByText(lang === "he" ? "3 פתורים · 2 לא פתורים" : "3 solved · 2 unsolved")).toBeVisible();
      await expect(page.getByRole("button", { name: lang === "he" ? "ייבוא קבצי הקורס" : "Import course files" })).toBeEnabled();
      await page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" }).click();
      expect((await said(page)).at(-1)).toBe(lang === "he" ? "▶️ המשך" : "▶️ Continue");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/tests_output/course/card-course-${lang}-${theme}.png` });
      await axe(page);
      await page.getByRole("button", { name: lang === "he" ? /גבולות/ : /Limits/ }).click();
      await expect(page.getByText(lang === "he" ? "תקציר: גבולות" : "Limits summary")).toBeVisible();
      expect(errors).toEqual([]);
    });

for (const lang of LANGS)
  test(`course files: all read, Moodle import progress (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&files=read`));
    await page.locator("ul button").first().click();
    await expect(page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" })).toBeDisabled();
    await expect(page.getByText(lang === "he" ? "כל הקבצים נקראו" : "Every file has been read")).toBeVisible();
    await page.goto(host(`lang=${lang}&files=importing`));
    await page.locator("ul button").first().click();
    const bar = page.getByRole("progressbar", { name: lang === "he" ? "מייבא קבצים…" : "Importing files…" });
    await expect(bar).toHaveAttribute("aria-valuenow", "38"); // 3 of 8
    await expect(page.getByText("38%")).toBeVisible();
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-importing-${lang}.png` });
    expect(errors).toEqual([]);
  });
