import { expect, test } from "@playwright/test";

// Advanced lesson steps (src/cards/test-advanced.ts): logs, trig, tan, integrals — mixed Hebrew and math, figures and
// pictures. Screenshots land in e2e/shots/test6/; the checks catch what a screenshot would only show.
for (const sample of ["log", "trig", "tan", "integral", "parts"])
  for (const theme of ["light", "dark"] as const)
    test(`advanced step ${sample} (${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/src/cards/test-host.html?lang=he&theme=${theme}&view=step&sample=${sample}`);
      const board = page.locator("article.board");
      await expect(board.locator(".katex").first()).toBeVisible();
      await page.waitForTimeout(500); // graphs finish drawing
      await page.screenshot({ path: `e2e/shots/test6/${sample}-he-${theme}.png`, fullPage: true });
      await expect(board.locator(".katex-error")).toHaveCount(0); // every formula renders
      await expect(board.locator(".figure-error, [role=alert]")).toHaveCount(0);
      // no formula shows raw TeX or stray dollars
      const raw = await board.evaluate((e) =>
        [...e.querySelectorAll("p, li, .board-note, .board-lead")]
          .map((n) => {
            const c = n.cloneNode(true) as HTMLElement;
            c.querySelectorAll(".katex-mathml").forEach((m) => m.remove()); // KaTeX keeps the TeX source there for screen readers
            return c.textContent ?? "";
          })
          .filter((t) => /\$|\\[a-zA-Z]{2,}/.test(t)),
      );
      expect(raw).toEqual([]);
      // a figure in the body or beside it is drawn (svg)
      await expect(board.locator("svg").first()).toBeVisible();
      // an svg picture keeps its left-to-right coordinates in a Hebrew card (labels start where the author put them)
      if (sample === "trig") expect(await board.locator("svg text").first().evaluate((t) => getComputedStyle(t).direction)).toBe("ltr");
      // the board fits: nothing scrolls sideways (formulas are not cut off)
      const wide = await board.evaluate((e) => [...e.querySelectorAll<HTMLElement>(".board-rows, .katex-display")].filter((x) => x.scrollWidth > x.clientWidth + 2).map((x) => `${x.className}: ${x.scrollWidth} > ${x.clientWidth} ${x.textContent?.slice(0, 40)}`));
      expect(wide).toEqual([]);
      expect(errors).toEqual([]);
    });
