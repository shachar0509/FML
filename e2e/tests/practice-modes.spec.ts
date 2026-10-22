import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES } from "./helpers";

const png = { name: "page.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") };

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`practice modes and homework with the tutor (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      const he = lang === "he";
      await page.goto(host(`view=practice&lang=${lang}&theme=${theme}`));
      // three modes on the board
      const modes = page.locator(".board-surface button");
      await expect(modes).toHaveCount(3);
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice-modes/modes-${lang}-${theme}.png` });
      await page.getByRole("button", { name: he ? /פתרון שיעורי בית/ : /Solve homework/ }).click();
      // upload, read (a job: the chat is asked to continue), then the questions
      const read = page.getByRole("button", { name: he ? "קריאת השאלות" : "Read it" });
      await expect(read).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles(png);
      await read.click();
      expect((await said(page)).at(-1)).toBe(he ? "▶️ המשך" : "▶️ Continue");
      await expect(page.getByText(he ? "3 שאלות" : "3 questions", { exact: false })).toBeVisible({ timeout: 6000 });
      await page.getByRole("button", { name: he ? /פתרון עם המורה/ : /Solve with the tutor/ }).click();
      // question 1 in the solving loop; the download waits for a solved question
      await expect(page.getByRole("button", { name: he ? "שאלה 1" : "Question 1" })).toHaveAttribute("aria-current", "step");
      const download = page.getByRole("button", { name: he ? /הורדת הפתרונות/ : /Download solutions/ });
      await expect(download).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles(png);
      await page.getByRole("button", { name: he ? "הגשת פתרון מלא" : "Submit full solution" }).click();
      await expect(page.getByText(he ? "נוסף לקובץ הפתרונות." : "Added to your solutions.")).toBeVisible();
      await expect(download).toBeEnabled();
      await expect(download).toContainText("(1)");
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice-modes/homework-solved-${lang}-${theme}.png`, fullPage: true });
      await download.click();
      await expect(page.getByText("/Users/me/Documents/solution.pdf")).toBeVisible();
      await page.getByRole("button", { name: he ? "השאלה הבאה" : "Next question" }).click();
      await expect(page.getByRole("button", { name: he ? "שאלה 2" : "Question 2" })).toHaveAttribute("aria-current", "step");
      await expect(page.getByRole("button", { name: he ? /שאלה 1/ : /Question 1/ }).getByLabel(he ? "בקובץ הפתרונות" : "in your solutions")).toBeVisible();
      await page.getByRole("button", { name: he ? "יציאה" : "Leave" }).click();
      await expect(modes).toHaveCount(3);
      expect(errors).toEqual([]);
    });

for (const lang of LANGS)
  test(`single question (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    const he = lang === "he";
    await page.goto(host(`view=practice&lang=${lang}`));
    await page.getByRole("button", { name: he ? /שאלה בודדת/ : /Single question/ }).click();
    await page.locator("input[type=file]").setInputFiles(png);
    await page.getByRole("button", { name: he ? "קריאת השאלות" : "Read it" }).click();
    // one question straight into the loop: no "how" step, no question list, no download
    await expect(page.getByRole("button", { name: he ? "קבלת רמז" : "Get a clue" })).toBeVisible({ timeout: 6000 });
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect(page.getByRole("button", { name: he ? /הורדת הפתרונות/ : /Download solutions/ })).toHaveCount(0);
    await page.screenshot({ path: `e2e/tests_output/practice-modes/single-${lang}.png` });
    await page.locator("input[type=file]").setInputFiles(png);
    await page.getByRole("button", { name: he ? "הגשת פתרון מלא" : "Submit full solution" }).click();
    await expect(page.getByText(he ? "נפתר!" : "Solved!")).toBeVisible();
    await page.getByRole("button", { name: he ? "שאלה חדשה" : "New question" }).click();
    await expect(page.getByRole("button", { name: he ? "קריאת השאלות" : "Read it" })).toBeVisible();
    await axe(page);
    expect(errors).toEqual([]);
  });
