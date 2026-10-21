import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Card bundle in the fake-host page (src/cards/test-host.tsx); no Claude Desktop needed.
for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`home card (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/src/cards/test-host.html?lang=${lang}&theme=${theme}`);
      await expect(page.locator("html")).toHaveAttribute("dir", lang === "he" ? "rtl" : "ltr");
      await expect(page.locator("html")).toHaveClass(theme === "dark" ? /dark/ : /^(?!.*dark)/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByText(lang === "he" ? "חשבון אינפיניטסימלי 1" : "Infinitesimal Calculus 1")).toBeVisible();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/shots/card-home-${lang}-${theme}.png` });
      const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad).toEqual([]);
      expect(errors).toEqual([]);
    });

test("home card empty state", async ({ page }) => {
  await page.goto("/src/cards/test-host.html?lang=en&empty=1");
  await expect(page.getByText("Add your first course to start")).toBeVisible();
});

for (const lang of ["he", "en"] as const)
  test(`add-course flow (${lang})`, async ({ page }) => {
    await page.goto(`/src/cards/test-host.html?lang=${lang}&theme=light`);
    await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add course/ }).click();
    await page.getByPlaceholder("01040195").fill("01040195");
    await page.keyboard.press("Enter");
    await expect(page.getByText(lang === "he" ? "תיאור הקורס מהקטלוג" : "Catalog description")).toBeVisible();
    await expect(page.getByText(lang === "he" ? /שלב תבנה תוכנית לימוד מפורטת/ : /builds a detailed step-by-step study plan/)).toBeVisible();
    const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad).toEqual([]);
    await page.screenshot({ path: `e2e/shots/card-add-${lang}.png` });
    await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add course/ }).click();
    await expect(page.getByRole("status")).toBeVisible(); // build checklist
    expect(await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).toEqual([lang === "he" ? "🛠️ בבקשה בנו לי עכשיו את תוכנית הלימוד" : "🛠️ Please build my study plan now"]);
  });

for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`course card (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/src/cards/test-host.html?lang=${lang}&theme=${theme}`);
      await page.locator("ul button").first().click();
      await expect(page.getByRole("heading", { level: 1 })).toContainText(lang === "he" ? "חשבון" : "Infinitesimal");
      await expect(page.getByText(lang === "he" ? "שכחו את תנאי ההתכנסות" : "Forgot the convergence condition")).toBeVisible();
      await expect(page.getByText("S002").first()).toBeVisible(); // current unit is expanded
      await expect(page.getByText("lecture2.pdf")).toBeVisible(); // Files section
      await expect(page.getByText(lang === "he" ? "5 תרגילים" : "5 exercises found")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "התחל אינדוקס" : "Start indexing" }).click();
      expect((await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).at(-1)).toContain(lang === "he" ? "אנדקס" : "index");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/shots/card-course-${lang}-${theme}.png` });
      const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad).toEqual([]);
      await page.getByRole("button", { name: /Limits/ }).click();
      await expect(page.getByText("Limits summary")).toBeVisible();
      expect(errors).toEqual([]);
    });

for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`lesson cards (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const said = () => page.evaluate(() => (window as unknown as { __said: string[] }).__said);
      const axe = async () => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      const url = (v: string) => `/src/cards/test-host.html?view=${v}&lang=${lang}&theme=${theme}`;

      await page.goto(url("lesson"));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Limits of sequences");
      await expect(page.locator(".katex").first()).toBeVisible(); // objectives render math
      await axe();
      await page.screenshot({ path: `e2e/shots/card-lesson-${lang}-${theme}.png` });
      await page.getByRole("button", { name: lang === "he" ? "להשלים בכל זאת" : "Complete anyway" }).click();
      await expect(page.getByText("Solve 2 more exercises")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "כן, להמשיך" : "Yes, continue" }).click();
      await expect(page.getByText(lang === "he" ? "השלב הושלם" : "Stage completed")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "לשלב הבא" : "Next stage" }).click();
      expect((await said()).at(-1)).toContain("S003 · Squeeze");

      await page.goto(url("mcq"));
      await page.getByRole("button", { name: /diverges|מתבדרת/ }).click();
      await expect(page.getByRole("status")).toContainText(lang === "he" ? "לא נכון" : "Not quite");
      expect((await said()).at(-1)).toContain("C) diverges");
      await axe();
      await page.screenshot({ path: `e2e/shots/card-mcq-${lang}-${theme}.png` });

      await page.goto(url("open"));
      const send = page.getByRole("button", { name: lang === "he" ? "שליחת התשובה" : "Send answer" });
      await expect(send).toBeDisabled();
      await page.getByRole("textbox").fill("Because $1/n$ is below $\\varepsilon$ for large $n$.");
      await axe();
      await send.click();
      expect((await said()).at(-1)).toContain("Because");
      expect(errors).toEqual([]);
    });

for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`exercise card (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/src/cards/test-host.html?view=exercise&lang=${lang}&theme=${theme}`);
      await expect(page.locator(".katex").first()).toBeVisible();
      const grade = page.getByRole("button", { name: lang === "he" ? "שליחה לבדיקה" : "Submit for grading" });
      await expect(grade).toBeDisabled();
      await page.locator("input[type=file]").setInputFiles({ name: "work.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64") });
      await expect(page.getByText("work.png")).toBeVisible();
      await grade.click();
      await expect(page.getByText(lang === "he" ? "נכון חלקית" : "Partly correct")).toBeVisible(); // the stub answers with a graded card
      expect((await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).at(-1)).toContain(lang === "he" ? "בדקו" : "grade");
      await expect(page.getByRole("button", { name: lang === "he" ? "הצגת פתרון מלא" : "Show full solution" })).toBeVisible();
      const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad).toEqual([]);
      await page.screenshot({ path: `e2e/shots/card-exercise-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`practice card (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const axe = async () => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      await page.goto(`/src/cards/test-host.html?view=practice&lang=${lang}&theme=${theme}`);
      await expect(page.getByRole("radio")).toHaveCount(4);
      await axe();
      await page.getByRole("button", { name: lang === "he" ? "התחל" : "Start" }).click();
      await expect(page.locator(".katex").first()).toBeVisible();
      await page.getByRole("button", { name: /^B\b/ }).click();
      await expect(page.getByRole("status").last()).toBeVisible();
      await expect(page.getByLabel(lang === "he" ? "נכון" : "Correct")).toBeVisible(); // the right option is marked
      await axe();
      await page.screenshot({ path: `e2e/shots/card-practice-${lang}-${theme}.png` });
      await page.getByRole("button", { name: lang === "he" ? "סיום תרגול" : "End session" }).click();
      await expect(page.getByText("Sign slip")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "ללמוד שוב" : "Learn again" }).click();
      expect((await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).at(-1)).toContain("S001");
      expect(errors).toEqual([]);
    });

for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`settings card (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/src/cards/test-host.html?lang=${lang}&theme=${theme}`);
      await page.getByRole("button", { name: lang === "he" ? "הגדרות" : "Settings" }).click();
      await expect(page.getByText("/Users/me/Documents/Shalav")).toBeVisible();
      await expect(page.getByRole("alert")).toContainText("dev1 (1).jsonl");
      await page.getByRole("spinbutton").first().fill("3");
      await expect(page.getByRole("spinbutton").first()).toHaveValue("3");
      const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad).toEqual([]);
      await page.screenshot({ path: `e2e/shots/card-settings-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });
