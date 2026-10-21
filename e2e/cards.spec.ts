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

test("pin button floats the card when the host supports it", async ({ page }) => {
  await page.goto("/src/cards/test-host.html?lang=en");
  await page.getByRole("button", { name: "Keep this card on screen" }).click();
  await expect(page.getByRole("button", { name: "Back into the chat" })).toHaveAttribute("aria-pressed", "true");
});

test("an older card folds away once a newer card is shown", async ({ page }) => {
  await page.goto("/src/cards/test-host.html?lang=he&view=step&stale=1");
  await expect(page.getByText("הכרטיס הזה הוחלף בכרטיס חדש למטה.")).toBeVisible({ timeout: 6000 });
  await expect(page.locator(".board-surface")).toHaveCount(0);
  await page.goto("/src/cards/test-host.html?lang=he&view=step");
  await page.waitForTimeout(2500);
  await expect(page.locator(".board-surface")).toBeVisible();
});

test("back arrow: history first, then the screen above", async ({ page }) => {
  await page.goto("/src/cards/test-host.html?lang=en");
  const back = page.getByRole("button", { name: "Back to the previous screen" });
  await expect(back).toHaveCount(0); // home is the top
  await page.locator("ul button").first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Infinitesimal");
  await back.click();
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Infinitesimal");
  await expect(back).toHaveCount(0);
  // a lesson the model opened goes up to its course, then home
  await page.goto("/src/cards/test-host.html?lang=en&view=lesson");
  await back.click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Infinitesimal");
  await back.click();
  await expect(back).toHaveCount(0);
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
    await expect(page.getByText(lang === "he" ? /ואז לבנות את תוכנית הלימוד/ : /then build the study plan/)).toBeVisible();
    const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(bad).toEqual([]);
    await page.screenshot({ path: `e2e/shots/card-add-${lang}.png` });
    await page.getByRole("button", { name: lang === "he" ? /הוספת קורס/ : /Add course/ }).click();
    // the course opens without a plan and nothing is sent to Claude: files first, Build plan when ready
    await expect(page.getByText(lang === "he" ? "השלב הבא: קבצי הקורס" : "Next: your course files")).toBeVisible();
    await expect(page.getByText("lecture1.pdf")).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).toEqual([]);
    await page.getByRole("button", { name: lang === "he" ? "בניית תוכנית" : "Build plan" }).click();
    expect(await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).toEqual([lang === "he" ? "▶️ המשך" : "▶️ Continue"]);
    await expect(page.getByText(lang === "he" ? "לחצו Enter" : "Press Enter")).toBeVisible();
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
      await expect(page.getByRole("button", { name: lang === "he" ? "ייבוא קבצי הקורס" : "Import course files" })).toBeEnabled();
      await page.getByRole("button", { name: lang === "he" ? "עדכון התוכנית" : "Update plan" }).click();
      expect((await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).at(-1)).toBe(lang === "he" ? "▶️ המשך" : "▶️ Continue");
      await page.waitForTimeout(400);
      await page.screenshot({ path: `e2e/shots/card-course-${lang}-${theme}.png` });
      const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad).toEqual([]);
      await page.getByRole("button", { name: lang === "he" ? /גבולות/ : /Limits/ }).click();
      await expect(page.getByText(lang === "he" ? "תקציר: גבולות" : "Limits summary")).toBeVisible();
      expect(errors).toEqual([]);
    });

