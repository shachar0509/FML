import { sanitizeSvg } from "./specs";
import { boxClass, useDraw } from "./useDraw";

export function Svg({ source }: { source: string; dark: boolean }) {
  const ref = useDraw(
    (el) => {
      el.innerHTML = sanitizeSvg(source);
      const svg = el.firstElementChild as SVGElement;
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.color = "currentColor";
    },
    [source],
  );
  // SVG coordinates run left to right: in a Hebrew card an inherited rtl would flip every text-anchor (labels land on the wrong side)
  return <div ref={ref} className={boxClass} dir="ltr" />;
}
