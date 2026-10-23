import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`exercise card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`view=exercise&lang=${lang}&theme=${theme}`));
      await expect(page.getByRole("img", { name: lang === "he" ? "רמת קושי 3 מתוך 5 עבורך" : "Difficulty 3 of 5 for you" })).toBeVisible(); // M65
      await expect(page.locator(".katex").first()).toBeVisible();
      const grade = page.getByRole("button", { name: lang === "he" ? "שליחה לבדיקה" : "Submit for grading" });
      await expect(grade).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles({ name: "work.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
      await expect(page.getByText("work.png")).toBeVisible();
      // U3: the card chunks its prepared blob (canvas JPEG, 0.85), never the PNG the student picked
      expect(await page.evaluate(() => (window as unknown as { __tools: string[] }).__tools)).toContain("attachment_upload_chunk");
      expect(await page.evaluate(() => (window as unknown as { __chunks: string[] }).__chunks.every((d) => d.startsWith("/9j/")))).toBe(true); // JPEG magic, not PNG's "iVBOR"
      await grade.click();
      await expect(page.getByText(lang === "he" ? "נכון חלקית" : "Partly correct")).toBeVisible(); // the stub answers with a graded card
      expect((await said(page)).at(-1)).toBe(lang === "he" ? "▶️ המשך" : "▶️ Continue");
      await expect(page.getByRole("button", { name: lang === "he" ? "הצגת פתרון מלא" : "Show full solution" })).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/exercise/card-exercise-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

const png = { name: "work.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") };
for (const lang of LANGS)
  for (const theme of THEMES)
    test(`solving loop (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      const he = lang === "he";
      await page.goto(host(`view=exercise&loop=1&lang=${lang}&theme=${theme}`));
      await expect(page.locator(".katex").first()).toBeVisible();
      await expect(page.getByRole("button", { name: he ? "רמז 1/3" : "Hint 1/3" })).toHaveCount(0); // the loop has clues, not the 3 hints
      const submit = page.getByRole("button", { name: he ? "הגשת פתרון מלא" : "Submit full solution" });
      await expect(submit).toBeDisabled();
      // Get a clue: a mistake is pointed out first, then I didn't understand, then Thank you
      await page.getByRole("button", { name: he ? "קבלת רמז" : "Get a clue" }).click();
      await expect(page.getByText(he ? "בדקו קודם את זה" : "Check this first")).toBeVisible();
      await expect(submit).toHaveCount(0); // while a clue is open: understood it, or explain again
      await page.getByRole("button", { name: he ? "לא הבנתי את הרמז" : "I didn't understand the clue" }).click();
      await expect(page.locator(".board-note .katex").first()).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/exercise/loop-clue-${lang}-${theme}.png` });
      await page.getByRole("button", { name: he ? "תודה" : "Thank you" }).click();
      await page.getByRole("button", { name: he ? "קבלת רמז" : "Get a clue" }).click();
      await expect(page.getByText(he ? "רמז 2" : "Clue 2")).toBeVisible();
      await page.getByRole("button", { name: he ? "תודה" : "Thank you" }).click();
      // Submit full solution: the review, and a perfect answer ends the loop
      await page.locator("input[type=file]").setInputFiles(png);
      await expect(page.getByText("work.png")).toBeVisible();
      await submit.click();
      await expect(page.getByText(he ? "מושלם! פתרון מלא ונכון." : "Perfect! A full, correct solution.")).toBeVisible();
      await expect(page.getByRole("button", { name: he ? "קבלת רמז" : "Get a clue" })).toHaveCount(0);
      expect((await said(page)).at(-1)).toBe(he ? "▶️ המשך" : "▶️ Continue");
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/exercise/loop-perfect-${lang}-${theme}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });

for (const lang of LANGS)
  test(`exercise error: translated key, unknown message under Details (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    const he = lang === "he";
    await page.goto(host(`view=exercise&lang=${lang}&err=grade.tooManyPages`));
    await expect(page.getByRole("alert")).toHaveText(he ? "אפשר להעלות עד 12 עמודים לפתרון אחד." : "You can upload up to 12 pages per solution.");
    await expect(page.getByText(he ? "פרטים" : "Details")).toHaveCount(0);
    await page.goto(host(`view=exercise&lang=${lang}&err=${encodeURIComponent("model did not call grade_answer")}`));
    await expect(page.getByRole("alert")).toHaveText(he ? "התשובה של Claude לא הגיעה בצורה תקינה. נסו שוב." : "Claude's answer didn't come back in the right form. Try again.");
    await page.getByText(he ? "פרטים" : "Details").click();
    await expect(page.getByText("model did not call grade_answer")).toBeVisible();
    await axe(page);
    await page.screenshot({ path: `e2e/tests_output/exercise/error-${lang}.png` });
    expect(errors).toEqual([]);
  });
