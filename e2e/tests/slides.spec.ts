import { expect, test, type Page } from "@playwright/test";
import { axe, box, lastReq } from "./helpers";

// M78 interactive slides (Step.tsx with beats): Next reveals the next beat's text and figure parts in the card, without a
// request to Claude; what appeared stays. Samples in src/cards/test-advanced.ts. Screenshots per beat in e2e/tests_output/slides/.
/** Visible text in the slide's figure under 4.5:1 against the figure's background. */
const lowContrast = (page: Page) =>
  page.locator(".pinned-figure").evaluate((fig) => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: string) => rgb(c).map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((a, v, i) => a + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
    const bg = lum(getComputedStyle(fig).backgroundColor);
    return [...fig.querySelectorAll<HTMLElement | SVGElement>("svg text, div, span")]
      .filter((e) => e.textContent?.trim() && e.getClientRects().length && getComputedStyle(e).visibility === "visible" && (e instanceof SVGElement || [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())))
      .map((e) => {
        const l = lum(getComputedStyle(e)[e instanceof SVGElement ? "fill" : "color"]);
        return [e.textContent?.trim(), (Math.max(l, bg) + 0.05) / (Math.min(l, bg) + 0.05)] as const;
      })
      .filter(([, k]) => k < 4.5)
      .map(([t, k]) => `${t}: ${k.toFixed(2)}`);
  });
// M79: beatsCircuit, beatsIncline and beatsMethane are TikZ (drawn by TeX on the server, % @n markers); beatsPhoto and beatsCell
// place library parts (bio); beatsCircuitSvg is the hand-drawn svg kind.
const SAMPLES = { beatsFn: 7, beatsCircuit: 3, beatsPhoto: 5, beatsCell: 3, beatsCircuitSvg: 3, beatsIncline: 5, beatsMethane: 3 } as const;
const SERVER = ["beatsCircuit", "beatsPhoto", "beatsCell", "beatsIncline", "beatsMethane"];
for (const [sample, of] of Object.entries(SAMPLES))
  for (const theme of ["light", "dark"] as const)
    test(`slide ${sample} (${theme})`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width: 1100, height: 1400 }); // the whole slide in view: screenshots without the sticky header over it
      await page.goto(`/src/cards/test-host.html?lang=he&theme=${theme}&view=step&sample=${sample}`);
      const board = page.locator("article.board");
      const next = page.getByRole("button", { name: "הלאה", exact: true });
      const beatText = (n: number) => board.locator(`[data-beat-text="${n}"]`);
      await expect(beatText(1)).toBeVisible();
      // a server-drawn figure arrives from figure_render (the dev server's /__figure here) and replaces the placeholder
      await expect(board.locator(".pinned-figure svg").first()).toBeVisible({ timeout: 20_000 });
      if (SERVER.includes(sample)) await expect(board.locator(".pinned-figure [role=alert]")).toHaveCount(0);
      if (["beatsPhoto", "beatsCell"].includes(sample)) await expect(board.locator(".fig-credit")).toHaveText(/Servier Medical Art \(CC BY 3\.0\)/);
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
          // the minimum is marked at beat 3 and stays; the parabola comes at 5, (0,1) at 6, (2,1) and the dashed line at 7
          if (n >= 3) await expect(board.getByText("(1,0)", { exact: true }).last()).toBeVisible();
          else await expect(board.getByText("(1,0)", { exact: true }).last()).toBeHidden();
          if (n < 6) await expect(board.getByText("(0,1)", { exact: true }).last()).toBeHidden();
          else await expect(board.getByText("(0,1)", { exact: true }).last()).toBeVisible();
          const now = await drawn();
          if ([3, 5, 6, 7].includes(n)) expect(now).toBeGreaterThan(before); // the drawing only grows
          else expect(now).toBe(before);
          before = now;
        } else {
          // a part shows from its data-beat until its data-until (CO₂ and H₂O are gone once they have reacted)
          const parts = await board.locator("svg :is([data-beat], [data-until])").evaluateAll((els) => els.map((e) => [Number((e as SVGElement).dataset.beat ?? 0), Number((e as SVGElement).dataset.until ?? 99), getComputedStyle(e).visibility === "visible"] as const));
          expect(parts.length).toBeGreaterThan(0);
          for (const [b, u, on] of parts) expect(on).toBe(b <= n && n <= u);
        }
        // every piece of text in the figure reads on the figure's background (no black numbers on the chalkboard)
        expect(await lowContrast(page)).toEqual([]);
        await page.waitForTimeout(500); // fade-in
        await page.screenshot({ path: `e2e/tests_output/slides/${sample}-${theme}-${n}.png` });
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
for (const sample of ["beatsFn", "beatsCircuit", "beatsCell", "beatsIncline"])
  test(`narrow slide ${sample}`, async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 900 });
    await page.goto(`/src/cards/test-host.html?lang=he&theme=light&view=step&sample=${sample}`);
    const board = page.locator("article.board");
    await expect(board.locator('[data-beat-text="1"]')).toBeVisible();
    await expect(board.locator(".pinned-figure svg").first()).toBeVisible({ timeout: 20_000 });
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
