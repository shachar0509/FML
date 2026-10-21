import { expect, test } from "@playwright/test";
import { axe, box, host, LANGS, lastReq, pageErrors, THEMES } from "./helpers";

// The teaching board (Step.tsx, FigureCard.tsx) with the board layout from src/core/render.
for (const lang of LANGS)
  for (const theme of THEMES) {
    const url = (v: string) => host(`view=${v}&lang=${lang}&theme=${theme}`);

    test(`figure card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
      await page.goto(url("figure"));
      await expect(page.locator("figure svg").first()).toBeVisible();
      await expect(page.locator("figcaption .katex").first()).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/shots/card-figure-${lang}-${theme}.png` });
      expect(errors).toEqual([]);
    });

    test(`step card (${lang}/${theme})`, async ({ page }) => {
      const errors = pageErrors(page);
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
      const [name, formula] = await Promise.all([axioms.locator(".board-label").first(), axioms.locator(".board-rhs").first()].map(box));
      // too narrow (it depends on the KaTeX fonts being cached when the board first measures): the name above its formula
      if ((await axioms.getAttribute("data-stack")) === "true") expect(name.y + name.height).toBeLessThanOrEqual(formula.y + 1);
      else if (lang === "he") expect(name.x).toBeGreaterThan(formula.x + formula.width - 1);
      else expect(name.x + name.width).toBeLessThan(formula.x);
      await expect(page.locator(".board-box-proof").getByText("∎")).toHaveCount(0); // the mark is CSS, after the last line
      const proofRows = page.locator(".board-box-proof .board-rows, .board-box-proof .katex-display").first();
      const proofBox = await box(proofRows);
      const mark = await proofRows.evaluate((e) => getComputedStyle(e, "::after").content);
      if (lang === "he") expect(mark).toBe('"∎"');
      expect(proofBox.height).toBeGreaterThan(40);
      if (lang === "he") {
        // the proof's reasons: right-to-left notes left of the lined-up formulas ("מ-x = 0·a" reads right to left)
        const proof = page.locator(".board-box-proof .board-rows");
        await expect(proof.locator(".board-note")).toHaveCount(3);
        const [note, rhs] = await Promise.all([proof.locator(".board-note").last(), proof.locator(".board-lhs").last()].map(box));
        expect(note.x + note.width).toBeLessThanOrEqual(rhs.x + 1);
        const [line, math] = await Promise.all([proof.locator(".board-note p").last(), proof.locator(".board-note .katex").last()].map(box));
        expect(math.x + math.width).toBeLessThan(line.x + line.width - 8); // "מ-" is right of its formula
      }
      await expect(page.locator(".board-box-definition")).toContainText(lang === "he" ? "הגדרה" : "Definition");
      await expect(page.locator(".sticky-note .katex")).toBeVisible();
      await expect(page.locator("article .katex .fbox")).toBeVisible();
      await axe(page);
      await page.screenshot({ path: `e2e/shots/card-step-${lang}-${theme}.png`, fullPage: true });
      await page.getByRole("button", { name: lang === "he" ? "יש לי שאלה" : "I have a question" }).click();
      await page.getByRole("textbox").fill("Why?");
      await page.getByRole("button", { name: lang === "he" ? "שליחת השאלה" : "Send question" }).click();
      expect(await lastReq(page)).toBe('{"kind":"step","action":"question","text":"Why?"}');
      await expect(page.getByRole("status").filter({ hasText: "Why?" })).toBeVisible();
      // the answer pops up over the step (answer_question), not as a new step card
      const pop = page.getByRole("dialog", { name: lang === "he" ? "תשובה לשאלה שלך" : "Answer to your question" });
      await expect(pop.locator(".katex")).toBeVisible();
      await expect(pop).toContainText("Why?");
      await axe(page);
      await pop.getByRole("button", { name: lang === "he" ? "סגירה" : "Close" }).last().click();
      await expect(page.getByRole("button", { name: lang === "he" ? "הסבר אחרת" : "Explain differently" })).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
