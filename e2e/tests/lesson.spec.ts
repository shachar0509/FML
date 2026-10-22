import { expect, test } from "@playwright/test";
import { axe, host, LANGS, lastReq, pageErrors, THEMES } from "./helpers";

// The lesson overview card (Lesson.tsx) and its question cards (Question.tsx, AnswerFiles.tsx).
for (const lang of LANGS)
  for (const theme of THEMES) {
    const url = (v: string) => host(`view=${v}&lang=${lang}&theme=${theme}`);

    test(`lesson card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(url("lesson"));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(lang === "he" ? "גבולות של סדרות" : "Limits of sequences");
      await expect(page.locator(".katex").first()).toBeVisible(); // objectives render math
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/lesson/card-lesson-${lang}-${theme}.png` });
      await page.getByRole("button", { name: lang === "he" ? "להשלים בכל זאת" : "Complete anyway" }).click();
      await expect(page.getByText(lang === "he" ? "לפתור עוד 2 תרגילים" : "Solve 2 more exercises")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "כן, להמשיך" : "Yes, continue" }).click();
      await expect(page.getByText(lang === "he" ? "השלב הושלם" : "Stage completed")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "לשלב הבא" : "Next stage" }).click();
      expect(await lastReq(page)).toContain("\"stageId\":\"S003\"");
      expect(errors).toEqual([]);
    });

    test(`mcq card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(url("mcq"));
      await expect(page.getByRole("img", { name: lang === "he" ? "רמת קושי 2 מתוך 5 עבורך" : "Difficulty 2 of 5 for you" })).toBeVisible(); // M65
      // an option that starts with a formula still reads in the card language
      expect(await page.locator("ul li").nth(3).locator("p").evaluate((e) => getComputedStyle(e).direction)).toBe(lang === "he" ? "rtl" : "ltr");
      await page.getByRole("button", { name: /diverges|מתבדרת/ }).click();
      await expect(page.getByRole("status")).toContainText(lang === "he" ? "לא נכון" : "Not quite");
      expect(await lastReq(page)).toContain(lang === "he" ? "C) מתבדרת" : "C) diverges");
      await axe(page);
      await page.screenshot({ path: `e2e/tests_output/lesson/card-mcq-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

    test(`open question card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(url("open"));
      const send = page.getByRole("button", { name: lang === "he" ? "שליחת התשובה" : "Send answer" });
      await expect(send).toBeDisabled();
      // empty answer box: the placeholder follows the card language
      expect(await page.getByRole("textbox").evaluate((e) => getComputedStyle(e).direction)).toBe(lang === "he" ? "rtl" : "ltr");
      await page.getByRole("textbox").fill("Because $1/n$ is below $\\varepsilon$ for large $n$.");
      await axe(page);
      await send.click();
      expect(await lastReq(page)).toContain("Because");
      // solved on paper: a photo dropped on the zone is the answer (no typing needed)
      await page.goto(url("open"));
      const zone = page.getByText(lang === "he" ? /פתרתם במחברת/ : /Solved it on paper/);
      await expect(zone).toBeVisible();
      await page.screenshot({ path: `e2e/tests_output/lesson/card-open-${lang}-${theme}.png` });
      const drop = await page.evaluateHandle(() => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], "proof.png", { type: "image/png" }));
        return dt;
      });
      await zone.locator("..").dispatchEvent("drop", { dataTransfer: drop });
      await expect(page.getByText("proof.png")).toBeVisible();
      await send.click();
      expect(await lastReq(page)).toMatch(/"files":\["a{64}"\]/);
      expect(errors).toEqual([]);
    });
  }
