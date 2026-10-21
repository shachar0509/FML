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
  return <div ref={ref} className={boxClass} />;
}
