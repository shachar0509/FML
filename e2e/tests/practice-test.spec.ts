import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES } from "./helpers";

const png = { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") };

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`test practice: scope, exam question, stern note, weak concept (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      const he = lang === "he";
      await page.goto(host(`view=practice&lang=${lang}&theme=${theme}`));
      await page.getByRole("button", { name: he ? /תרגול למבחן/ : /Test practice/ }).click();
      await expect(page.getByText(he ? "נמצאו 12 שאלות ממבחנים קודמים, 9 עוד לא הוגשו." : "12 past exam questions found, 9 not served yet.")).toBeVisible();
      await expect(page.getByText(he ? "צריך עוד תרגול:" : "Needs more practice:")).toBeVisible();
      // main subjects: Start needs at least one
      await page.getByRole("radio", { name: he ? /נושאים עיקריים/ : /Main subjects/ }).check();
      const start = page.getByRole("button", { name: he ? "התחל" : "Start", exact: true });
      await expect(start).toBeDisabled();
      await page.getByRole("checkbox", { name: he ? "גבולות" : "Limits" }).check();
      await expect(start).toBeEnabled();
      // quiz material: uploaded, read by the tutor, its subjects shown
      await page.getByRole("radio", { name: he ? /חומר לבוחן/ : /Quiz material/ }).check();
      await expect(start).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles(png);
      await page.getByRole("button", { name: he ? "קריאת החומר" : "Read the material" }).click();
      expect((await said(page)).at(-1)).toBe(he ? "▶️ המשך" : "▶️ Continue");
      await expect(page.getByText(he ? "הבוחן מכסה:" : "The quiz covers:")).toBeVisible({ timeout: 6000 });
      await expect(start).toBeEnabled();
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice-test/scope-${lang}-${theme}.png`, fullPage: true });
      await start.click();
      // an exam question in the solving loop, the count of exam questions left
      await expect(page.getByRole("button", { name: he ? "קבלת רמז" : "Get a clue" })).toBeVisible();
      await expect(page.getByText(he ? "שאלות מבחן שנשארו: 9" : "Exam questions left: 9")).toBeVisible();
      await page.getByRole("button", { name: he ? "השאלה הבאה" : "Next question" }).click();
      await expect(page.getByText(he ? /זה לא מספיק טוב/ : /Not good enough/)).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice-test/stern-${lang}-${theme}.png`, fullPage: true });
      await page.getByRole("button", { name: he ? "השאלה הבאה" : "Next question" }).click();
      await page.getByRole("button", { name: he ? "השאלה הבאה" : "Next question" }).click();
      await expect(page.getByText(he ? /"טורים" צריך עוד תרגול/ : /"Series" needs more practice/)).toBeVisible();
      await page.screenshot({ path: `e2e/tests_output/practice-test/weak-${lang}-${theme}.png`, fullPage: true });
      expect(errors).toEqual([]);
    });
