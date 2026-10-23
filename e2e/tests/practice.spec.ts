import { expect, test, type Page } from "@playwright/test";
import { axe, host, LANGS, lastReq, pageErrors, THEMES, toolsCalled } from "./helpers";

const nexts = async (page: Page) => (await toolsCalled(page)).filter((n) => n === "practice_next_request").length;

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`practice card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      const he = lang === "he";
      await page.goto(host(`view=practice&lang=${lang}&theme=${theme}`));
      await page.getByRole("button", { name: he ? /תרגול רגיל/ : /Normal practice/ }).click();
      await expect(page.getByRole("radio")).toHaveCount(4);
      await axe(page);
      await page.getByRole("button", { name: he ? "התחל" : "Start" }).click();
      await expect(page.locator(".katex").first()).toBeVisible();

      // U6: Next on an unanswered question asks first; nothing is sent until "Yes, skip"
      const next = page.getByRole("button", { name: he ? "השאלה הבאה" : "Next question", exact: true });
      const ask = page.getByRole("alertdialog", { name: he ? "לדלג על השאלה?" : "Skip this question?" });
      const yes = ask.getByRole("button", { name: he ? "כן, לדלג" : "Yes, skip", exact: true });
      const keep = ask.getByRole("button", { name: he ? "להמשיך לענות" : "Keep answering", exact: true });
      const sent = await nexts(page);
      await next.click();
      await expect(ask).toBeVisible();
      await expect(ask).toContainText(he ? "לא נבדקת ולא נספרת" : "isn't graded and doesn't count");
      await expect(ask).not.toContainText(he ? "לא תחזור" : "won't come back"); // that line is for test practice only
      await expect(keep).toBeFocused();
      expect(await nexts(page)).toBe(sent);
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice/card-practice-skip-${lang}-${theme}.png` });
      // Escape = keep answering; focus goes back to Next
      await page.keyboard.press("Escape");
      await expect(ask).toBeHidden();
      await expect(next).toBeFocused();
      // the Keep button does the same
      await next.click();
      await keep.click();
      await expect(ask).toBeHidden();
      await expect(next).toBeFocused();
      expect(await nexts(page)).toBe(sent);
      // keyboard only: Shift+Tab to "Yes, skip", Enter skips
      await next.click();
      await expect(keep).toBeFocused(); // the focus effect ran (tryNext is async)
      await page.keyboard.press("Shift+Tab");
      await expect(yes).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(ask).toBeHidden();
      expect(await nexts(page)).toBe(sent + 1);
      await expect(page.getByLabel(he ? "נכון" : "Correct")).toHaveCount(0); // a fresh, unanswered question

      // answer B: marked wrong, the right option shown
      await page.getByRole("button", { name: /^B\b/ }).click();
      await expect(page.getByRole("status").last()).toBeVisible();
      await expect(page.getByLabel(he ? "נכון" : "Correct")).toBeVisible(); // the right option is marked
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/practice/card-practice-${lang}-${theme}.png` });
      // an answered question: Next goes straight on
      await next.click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      expect(await nexts(page)).toBe(sent + 2);
      // an open confirm closes when the student answers instead
      await next.click();
      await expect(ask).toBeVisible();
      await page.getByRole("button", { name: /^B\b/ }).click();
      await expect(ask).toBeHidden();
      expect(await nexts(page)).toBe(sent + 2);

      // normal practice: End never asks (nothing is used up), even on an unanswered question
      await next.click(); // answered: straight on, a fresh unanswered question
      await expect(page.getByLabel(he ? "נכון" : "Correct")).toHaveCount(0);
      await page.getByRole("button", { name: he ? "סיום תרגול" : "End session", exact: true }).click();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await expect(page.getByText(he ? "טעות סימן" : "Sign slip")).toBeVisible();
      await page.getByRole("button", { name: he ? "ללמוד שוב" : "Learn again" }).click();
      expect(await lastReq(page)).toContain("S001");
      expect(errors).toEqual([]);
    });
