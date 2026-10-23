import { useEffect, useRef } from "react";
import { sanitizeSvg } from "./specs";
import { boxClass, useDraw } from "./useDraw";

/** M78: parts with data-beat="n" appear at beat n and stay; data-focus="n" is stressed only during beat n. */
function showBeat(el: HTMLElement, beat: number | undefined) {
  for (const n of el.querySelectorAll<SVGElement>("[data-beat]")) n.classList.toggle("beat-off", beat !== undefined && Number(n.dataset.beat) > beat);
  for (const n of el.querySelectorAll<SVGElement>("[data-focus]")) n.classList.toggle("beat-focus", beat !== undefined && Number(n.dataset.focus) === beat);
}

export function Svg({ source, beat }: { source: string; dark: boolean; beat?: number }) {
  // The draw is async and runs after the effects below, so it reads the beat set there.
  const at = useRef(beat);
  const ref = useDraw(
    (el) => {
      el.innerHTML = sanitizeSvg(source);
      const svg = el.firstElementChild as SVGElement;
      svg.style.width = "100%";
      svg.style.height = "auto";
      svg.style.color = "currentColor";
      showBeat(el, at.current);
    },
    [source],
  );
  useEffect(() => {
    at.current = beat;
    if (ref.current) showBeat(ref.current, beat);
  }, [ref, beat]);
  // SVG coordinates run left to right: in a Hebrew card an inherited rtl would flip every text-anchor (labels land on the wrong side)
  return <div ref={ref} className={`${boxClass} fig-svg`} dir="ltr" />;
}
