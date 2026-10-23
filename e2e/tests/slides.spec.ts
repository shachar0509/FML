import { expect, test } from "@playwright/test";
import { axe, box, lastReq } from "./helpers";

// M78 interactive slides (Step.tsx with beats): Next reveals the next beat's text and figure parts in the card, without a
// request to Claude; what appeared stays. Samples in src/cards/test-advanced.ts. Screenshots per beat in e2e/tests_output/slides/.
const SAMPLES = { beatsFn: 3, beatsCircuit: 3, beatsPhoto: 3, beatsCell: 3 } as const;
for (const [sample, of] of Object.entries(SAMPLES))
  for (const theme of ["light", "dark"] as const)
    test(`slide ${sample} (${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`/src/cards/test-host.html?lang=he&theme=${theme}&view=step&sample=${sample}`);
      const board = page.locator("article.board");
      const next = page.getByRole("button", { name: "הלאה", exact: true });
      const beatText = (n: number) => board.locator(`[data-beat-text="${n}"]`);
      await expect(beatText(1)).toBeVisible();
      await page.waitForTimeout(500); // the figure finishes drawing
      const height = (await box(board)).height;
      const reqs = await lastReq(page);
      // the figure is the larger column on a wide card, and the text is on the reading side (right in Hebrew)
      const [fig, text] = await Promise.all([board.locator(".pinned-figure"), beatText(1)].map(box));
      expect(fig.width).toBeGreaterThan(0.5 * (await box(board)).width);
      expect(text.x).toBeGreaterThan(fig.x);

      // drawn lines and curves showing in the figure, per beat (JSXGraph hides a part with display: none)
      const drawn = () => board.locator(".pinned-figure svg :is(path, line, ellipse, circle)").evaluateAll((els) => els.filter((e) => { const c = getComputedStyle(e); return c.display !== "none" && c.visibility === "visible" && !e.closest("[style*='display: none']"); }).length);
      let before = sample === "beatsFn" ? await drawn() : 0;
      for (let n = 1; n <= of; n++) {
        await expect(page.getByRole("status").filter({ hasText: `חלק ${n} מתוך ${of}` })).toBeVisible();
        for (let k = 1; k <= of; k++) {
          // reached beats are shown (earlier ones muted), later ones are invisible but keep their room
          if (k <= n) await expect(beatText(k)).toBeVisible();
          else await expect(beatText(k)).toBeHidden();
        }
        if (sample === "beatsFn") {
          await expect(board.getByText("(1,0)", { exact: true }).last()).toBeVisible(); // the minimum stays marked
          // beat 2 adds the parabola, beat 3 the dashed segment and its points: the drawing only grows
          if (n > 1) {
            const now = await drawn();
            expect(now).toBeGreaterThan(before);
            before = now;
          }
          if (n < 3) await expect(board.getByText("(0,1)", { exact: true }).last()).toBeHidden();
          else await expect(board.getByText("(0,1)", { exact: true }).last()).toBeVisible();
        } else {
          const parts = await board.locator("svg [data-beat]").evaluateAll((els) => els.map((e) => [Number((e as SVGElement).dataset.beat), getComputedStyle(e).visibility === "visible"] as const));
          expect(parts.length).toBeGreaterThan(0);
          for (const [b, on] of parts) expect(on).toBe(b <= n);
        }
        await page.waitForTimeout(500); // fade-in
        await page.screenshot({ path: `e2e/tests_output/slides/${sample}-${theme}-${n}.png`, fullPage: true });
        if (n < of) await next.click();
      }
      // no request to Claude while stepping, and the card never changed height
      expect(await lastReq(page)).toBe(reqs);
      expect(Math.abs((await box(board)).height - height)).toBeLessThanOrEqual(2);
      await expect(board.locator(".katex-error")).toHaveCount(0);
      await expect(board.locator("[role=alert]")).toHaveCount(0);
      const raw = await board.evaluate((e) =>
        [...e.querySelectorAll("p, li, td, th, .board-note")]
          .map((n) => {
            const c = n.cloneNode(true) as HTMLElement;
            c.querySelectorAll(".katex-mathml").forEach((m) => m.remove());
            return c.textContent ?? "";
          })
          .filter((t) => /\$[A-Za-z\\{]|\\[a-zA-Z]{2,}/.test(t)),
      );
      expect(raw).toEqual([]); // \blue{גרעין} in a sentence became a coloured word, not raw TeX
      const wide = await board.evaluate((e) => [...e.querySelectorAll<HTMLElement>(".board-rows, .katex-display")].filter((x) => x.scrollWidth > x.clientWidth + 2).length);
      expect(wide).toBe(0);
      await axe(page);

      // last beat: the main button is Continue again; Back and the arrow keys (← is forward in Hebrew) move between beats
      await expect(next).toHaveCount(0);
      await page.getByRole("button", { name: "אחורה" }).click();
      await expect(beatText(of)).toBeHidden();
      await page.keyboard.press("ArrowLeft");
      await expect(beatText(of)).toBeVisible();
      // a question says which beat is on screen
      await page.getByRole("button", { name: "יש לי שאלה" }).click();
      await page.getByRole("textbox").fill("למה?");
      await page.getByRole("button", { name: "שליחת השאלה" }).click();
      expect(await lastReq(page)).toBe(`{"kind":"step","action":"question","text":"למה?","beat":{"n":${of},"of":${of}}}`);
      await page.getByRole("dialog").getByRole("button").last().click();
      await page.getByRole("button", { name: "הבנתי, המשך" }).click();
      expect(await lastReq(page)).toBe('{"kind":"step","action":"next"}');
      expect(errors).toEqual([]);
    });

// The inline card in a chat is narrower: the figure goes above the text, at the board's width.
for (const sample of ["beatsFn", "beatsCircuit", "beatsCell"])
  test(`narrow slide ${sample}`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto(`/src/cards/test-host.html?lang=he&theme=light&view=step&sample=${sample}`);
    const board = page.locator("article.board");
    await expect(board.locator('[data-beat-text="1"]')).toBeVisible();
    await page.waitForTimeout(500);
    const [fig, text, b] = await Promise.all([board.locator(".pinned-figure"), board.locator('[data-beat-text="1"]'), board].map(box));
    expect(fig.y + fig.height).toBeLessThanOrEqual(text.y);
    expect(fig.width).toBeGreaterThan(0.8 * b.width);
    expect(await board.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
    for (let n = 1; n <= 3; n++) {
      await page.screenshot({ path: `e2e/tests_output/slides/narrow-${sample}-${n}.png`, fullPage: true });
      if (n < 3) await page.getByRole("button", { name: "הלאה", exact: true }).click();
    }
  });

test("full screen: a slide fills the window, with a bigger figure", async ({ page }) => {
  await page.goto(`/src/cards/test-host.html?lang=he&theme=light&view=step&sample=beatsCell`);
  const fig = page.locator(".pinned-figure svg");
  await expect(fig).toBeVisible();
  const inline = await box(fig);
  const size = () => page.locator('[data-beat-text="1"] p').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const inlineSize = await size();
  await page.getByRole("button", { name: "מסך מלא" }).click();
  await expect(page.locator(".cards[data-mode=fullscreen]")).toBeVisible();
  await page.setViewportSize({ width: 1500, height: 950 });
  await expect.poll(async () => (await box(fig)).width).toBeGreaterThan(inline.width);
  expect(await size()).toBeGreaterThan(inlineSize); // bigger text too
  await page.screenshot({ path: "e2e/tests_output/slides/fullscreen.png" });
  await page.getByRole("button", { name: "יציאה ממסך מלא" }).click();
  await expect(page.locator(".cards[data-mode=inline]")).toBeVisible();
});
