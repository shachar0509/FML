import { expect, test } from "@playwright/test";
import { axe, host, LANGS, pageErrors, said, toolsCalled } from "./helpers";

for (const lang of LANGS)
  test(`create a custom course (${lang})`, async ({ page }) => {
    const errors = pageErrors(page);
    await page.goto(host(`lang=${lang}&theme=light`));
    await page.getByRole("button", { name: lang === "he" ? /יצירת קורס אישי/ : /Create custom course/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(lang === "he" ? "יצירת קורס אישי" : "Create a custom course");
    const create = page.getByRole("button", { name: lang === "he" ? "יצירת הקורס" : "Create course" });
    await expect(create).toBeDisabled();
    await page.getByLabel(lang === "he" ? "שם הקורס" : "Course name").fill(lang === "he" ? "תורת המוזיקה לגיטרה" : "Music theory for guitar");
    await page.getByLabel(lang === "he" ? "תיאור הקורס" : "Course description").fill(lang === "he" ? "סולמות, אקורדים והרמוניה" : "Scales, chords and harmony");
    await expect(page.getByText(lang === "he" ? /פרטו כמה שיותר/ : /Elaborate as much as you can/)).toBeVisible();
    await expect(create).toBeDisabled(); // the level is required; the desired outcome is not
    // stars: a click picks the level, the arrows move it
    const stars = page.getByRole("radiogroup", { name: lang === "he" ? "רמת הידע הנוכחית" : "Current level of knowledge" });
    await stars.getByRole("radio").nth(1).click();
    await expect(stars.getByRole("radio").nth(1)).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press(lang === "he" ? "ArrowLeft" : "ArrowRight"); // forward in the reading direction
    await expect(stars.getByRole("radio").nth(2)).toHaveAttribute("aria-checked", "true");
    await expect(stars.getByRole("radio").nth(2)).toBeFocused();
    await expect(page.getByText(lang === "he" ? "מכיר/ה את הבסיס" : "Know the basics")).toBeVisible();
    await axe(page);
    await page.screenshot({ path: `e2e/tests_output/custom/card-custom-form-${lang}.png` });
    await create.click();
    // the new course opens: no number, credits or Moodle import; nothing is sent to Claude
    await expect(page.getByText(lang === "he" ? "השלב הבא: קבצי הקורס" : "Next: your course files")).toBeVisible();
    await expect(page.getByText(lang === "he" ? "קורס אישי" : "Custom course")).toBeVisible();
    await expect(page.getByText("Cm1abc")).toHaveCount(0);
    await page.getByRole("button", { name: lang === "he" ? /חומרי לימוד/ : /Study materials/ }).waitFor();
    await expect(page.getByText(lang === "he" ? "ייבוא מ-Moodle" : "Import from Moodle")).toHaveCount(0);
    expect(await toolsCalled(page)).toContain("course_custom_create");
    expect(await said(page)).toEqual([]);
    expect(errors).toEqual([]);
  });
