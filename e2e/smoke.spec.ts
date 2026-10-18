import { expect, test } from "@playwright/test";

test("onboarding is Hebrew RTL, flips to English LTR, and renders in dark mode", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await page.screenshot({ path: "e2e/shots/onboarding-he.png" });
  await page.getByRole("button", { name: /English/ }).click();
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.screenshot({ path: "e2e/shots/onboarding-en.png" });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/shots/onboarding-dark.png" });
  expect(errors).toEqual([]);
});