for (const lang of ["he", "en"] as const)
  for (const theme of ["light", "dark"] as const)
    test(`lesson cards (${lang}/${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const said = async () => [JSON.stringify((await page.evaluate(() => (window as unknown as { __reqs: unknown[] }).__reqs)).at(-1))];
      const axe = async () => expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
      const url = (v: string) => `/src/cards/test-host.html?view=${v}&lang=${lang}&theme=${theme}`;

      await page.goto(url("lesson"));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(lang === "he" ? "גבולות של סדרות" : "Limits of sequences");
      await expect(page.locator(".katex").first()).toBeVisible(); // objectives render math
      await axe();
      await page.screenshot({ path: `e2e/shots/card-lesson-${lang}-${theme}.png` });
      await page.getByRole("button", { name: lang === "he" ? "להשלים בכל זאת" : "Complete anyway" }).click();
      await expect(page.getByText(lang === "he" ? "לפתור עוד 2 תרגילים" : "Solve 2 more exercises")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "כן, להמשיך" : "Yes, continue" }).click();
      await expect(page.getByText(lang === "he" ? "השלב הושלם" : "Stage completed")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "לשלב הבא" : "Next stage" }).click();
      expect((await said()).at(-1)).toContain("\"stageId\":\"S003\"");

      await page.goto(url("mcq"));
      // an option that starts with a formula still reads in the card language
      expect(await page.locator("ul li").nth(3).locator("p").evaluate((e) => getComputedStyle(e).direction)).toBe(lang === "he" ? "rtl" : "ltr");
      await page.getByRole("button", { name: /diverges|מתבדרת/ }).click();
      await expect(page.getByRole("status")).toContainText(lang === "he" ? "לא נכון" : "Not quite");
      expect((await said()).at(-1)).toContain(lang === "he" ? "C) מתבדרת" : "C) diverges");
      await axe();
      await page.screenshot({ path: `e2e/shots/card-mcq-${lang}-${theme}.png` });

      await page.goto(url("open"));
      const send = page.getByRole("button", { name: lang === "he" ? "שליחת התשובה" : "Send answer" });
      await expect(send).toBeDisabled();
      // empty answer box: the placeholder follows the card language
      expect(await page.getByRole("textbox").evaluate((e) => getComputedStyle(e).direction)).toBe(lang === "he" ? "rtl" : "ltr");
      await page.getByRole("textbox").fill("Because $1/n$ is below $\\varepsilon$ for large $n$.");
      await axe();
      await send.click();
      expect((await said()).at(-1)).toContain("Because");

      await page.goto(url("figure"));
      await expect(page.locator("figure svg").first()).toBeVisible();
      await expect(page.locator("figcaption .katex").first()).toBeVisible();
      await axe();
      await page.screenshot({ path: `e2e/shots/card-figure-${lang}-${theme}.png` });

      await page.goto(url("step"));
      await expect(page.locator("article .katex").first()).toBeVisible();
      // \neq overlays a slash on "="; it shows as "/=" when KaTeX's CSS and JS versions differ
      expect(await page.locator("article .katex .katex-thinbox").first().evaluate((e) => getComputedStyle(e).maxWidth)).toBe("0px");
      // board layout: labelled rows lined up at "=", a definition box, a sticky side note, a boxed result
      const axioms = page.locator(".board-rows").first();
      await expect(axioms.locator(".board-row")).toHaveCount(8); // "בדיוק אחד מהבאים:" / "exactly one of:" gets its own line
      if (lang === "he") await expect(axioms.locator(".board-mixed")).toContainText("וגם"); // words in a formula become text
      const eq = await axioms.locator(".board-rel .katex").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
      expect(new Set(eq).size).toBe(1); // every formula, the trichotomy one too, lined up at its relation
      // the left sides end at the relation (aligned), whatever their width
      const lhs = await axioms.locator(".board-lhs .katex").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().right)));
      expect(Math.max(...lhs) - Math.min(...lhs)).toBeLessThanOrEqual(2);
      // the names are on the reading side: right of the formulas in Hebrew, left in English
      const [name, formula] = await Promise.all([axioms.locator(".board-label").first(), axioms.locator(".board-rhs").first()].map((l) => l.boundingBox()));
      if (lang === "he") expect(name!.x).toBeGreaterThan(formula!.x + formula!.width - 1);
      else if ((await axioms.getAttribute("data-stack")) === "true") expect(name!.y + name!.height).toBeLessThanOrEqual(formula!.y + 1); // too narrow: the name above its formula
      else expect(name!.x + name!.width).toBeLessThan(formula!.x);
      await expect(page.locator(".board-box-proof").getByText("∎")).toHaveCount(0); // the mark is CSS, after the last line
      const proofRows = page.locator(".board-box-proof .board-rows, .board-box-proof .katex-display").first();
      const proofBox = (await proofRows.boundingBox())!;
      const mark = await proofRows.evaluate((e) => getComputedStyle(e, "::after").content);
      if (lang === "he") expect(mark).toBe('"∎"');
      expect(proofBox.height).toBeGreaterThan(40);
      if (lang === "he") {
        // the proof's reasons: right-to-left notes left of the lined-up formulas ("מ-x = 0·a" reads right to left)
        const proof = page.locator(".board-box-proof .board-rows");
        await expect(proof.locator(".board-note")).toHaveCount(3);
        const [note, rhs] = await Promise.all([proof.locator(".board-note").last(), proof.locator(".board-lhs").last()].map((l) => l.boundingBox()));
        expect(note!.x + note!.width).toBeLessThanOrEqual(rhs!.x + 1);
        const [line, math] = await Promise.all([proof.locator(".board-note p").last(), proof.locator(".board-note .katex").last()].map((l) => l.boundingBox()));
        expect(math!.x + math!.width).toBeLessThan(line!.x + line!.width - 8); // "מ-" is right of its formula
      }
      await expect(page.locator(".board-box-definition")).toContainText(lang === "he" ? "הגדרה" : "Definition");
      await expect(page.locator(".sticky-note .katex")).toBeVisible();
      await expect(page.locator("article .katex .fbox")).toBeVisible();
      await axe();
      await page.screenshot({ path: `e2e/shots/card-step-${lang}-${theme}.png`, fullPage: true });
      await page.getByRole("button", { name: lang === "he" ? "יש לי שאלה" : "I have a question" }).click();
      await page.getByRole("textbox").fill("Why?");
      await page.getByRole("button", { name: lang === "he" ? "שליחת השאלה" : "Send question" }).click();
      expect((await said()).at(-1)).toBe('{"kind":"step","action":"question","text":"Why?"}');
      await expect(page.getByRole("status").filter({ hasText: "Why?" })).toBeVisible();
      // the answer pops up over the step (answer_question), not as a new step card
      const pop = page.getByRole("dialog", { name: lang === "he" ? "תשובה לשאלה שלך" : "Answer to your question" });
      await expect(pop.locator(".katex")).toBeVisible();
      await expect(pop).toContainText("Why?");
      await axe();
      await pop.getByRole("button", { name: lang === "he" ? "סגירה" : "Close" }).last().click();
      await expect(page.getByRole("button", { name: lang === "he" ? "הסבר אחרת" : "Explain differently" })).toBeVisible();
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
      expect((await page.evaluate(() => (window as unknown as { __said: string[] }).__said)).at(-1)).toBe(lang === "he" ? "▶️ המשך" : "▶️ Continue");
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
      await expect(page.getByText(lang === "he" ? "טעות סימן" : "Sign slip")).toBeVisible();
      await page.getByRole("button", { name: lang === "he" ? "ללמוד שוב" : "Learn again" }).click();
      expect(JSON.stringify((await page.evaluate(() => (window as unknown as { __reqs: unknown[] }).__reqs)).at(-1))).toContain("S001");
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
      await expect(page.getByText(lang === "he" ? "הטכניון" : "Technion", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert")).toContainText("dev1 (1).jsonl");
      await page.getByRole("spinbutton").first().fill("3");
      await expect(page.getByRole("spinbutton").first()).toHaveValue("3");
      const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad).toEqual([]);
      await page.screenshot({ path: `e2e/shots/card-settings-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

test("university picker before the first choice", async ({ page }) => {
  await page.goto("/src/cards/test-host.html?lang=en&nouni=1");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your university");
  for (const n of ["Technion", "Hebrew University", "Reichman University", "Braude College"]) await expect(page.getByRole("button", { name: n })).toBeVisible();
  const bad = (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad).toEqual([]);
});
