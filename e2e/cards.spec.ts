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
      await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add course/ }).click();
      expect(await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).toEqual([lang === "he" ? "➕ אני רוצה להוסיף קורס" : "➕ I'd like to add a course"]);
      expect(errors).toEqual([]);
    });

test("home card empty state", async ({ page }) => {
  await page.goto("/src/cards/test-host.html?lang=en&empty=1");
  await expect(page.getByText("Add your first course to start")).toBeVisible();
});
