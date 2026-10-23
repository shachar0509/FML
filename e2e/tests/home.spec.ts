import { expect, test } from "@playwright/test";
import { axe, box, host, LANGS, lastReq, pageErrors, said, THEMES, toolsCalled } from "./helpers";

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`home card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`lang=${lang}&theme=${theme}`));
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(lang === "he" ? "חשבון אינפיניטסימלי 1" : "Infinitesimal Calculus 1")).toBeVisible();
      // Learn and Practice on the row of a course with a plan, not on one without
      const row = page.locator("ul > li").first();
      await expect(row.getByRole("button", { name: lang === "he" ? "לימוד — S012" : "Learn — S012" })).toBeVisible();
      await expect(row.getByRole("button", { name: lang === "he" ? "תרגול" : "Practice" })).toBeVisible();
      await expect(page.locator("ul > li").nth(1).getByRole("button", { name: lang === "he" ? /^לימוד/ : /^Learn/ })).toHaveCount(0);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/tests_output/home/card-home-${lang}-${theme}.png` });
      await axe(page);
      expect(errors).toEqual([]);
    });

test("home card empty state", async ({ page }) => {
  await page.goto(host("lang=en&empty=1"));
  await expect(page.getByText("Add your first course to start")).toBeVisible();
});

test("university picker before the first choice", async ({ page }) => {
  await page.goto(host("lang=en&nouni=1"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your university");
  for (const n of ["Technion", "Hebrew University", "Reichman University", "Braude College"]) await expect(page.getByRole("button", { name: n })).toBeVisible();
  await axe(page);
});

for (const lang of LANGS)
  test(`home layout: centred title, settings in the far corner, two add buttons (${lang})`, async ({ page }) => {
    await page.goto(host(`lang=${lang}&theme=light&custom=1`));
    const title = await box(page.getByRole("heading", { level: 1 }));
    const gear = await box(page.getByRole("button", { name: lang === "he" ? "הגדרות" : "Settings" }));
    const row = await box(page.locator("ul > li").first());
    expect(Math.abs(title.x + title.width / 2 - (row.x + row.width / 2))).toBeLessThan(4); // centred over the course boxes
    if (lang === "he") expect(gear.x).toBeLessThan(row.x + 4); // top-left in RTL
    else expect(gear.x + gear.width).toBeGreaterThan(row.x + row.width - 4); // top-right in LTR
    expect(gear.y).toBeLessThan(title.y + title.height);
    const academic = await box(page.getByRole("button", { name: lang === "he" ? /הוספת קורס אקדמי/ : /Add academic course/ }));
    const custom = await box(page.getByRole("button", { name: lang === "he" ? /יצירת קורס אישי/ : /Create custom course/ }));
    expect(Math.abs(academic.width - custom.width)).toBeLessThan(2);
    expect(academic.width).toBeGreaterThan(row.width * 0.45);
    expect(academic.width).toBeLessThan(row.width * 0.5);
    expect(academic.y).toBeGreaterThan(title.y + title.height); // under the title
    // a custom course shows "Custom course" instead of its number and credits
    const mine = page.locator("ul > li").filter({ hasText: lang === "he" ? "תורת המוזיקה" : "Music theory" });
    await expect(mine).toContainText(lang === "he" ? "קורס אישי" : "Custom course");
    await expect(mine).not.toContainText("Cm1abc");
    await axe(page);
    await page.screenshot({ path: `e2e/tests_output/home/card-home-layout-${lang}.png` });
  });

for (const lang of LANGS)
  test(`course row: the box opens the course, Learn asks the chat, Practice opens practice (${lang})`, async ({ page }) => {
    const he = lang === "he";
    await page.goto(host(`lang=${lang}&theme=light`));
    const row = page.locator("ul > li").first();
    await row.getByRole("button", { name: he ? "לימוד — S012" : "Learn — S012" }).click();
    expect(await lastReq(page)).toBe(JSON.stringify({ kind: "learn", stageId: "S012", title: he ? "גבולות של סדרות" : "Limits of sequences" }));
    await row.getByRole("button", { name: he ? "תרגול" : "Practice" }).click();
    await expect(page.getByText(he ? "איך רוצים לתרגל?" : "How do you want to practice?")).toBeVisible();
    await page.goto(host(`lang=${lang}&theme=light`));
    await page.getByText(he ? "חשבון אינפיניטסימלי 1" : "Infinitesimal Calculus 1").click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(he ? "חשבון" : "Infinitesimal");
  });

for (const lang of LANGS)
  test(`Continue on the row resumes the newest saved lesson in one click (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    const he = lang === "he";
    await page.goto(host(`lang=${lang}&theme=light&saved=1`));
    const row = page.locator("ul > li").first();
    const cont = row.getByRole("button", { name: he ? "המשך לימוד: S002 · גבולות" : "Continue learning: S002 · Limits" });
    await expect(cont).toBeVisible();
    // only a course with a saved lesson has it
    await expect(page.locator("ul > li").nth(1).getByRole("button", { name: he ? /^המשך לימוד/ : /^Continue learning/ })).toHaveCount(0);
    await axe(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/tests_output/home/card-home-continue-${lang}.png` });
    // one click = one request (the same as Load older → Open) + one chat line + the "press Enter" banner
    await cont.click();
    expect(await lastReq(page)).toBe(JSON.stringify({ kind: "resume", number: "01040195", id: "l1" }));
    expect((await toolsCalled(page)).filter((n) => n === "shalav_request")).toHaveLength(1);
    expect(await said(page)).toEqual([he ? "▶️ המשך" : "▶️ Continue"]);
    await expect(page.getByText(he ? "ההודעה מוכנה בתיבת הכתיבה. לחצו Enter כדי ש-Claude ימשיך." : "Ready in the message box. Press Enter so Claude continues.")).toBeVisible();
    // deleting that lesson in Load older takes its Continue away (no click on an id that is gone)
    await row.getByRole("button", { name: he ? /^לימוד/ : /^Learn/ }).click();
    await page.getByRole("button", { name: he ? "טעינת שיעור קודם" : "Load older lesson" }).click();
    await page.getByRole("button", { name: he ? "מחיקה S002 · גבולות" : "Delete S002 · Limits" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: he ? "מחיקה" : "Delete" }).click();
    await expect(cont).toHaveCount(0);
    expect(errors).toEqual([]);
  });
