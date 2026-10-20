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
