import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, THEMES, toolsCalled } from "./helpers";

for (const lang of LANGS)
  test(`add-course flow (${lang})`, async ({ page }) => {
    await page.goto(host(`lang=${lang}&theme=light`));
    await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add academic course/ }).click();
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
      // every unit starts collapsed, the current one too; Learn / Practice are on the course's row in My courses
      await expect(page.locator("[aria-expanded=true]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: lang === "he" ? /^לימוד/ : /^Learn/ })).toHaveCount(0);
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
      await page.getByRole("button", { name: lang === "he" ? /^סדרות/ : /^Sequences/ }).click(); // units start collapsed
      await page.getByRole("button", { name: /S002 .*%/ }).click(); // the stage row (not Learn or its delete button)
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
  test(`course files: 10 per page, sorted, filtered by scan state (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&files=many`)); // 23 materials: 11 Hebrew names, 12 English
    await page.locator("ul button").first().click();
    await page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ }).click();
    const names = () => page.locator("span[dir=auto]").allTextContents();
    const mats = await names(); // the exercises list stays collapsed
    expect(mats).toHaveLength(10);
    // the settings language first, then alphabetical with numbers in order
    if (lang === "he") expect(mats.slice(0, 3)).toEqual(["הרצאה 0.pdf", "הרצאה 2.pdf", "הרצאה 4.pdf"]);
    else expect(mats.slice(0, 4)).toEqual(["lecture1.pdf", "lecture2.pdf", "notes 1.pdf", "notes 3.pdf"]);
    const pager = page.getByRole("navigation", { name: lang === "he" ? "דפדוף בחומרי לימוד" : "Pages of Study materials" });
    await expect(pager).toContainText(lang === "he" ? "1–10 מתוך 23" : "1–10 of 23");
    await expect(pager.getByRole("button", { name: lang === "he" ? "10 הקודמים" : "Previous 10" })).toBeDisabled();
    await pager.getByRole("button", { name: lang === "he" ? "10 הבאים" : "Next 10" }).click();
    await expect(pager).toContainText(lang === "he" ? "11–20 מתוך 23" : "11–20 of 23");
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-pager-${lang}.png` });
    // a state filters the list (from the first page); again, or Total, clears it
    const scanning = page.getByRole("button", { name: lang === "he" ? /^בסריקה/ : /^Scanning/ }).first();
    await scanning.click();
    await expect(scanning).toHaveAttribute("aria-pressed", "true");
    await expect(pager).toBeHidden(); // 7 files fit one page
    expect(await names()).toHaveLength(7);
    await expect(page.getByText("lecture1.pdf")).toBeHidden(); // scanned, filtered out
    await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-filtered-${lang}.png` });
    await scanning.click();
    await expect(scanning).toHaveAttribute("aria-pressed", "false");
    await expect(pager).toContainText(lang === "he" ? "1–10 מתוך 23" : "1–10 of 23");
    await page.getByRole("button", { name: lang === "he" ? /^לא נסרק/ : /^Not scanned/ }).first().click();
    await expect(page.getByText("lecture2.pdf")).toBeVisible(); // waiting
    await page.getByRole("button", { name: lang === "he" ? /^סה״כ/ : /^Total/ }).first().click();
    await expect(pager).toContainText(lang === "he" ? "1–10 מתוך 23" : "1–10 of 23");
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
    // while the plan builds: a file it will read waits for it (no "press Update plan"); one added meanwhile waits for the next build; Re-scan is off for every file
    await page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ }).click();
    await expect(page.getByText(lang === "he" ? "ממתין לסריקה" : "Waiting to scan", { exact: true })).toBeVisible();
    await expect(page.getByText(lang === "he" ? /לחצו על/ : /press Update plan/)).toHaveCount(1);
    await expect(page.getByText("lecture4.pdf").locator("..")).toContainText(lang === "he" ? /לחצו על/ : /press Update plan/);
    await page.getByRole("button", { name: lang === "he" ? "אפשרויות לקובץ lecture1.pdf" : "Options for lecture1.pdf" }).click();
    await expect(page.getByRole("menuitem", { name: lang === "he" ? "סריקה מחדש" : "Re-scan" })).toBeDisabled();
    await page.waitForTimeout(400); // card fade-in
    await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-building-${lang}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByText(lang === "he" ? "בתור:" : "In line:").locator("..").screenshot({ path: `e2e/tests_output/course/card-course-joined-${lang}.png` });
    expect(errors).toEqual([]);
  });

for (const lang of LANGS)
  test(`course: files added, deleted, renamed or edited in the folder outside the app show up by themselves (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&files=outside`));
    await page.locator("ul button").first().click();
    await page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ }).click();
    await expect(page.getByText("outside.pdf")).toBeVisible({ timeout: 4000 }); // no click: the card follows the folder
    await expect(page.getByText("lecture2.pdf")).toBeHidden();
    await expect(page.getByText("lecture1-final.pdf").locator("..")).toContainText(lang === "he" ? "מוכן" : "Ready"); // renamed: keeps its scan
    await page.getByRole("button", { name: lang === "he" ? /תרגילים לדוגמה/ : /Sample exercises/ }).click();
    await expect(page.getByText("hw1.pdf").locator("..")).toContainText(lang === "he" ? /לחצו על/ : /press Update plan/); // edited: to be scanned again
    await page.waitForTimeout(400); // card fade-in
    await page.getByRole("region", { name: lang === "he" ? "קבצי לימוד" : "Study files" }).screenshot({ path: `e2e/tests_output/course/card-files-outside-${lang}.png` });
    expect(errors).toEqual([]);
  });

for (const lang of LANGS)
  test(`course: the scan step counts the build's files by state (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&joined=1&step=index`)); // 10 scanned, 2 scanning, 20 waiting of 32
    await page.locator("ul button").first().click();
    await page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" }).click();
    const step = page.getByRole("listitem").filter({ hasText: lang === "he" ? "סה״כ" : "Total" }).first();
    await expect(step).toContainText(lang === "he" ? "נסרק בהצלחה 10" : "Scanned 10");
    await expect(step).toContainText(lang === "he" ? "בסריקה 2" : "Scanning 2");
    await expect(step).toContainText(lang === "he" ? "לא נסרק 20" : "Not scanned 20");
    await expect(step).toContainText(lang === "he" ? "סה״כ 32" : "Total 32");
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByRole("status").filter({ has: step }).screenshot({ path: `e2e/tests_output/course/card-build-scan-${lang}.png` });
    expect(errors).toEqual([]);
  });

for (const lang of LANGS)
  test(`course: Translate puts the plan in the settings language (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&tr=1`)); // 12 texts of the plan are in the other language
    await page.locator("ul button").first().click();
    await expect(page.getByText(lang === "he" ? "12 פריטים בתוכנית עוד לא בעברית." : "12 items of the plan aren't in English yet.")).toBeVisible();
    await page.waitForTimeout(400); // card fade-in
    await axe(page);
    await page.getByText(lang === "he" ? "12 פריטים" : "12 items").locator("..").screenshot({ path: `e2e/tests_output/course/card-course-translate-${lang}.png` });
    await page.getByRole("button", { name: lang === "he" ? "תרגום לעברית" : "Translate to English" }).click();
    expect(await toolsCalled(page)).toContain("course_translate_request");
    expect(await said(page)).toEqual([lang === "he" ? "▶️ המשך" : "▶️ Continue"]); // the chat does the translating
    await expect(page.getByText(lang === "he" ? "מתרגמים את התוכנית לעברית…" : "Translating the plan to English…")).toBeVisible();
    // the card reloads every 3 s meanwhile and keeps what the student opened
    const mats = page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ });
    await mats.click();
    await page.waitForTimeout(3500);
    expect((await toolsCalled(page)).filter((n) => n === "shalav_course").length).toBeGreaterThan(2);
    await expect(mats).toHaveAttribute("aria-expanded", "true");
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

for (const lang of LANGS)
  test(`plan: delete a stage or a whole unit, after a warning (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&theme=light&del=1`));
    await page.locator("ul button").first().click();
    const squeeze = lang === "he" ? "כלל הסנדוויץ'" : "Squeeze";
    await page.getByRole("button", { name: lang === "he" ? /^סדרות/ : /^Sequences/ }).click(); // units start collapsed
    await page.getByText(squeeze).hover();
    await page.getByRole("button", { name: lang === "he" ? `מחיקת השלב ${squeeze}` : `Delete the stage ${squeeze}` }).click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText(lang === "he" ? "חלק מהקורס באוניברסיטה" : "part of your university course"); // academic: the exam gap
    await expect(ask).toContainText(lang === "he" ? "עדכון התוכנית עשוי להחזיר אותו" : "Update plan may bring it back");
    await ask.getByRole("button", { name: lang === "he" ? "השארה" : "Keep" }).click();
    await expect(ask).toHaveCount(0);
    expect(await toolsCalled(page)).not.toContain("plan_remove");
    // a whole unit says how many stages go with it
    const series = lang === "he" ? "טורים" : "Series";
    await page.getByRole("button", { name: lang === "he" ? `מחיקת היחידה ${series}` : `Delete the unit ${series}` }).click();
    await expect(ask).toContainText(lang === "he" ? "גם שני השלבים שבה יימחקו" : "Its 2 stages go with it");
    await axe(page);
    await page.screenshot({ path: `e2e/tests_output/course/card-plan-delete-${lang}.png`, fullPage: true });
    await ask.getByRole("button", { name: lang === "he" ? "מחיקה" : "Delete" }).click();
    await expect(page.getByText(series)).toHaveCount(0);
    await page.getByText(squeeze).hover();
    await page.getByRole("button", { name: lang === "he" ? `מחיקת השלב ${squeeze}` : `Delete the stage ${squeeze}` }).click();
    await ask.getByRole("button", { name: lang === "he" ? "מחיקה" : "Delete" }).click();
    await expect(page.getByText(squeeze)).toHaveCount(0);
    // the last unit has no delete button
    await expect(page.getByRole("button", { name: lang === "he" ? /מחיקת היחידה/ : /Delete the unit/ })).toHaveCount(0);
    expect(errors).toEqual([]);
  });

for (const lang of LANGS)
  test(`plan: deleting from a custom course does not warn about the university (${lang})`, async ({ page }) => {
    await page.goto(host(`lang=${lang}&theme=light&custom=1`));
    await page.locator("ul > li").filter({ hasText: lang === "he" ? "תורת המוזיקה" : "Music theory" }).getByRole("button").click();
    const squeeze = lang === "he" ? "כלל הסנדוויץ'" : "Squeeze";
    await page.getByRole("button", { name: lang === "he" ? /^סדרות/ : /^Sequences/ }).click(); // units start collapsed
    await page.getByText(squeeze).hover();
    await page.getByRole("button", { name: lang === "he" ? `מחיקת השלב ${squeeze}` : `Delete the stage ${squeeze}` }).click();
    const ask = page.getByRole("alertdialog");
    await expect(ask).toContainText(lang === "he" ? "עדכון התוכנית עשוי להחזיר אותו" : "Update plan may bring it back");
    await expect(ask).not.toContainText(lang === "he" ? "אוניברסיטה" : "university");
    await page.screenshot({ path: `e2e/tests_output/course/card-plan-delete-custom-${lang}.png`, fullPage: true });
  });
