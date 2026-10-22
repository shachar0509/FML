import { expect, test } from "@playwright/test";
import { axe, host, LANGS, lastReq, pageErrors, said, THEMES } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`saved lessons and practice sessions (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      const he = lang === "he";
      await page.goto(host(`lang=${lang}&theme=${theme}&saved=1`));
      // Learn (on the course row in My courses): start new or load an older lesson
      await page.getByRole("button", { name: he ? /^לימוד/ : /^Learn/ }).first().click();
      await page.getByRole("button", { name: he ? "טעינת שיעור קודם" : "Load older lesson" }).click();
      const rows = page.locator("li:not(:has(li))").filter({ has: page.getByRole("button", { name: he ? "פתיחה" : "Open", exact: true }) });
      await expect(rows).toHaveCount(2);
      await expect(rows.first()).toContainText(he ? "S002 · גבולות" : "S002 · Limits"); // newest first
      await expect(rows.first().locator("time")).toHaveAttribute("datetime", "2026-10-22T11:00:00.000Z");
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/history/lessons-${lang}-${theme}.png`, fullPage: true });
      // delete one (with a confirm)
      await rows.nth(1).getByRole("button", { name: he ? /^מחיקה/ : /^Delete/ }).click();
      await page.getByRole("alertdialog").getByRole("button", { name: he ? "מחיקה" : "Delete" }).click();
      await expect(rows).toHaveCount(1);
      // open the other: the chat is asked to continue it
      await rows.first().getByRole("button", { name: he ? "פתיחה" : "Open" }).click();
      expect(await lastReq(page)).toBe(JSON.stringify({ kind: "resume", number: "01040195", id: "l1" }));
      expect((await said(page)).at(-1)).toBe(he ? "▶️ המשך" : "▶️ Continue");
      expect(errors).toEqual([]);
    });

for (const lang of LANGS)
  test(`older practice: type filter, select all of the filter (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    const he = lang === "he";
    await page.goto(host(`view=practice&lang=${lang}&saved=1`));
    await page.getByRole("button", { name: he ? "טעינת תרגול קודם" : "Load older practice" }).click();
    const rows = page.locator("li:not(:has(li))").filter({ has: page.getByRole("button", { name: he ? "פתיחה" : "Open", exact: true }) });
    await expect(rows).toHaveCount(4);
    await axe(page);
    await page.getByRole("button", { name: he ? "פתרון שיעורי בית" : "Solve homework", exact: true }).click();
    await expect(rows).toHaveCount(2);
    await page.getByRole("checkbox", { name: he ? "בחירת הכל" : "Select all" }).check();
    await page.screenshot({ path: `e2e/tests_output/history/practice-${lang}.png`, fullPage: true });
    await page.getByRole("button", { name: he ? "מחיקת הנבחרים (2)" : "Delete selected (2)" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: he ? "מחיקה" : "Delete" }).click();
    await expect(rows).toHaveCount(0);
    await page.getByRole("button", { name: he ? "הכל" : "All", exact: true }).click();
    await expect(rows).toHaveCount(2); // only the filtered ones went
    // open one: back where it was
    await rows.first().getByRole("button", { name: he ? "פתיחה" : "Open" }).click();
    await expect(page.getByText(he ? "מתכנסת" : "converge", { exact: false }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

for (const lang of LANGS)
  test(`resumed lesson: browse earlier slides (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    const he = lang === "he";
    await page.goto(host(`view=step&lang=${lang}&resumed=1`));
    await page.getByRole("button", { name: he ? "שקפים קודמים (3)" : "Earlier slides (3)" }).click();
    await expect(page.getByText(he ? "שקף 3 מתוך 3" : "Slide 3 of 3")).toBeVisible();
    await expect(page.getByRole("button", { name: he ? "המשך" : "Continue" })).toHaveCount(0); // read-only
    await page.getByRole("button", { name: he ? "הקודם" : "Previous", exact: true }).click();
    await expect(page.getByText(he ? "תוכן השקף 2." : "Content of slide 2.")).toBeVisible();
    await axe(page);
    await page.screenshot({ path: `e2e/tests_output/history/slides-${lang}.png`, fullPage: true });
    await page.getByRole("button", { name: he ? "חזרה למקום שעצרתי" : "Back to where I stopped" }).click();
    await expect(page.getByRole("button", { name: he ? "שקפים קודמים (3)" : "Earlier slides (3)" })).toBeVisible();
    expect(errors).toEqual([]);
  });
