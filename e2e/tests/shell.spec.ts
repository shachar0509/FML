import { expect, test } from "@playwright/test";
import { host } from "./helpers";

// The card frame shared by every view (Cards.tsx, useShalav.ts): pin, one card on screen, back arrow.

test("pin button floats the card when the host supports it", async ({ page }) => {
  await page.goto(host("lang=en"));
  await page.getByRole("button", { name: "Keep this card on screen" }).click();
  await expect(page.getByRole("button", { name: "Back into the chat" })).toHaveAttribute("aria-pressed", "true");
});

test("an older card folds away once a newer card is shown", async ({ page }) => {
  await page.goto(host("lang=he&view=step&stale=1"));
  await expect(page.getByText("הכרטיס הזה הוחלף בכרטיס חדש למטה.")).toBeVisible({ timeout: 6000 });
  await expect(page.locator(".board-surface")).toHaveCount(0);
  await page.goto(host("lang=he&view=step"));
  await page.waitForTimeout(2500);
  await expect(page.locator(".board-surface")).toBeVisible();
});

test("back arrow: history first, then the screen above", async ({ page }) => {
  await page.goto(host("lang=en"));
  const back = page.getByRole("button", { name: "Back to the previous screen" });
  await expect(back).toHaveCount(0); // home is the top
  await page.locator("ul button").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Infinitesimal");
  await back.click();
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Infinitesimal");
  await expect(back).toHaveCount(0);
  // a lesson the model opened goes up to its course, then home
  await page.goto(host("lang=en&view=lesson"));
  await back.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Infinitesimal");
  await back.click();
  await expect(back).toHaveCount(0);
});
