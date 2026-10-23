import { useEffect, useRef } from "react";
import { ensureContrast } from "./contrast";
import { sanitizeSvg } from "./specs";
import { boxClass, useDraw } from "./useDraw";

/** M78: parts with data-beat="n" appear at beat n and stay (until data-until="m": gone after beat m); data-focus="n" is stressed only during beat n. */
export function showBeat(el: HTMLElement, beat: number | undefined) {
  for (const n of el.querySelectorAll<SVGElement>("[data-beat], [data-until]")) n.classList.toggle("beat-off", beat !== undefined && (Number(n.dataset.beat ?? 0) > beat || Number(n.dataset.until ?? Infinity) < beat));
  for (const n of el.querySelectorAll<SVGElement>("[data-focus]")) n.classList.toggle("beat-focus", beat !== undefined && Number(n.dataset.focus) === beat);
}

/** M79 shading kit: gradients any figure can fill with (fill="url(#shade-blue)"), added by the card (Claude's <defs> may not hold filters). */
const SHADES = { blue: "#7fb3e8,#2f6db5,#163c6e", green: "#a6dc86,#3f9a34,#1f5a1f", pink: "#f5a3b5,#d0466a,#7d1d38", orange: "#ffd08a,#e08a2a,#8a4a0a", gray: "#f2f2f2,#a9adb3,#5b6068" };
const SHADE_DEFS = `<defs>${Object.entries(SHADES)
  .map(([n, c]) => {
    const [a, b, d] = c.split(",");
    return `<radialGradient id="shade-${n}" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="${a}"/><stop offset=".6" stop-color="${b}"/><stop offset="1" stop-color="${d}"/></radialGradient>`;
  })
  .join("")}</defs>`;

const SHAPES = "path, line, polyline, polygon, circle, ellipse, rect";

/** Each shape under `.sketch` becomes rough.js paths with the shape's own stroke, fill, class and beat (a fixed seed: the same sketch every time). */
async function sketch(svg: SVGElement) {
  const { default: rough } = await import("roughjs");
  const gen = rough.generator();
  const n = (e: Element, a: string) => Number(e.getAttribute(a) ?? 0);
  for (const e of svg.querySelectorAll(SHAPES.split(", ").map((t) => `.sketch ${t}, ${t}.sketch`).join(", "))) {
    if (e.closest("defs, clipPath, mask")) continue;
    const cs = getComputedStyle(e);
    const fill = e.getAttribute("fill") ?? (cs.fill === "none" ? undefined : cs.fill);
    const o = { seed: 7, roughness: 1.3, bowing: 1, stroke: e.getAttribute("stroke") ?? "currentColor", strokeWidth: Number.parseFloat(cs.strokeWidth) || 1.5, fill: fill && fill !== "none" ? fill : undefined, fillStyle: fill?.startsWith("url(") ? "solid" : "hachure", hachureGap: 6 };
    const pts = () => (e.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number).reduce<[number, number][]>((a, v, i, all) => (i % 2 ? a : [...a, [v, all[i + 1] ?? 0]]), []);
    const tag = e.localName;
    const d =
      tag === "rect" ? gen.rectangle(n(e, "x"), n(e, "y"), n(e, "width"), n(e, "height"), o)
      : tag === "circle" ? gen.circle(n(e, "cx"), n(e, "cy"), 2 * n(e, "r"), o)
      : tag === "ellipse" ? gen.ellipse(n(e, "cx"), n(e, "cy"), 2 * n(e, "rx"), 2 * n(e, "ry"), o)
      : tag === "line" ? gen.line(n(e, "x1"), n(e, "y1"), n(e, "x2"), n(e, "y2"), o)
      : tag === "polygon" ? gen.polygon(pts(), o)
      : tag === "polyline" ? gen.linearPath(pts(), o)
      : gen.path(e.getAttribute("d") ?? "", o);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    for (const a of [...e.attributes]) if (/^(class|data-|style|transform|opacity)/.test(a.name)) g.setAttribute(a.name, a.value);
    for (const p of gen.toPaths(d)) {
      const q = g.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "path"));
      q.setAttribute("d", p.d);
      q.setAttribute("stroke", p.stroke);
      q.setAttribute("stroke-width", String(p.strokeWidth));
      q.setAttribute("fill", p.fill ?? "none");
      if (e.hasAttribute("pathLength")) q.setAttribute("pathLength", "1");
    }
    e.replaceWith(g);
  }
}

/** `max`: a size cap above the default 50 KB, for drawings that come from Shalav's server (library parts, TeX output). */
export function Svg({ source, dark, beat, max }: { source: string; dark: boolean; beat?: number; max?: number }) {
  // The draw is async and runs after the effects below, so it reads the beat set there.
  const at = useRef(beat);
  const ref = useDraw(
    async (el) => {
      el.innerHTML = sanitizeSvg(source, max);
      const svg = el.firstElementChild as SVGElement;
      if (source.includes("url(#shade-")) svg.insertAdjacentHTML("afterbegin", SHADE_DEFS);
      // the library's credit line (Servier Medical Art, CC BY): shown under the drawing
      if (svg.dataset.credit) {
        const p = document.createElement("p");
        p.className = "fig-credit";
        p.textContent = svg.dataset.credit;
        el.append(p);
      }
      // M82: `draw` strokes are drawn in when their beat comes (cards.css); `sketch` redraws shapes by hand (rough.js, loaded only then)
      for (const e of svg.querySelectorAll(SHAPES.split(", ").map((t) => `.draw ${t}, ${t}.draw`).join(", "))) e.setAttribute("pathLength", "1");
      if (svg.querySelector(".sketch")) await sketch(svg);
      svg.style.width = "100%";
      svg.style.height = "auto";
      svg.style.color = "currentColor";
      showBeat(el, at.current);
      ensureContrast(el);
    },
    [source, dark],
  );
  useEffect(() => {
    at.current = beat;
    if (ref.current) showBeat(ref.current, beat);
  }, [ref, beat]);
  // SVG coordinates run left to right: in a Hebrew card an inherited rtl would flip every text-anchor (labels land on the wrong side)
  return <div ref={ref} className={`${boxClass} fig-svg`} dir="ltr" />;
}
