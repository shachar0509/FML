import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES, toolsCalled } from "./helpers";

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
    await expect(page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ })).toHaveAttribute("aria-expanded", "false"); // Files section, collapsed
    expect(await said(page)).toEqual([]);
    await page.getByRole("button", { name: lang === "he" ? "בניית תוכנית" : "Build plan" }).click();
    expect(await said(page)).toEqual([lang === "he" ? "▶️ בניית תוכנית" : "▶️ Building the plan"]); // the build lane
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
      // file lists start collapsed (like the plan units); the rings show without opening them
      await expect(page.getByRole("img", { name: lang === "he" ? "50% נסרקו" : "50% scanned" })).toBeVisible();
      await expect(page.getByRole("img", { name: lang === "he" ? "100% נסרקו" : "100% scanned" })).toBeVisible();
      // each list shows its counts by scan state
      const legend = page.getByRole("list").filter({ hasText: lang === "he" ? "סה״כ" : "Total" }).first();
      await expect(legend).toContainText(lang === "he" ? "נסרק בהצלחהקובץ אחד" : "Scanned1 file");
      await expect(legend).toContainText(lang === "he" ? "לא נסרקקובץ אחד" : "Not scanned1 file");
      await expect(legend).toContainText(lang === "he" ? "סה״כ2 קבצים" : "Total2 files");
      const filesSection = page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" });
      const mats = page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ });
      const exs = page.getByRole("button", { name: lang === "he" ? /תרגילים לדוגמה/ : /Sample exercises/ });
      await expect(mats).toHaveAttribute("aria-expanded", "false");
      await expect(exs).toHaveAttribute("aria-expanded", "false");
      await expect(page.getByText("lecture2.pdf")).toBeHidden();
      await expect(page.getByText("hw1.pdf")).toBeHidden();
      await page.waitForTimeout(400); // card fade-in
      await filesSection.screenshot({ path: `e2e/tests_output/course/card-files-collapsed-${lang}-${theme}.png` });
      await mats.click();
      await exs.click();
      await expect(mats).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("lecture2.pdf")).toBeVisible();
      await expect(page.getByText(lang === "he" ? "עוד לא נסרק — לחצו על ״עדכון התוכנית״" : "Not scanned yet — press Update plan")).toBeVisible();
      // the ⋯ menu: Open, Re-scan (not for a file not scanned yet), Delete (asks first; Cancel keeps the file)
      const menuOf = (name: string) => page.getByRole("button", { name: lang === "he" ? `אפשרויות לקובץ ${name}` : `Options for ${name}` });
      const item = (name: string) => page.getByRole("menuitem", { name });
      const [OPEN, RESCAN, DEL] = lang === "he" ? ["פתיחה", "סריקה מחדש", "מחיקה"] : ["Open", "Re-scan", "Delete"];
      await menuOf("lecture1.pdf").click();
      await expect(item(OPEN)).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(item(RESCAN)).toBeFocused();
      await page.waitForTimeout(200); // menu fade-in
      await axe(page);
      await filesSection.screenshot({ path: `e2e/tests_output/course/card-files-menu-${lang}-${theme}.png` });
      await page.keyboard.press("Escape");
      await expect(item(OPEN)).toBeHidden();
      await expect(menuOf("lecture1.pdf")).toBeFocused();
      await menuOf("lecture1.pdf").click();
      await item(OPEN).click();
      await menuOf("lecture1.pdf").click();
      await item(RESCAN).click();
      expect(await toolsCalled(page)).toEqual(expect.arrayContaining(["file_open", "file_reindex"]));
      await expect(page.getByText(lang === "he" ? "lecture1.pdf ייסרק מחדש בעדכון התוכנית הבא." : "lecture1.pdf will be scanned again on the next plan update.")).toBeVisible();
      await menuOf("lecture2.pdf").click();
      await expect(item(RESCAN)).toBeDisabled(); // not scanned yet: nothing to redo
      await page.mouse.click(5, 5); // outside closes
      await expect(item(OPEN)).toBeHidden();
      await menuOf("lecture2.pdf").click();
      await item(DEL).click();
      const ask = page.getByRole("alertdialog");
      await expect(ask).toContainText(lang === "he" ? "בטוחים שאתם רוצים למחוק את lecture2.pdf מתוך חומרי לימוד?" : "Are you sure you want to delete lecture2.pdf from Study materials?");
      await axe(page);
      await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-delete-${lang}-${theme}.png` });
      await ask.getByRole("button", { name: lang === "he" ? "ביטול" : "Cancel" }).click();
      await expect(ask).toBeHidden();
      await menuOf("lecture2.pdf").click();
      await item(DEL).click();
      await ask.getByRole("button", { name: DEL }).click();
      await expect(ask).toBeHidden();
      await filesSection.screenshot({ path: `e2e/tests_output/course/card-files-${lang}-${theme}.png` });
      await expect(page.getByText(lang === "he" ? "5 תרגילים" : "5 exercises found")).toBeVisible();
      await expect(page.getByText(lang === "he" ? "3 פתורים · 2 לא פתורים" : "3 solved · 2 unsolved")).toBeVisible();
      await expect(page.getByRole("button", { name: lang === "he" ? "ייבוא קבצי הקורס" : "Import course files" })).toBeEnabled();
      await page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" }).click();
      expect((await said(page)).at(-1)).toBe(lang === "he" ? "▶️ בניית תוכנית" : "▶️ Building the plan");
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
    await expect(page.getByText(lang === "he" ? "כל הקבצים נסרקו" : "Every file has been scanned")).toBeVisible();
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

for (const lang of LANGS)
  for (const theme of THEMES)
    test(`course files: ring split by scan state (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(host(`lang=${lang}&theme=${theme}&files=mix`));
      await page.locator("ul button").first().click();
      await expect(page.getByRole("img", { name: lang === "he" ? "33% נסרקו" : "33% scanned" })).toBeVisible(); // a third each
      const legend = page.getByRole("list").filter({ hasText: lang === "he" ? "סה״כ3 קבצים" : "Total3 files" });
      await expect(legend).toContainText(lang === "he" ? "בסריקהקובץ אחד" : "Scanning1 file");
      await page.waitForTimeout(400); // card fade-in
      await axe(page);
      await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-states-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

for (const lang of LANGS)
  test(`course: Update plan joins a build running in another chat (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&joined=1`));
    await page.locator("ul button").first().click();
    await page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" }).click();
    await expect(page.getByText(lang === "he" ? "בתור: הצ'אט שבונה עכשיו ימשיך לקורס הזה." : "In line: the chat that is building now continues with this course.")).toBeVisible();
    expect(await said(page)).toEqual([]); // nothing sent: that chat picks it up
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByText(lang === "he" ? "בתור:" : "In line:").locator("..").screenshot({ path: `e2e/tests_output/course/card-course-joined-${lang}.png` });
    expect(errors).toEqual([]);
  });

for (const lang of LANGS)
  test(`course files: first Moodle import downloads the browser (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&files=installing`));
    await page.locator("ul button").first().click();
    const label = lang === "he" ? "מוריד דפדפן לחיבור למודל (פעם אחת)…" : "Downloading the browser for Moodle (one time)…";
    await expect(page.getByRole("progressbar", { name: label })).toHaveAttribute("aria-valuenow", "42");
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-installing-${lang}.png` });
    expect(errors).toEqual([]);
  });
