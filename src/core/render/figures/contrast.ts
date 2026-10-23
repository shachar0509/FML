/** WCAG contrast of two "rgb(…)" / "rgba(…)" colours; null when one isn't a plain colour (none, url(…)). */
const rgb = (c: string) => c.match(/^rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/)?.slice(1).map(Number);
const lum = ([r = 0, g = 0, b = 0]: number[]) => {
  const ch = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};
export function contrast(a: string, b: string): number | null {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y || x[3] === 0) return null;
  const [l1, l2] = [lum(x), lum(y)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** The first opaque background at or above `el`. */
function backdrop(el: Element): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    const v = rgb(c);
    if (v && v[3] !== 0) return c;
  }
  return "rgb(255, 255, 255)";
}

/**
 * Every piece of text in a drawn figure must read on the figure's background (black tick labels on a dark board,
 * a hard-coded fill="black" from Claude in dark mode): text under 4.5:1 takes the board's text colour.
 */
export function ensureContrast(root: HTMLElement) {
  const bg = backdrop(root);
  const fg = getComputedStyle(root).color;
  for (const el of root.querySelectorAll<HTMLElement | SVGElement>("text, tspan, div, span")) {
    if (el.closest("[data-own-bg], mask, clipPath, defs")) continue; // M82: text on a drawn backdrop of its own (a Go stone, the wood), in fixed colours; mask text only shapes a cut-out
    const svg = el instanceof SVGElement;
    if (![...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())) continue; // a <text> of coloured <tspan>s: its tspans are checked
    const c = getComputedStyle(el)[svg ? "fill" : "color"];
    const k = contrast(c, bg);
    if (k !== null && k < 4.5) el.style[svg ? "fill" : "color"] = fg;
  }
}
