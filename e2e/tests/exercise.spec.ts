import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`exercise card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`view=exercise&lang=${lang}&theme=${theme}`));
      await expect(page.locator(".katex").first()).toBeVisible();
      const grade = page.getByRole("button", { name: lang === "he" ? "שליחה לבדיקה" : "Submit for grading" });
      await expect(grade).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles({ name: "work.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
      await expect(page.getByText("work.png")).toBeVisible();
      await grade.click();
      await expect(page.getByText(lang === "he" ? "נכון חלקית" : "Partly correct")).toBeVisible(); // the stub answers with a graded card
      expect((await said(page)).at(-1)).toBe(lang === "he" ? "▶️ המשך" : "▶️ Continue");
      await expect(page.getByRole("button", { name: lang === "he" ? "הצגת פתרון מלא" : "Show full solution" })).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/shots/card-exercise-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });
