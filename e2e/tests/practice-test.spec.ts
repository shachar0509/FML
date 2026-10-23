import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES, toolsCalled } from "./helpers";

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
      // U6: an unanswered exam question asks before Next, says it won't come back, and survives the 2.5 s poll
      const next = page.getByRole("button", { name: he ? "השאלה הבאה" : "Next question", exact: true });
      const ask = page.getByRole("alertdialog", { name: he ? "לדלג על השאלה?" : "Skip this question?" });
      const yes = ask.getByRole("button", { name: he ? "כן, לדלג" : "Yes, skip", exact: true });
      const keep = ask.getByRole("button", { name: he ? "להמשיך לענות" : "Keep answering", exact: true });
      const once = he ? "בתרגול למבחן כל שאלה מוגשת פעם אחת" : "In test practice each question is served once";
      const polls = async () => (await toolsCalled(page)).filter((x) => x === "practice_state").length;
      await next.click();
      await expect(ask).toContainText(once);
      await expect(ask).toContainText(he ? "לא תחזור" : "won't come back");
      await expect(keep).toBeFocused();
      const p0 = await polls();
      await expect.poll(polls, { timeout: 5000 }).toBeGreaterThan(p0); // the card polled at least once (new `d`)
      await expect(ask).toBeVisible(); // still open
      await expect(keep).toBeFocused(); // focus not moved by the poll
      expect((await toolsCalled(page)).includes("practice_next_request")).toBe(false);
      await expect(page.getByText(he ? "שאלות מבחן שנשארו: 9" : "Exam questions left: 9")).toBeVisible(); // nothing served yet
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice-test/skip-${lang}-${theme}.png`, fullPage: true });
      await yes.click();
      await expect(ask).toBeHidden();
      await expect(page.getByText(he ? /זה לא מספיק טוב/ : /Not good enough/)).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice-test/stern-${lang}-${theme}.png`, fullPage: true });
      for (let i = 0; i < 2; i++) {
        await next.click();
        await expect(ask).toContainText(once);
        await yes.click();
        await expect(ask).toBeHidden();
      }
      await expect(page.getByText(he ? /"טורים" צריך עוד תרגול/ : /"Series" needs more practice/)).toBeVisible();
      await page.screenshot({ path: `e2e/tests_output/practice-test/weak-${lang}-${theme}.png`, fullPage: true });
      // U6: End on an unanswered exam question asks too (the question is already used up)
      const end = page.getByRole("button", { name: he ? "סיום תרגול" : "End session", exact: true });
      const endAsk = page.getByRole("alertdialog", { name: he ? "לסיים את התרגול?" : "End the session?" });
      await end.click();
      await expect(endAsk).toContainText(he ? "אם תסיימו עכשיו, היא לא תחזור" : "if you end now, it won't come back");
      await page.keyboard.press("Escape");
      await expect(endAsk).toBeHidden();
      await expect(end).toBeFocused();
      expect((await toolsCalled(page)).includes("practice_end")).toBe(false);
      await end.click();
      await endAsk.getByRole("button", { name: he ? "כן, לסיים" : "Yes, end", exact: true }).click();
      await expect(page.getByText(he ? "טעות סימן" : "Sign slip")).toBeVisible();
      expect(errors).toEqual([]);
    });
