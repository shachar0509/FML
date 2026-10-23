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

/** `max`: a size cap above the default 50 KB, for drawings that come from Shalav's server (library parts, TeX output). */
export function Svg({ source, dark, beat, max }: { source: string; dark: boolean; beat?: number; max?: number }) {
  // The draw is async and runs after the effects below, so it reads the beat set there.
  const at = useRef(beat);
  const ref = useDraw(
    (el) => {
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
