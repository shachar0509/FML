import { useEffect, useRef } from "react";
import type { Board, GeometryElement } from "jsxgraph";
import { parseGeometry } from "./specs";
import { boxClass, useDraw } from "./useDraw";

/** M78: elements tagged with a later beat stay hidden; what has appeared stays. */
type Parts = { el: GeometryElement; beat: number }[];
function showBeat(parts: Parts, beat: number | undefined) {
  for (const p of parts) {
    if (beat === undefined || p.beat <= beat) p.el.showElement();
    else p.el.hideElement();
  }
}

export function Geometry({ source, dark, beat }: { source: string; dark: boolean; beat?: number }) {
  // The draw is async and runs after the effects below, so it reads the beat set there.
  const at = useRef(beat);
  const parts = useRef<Parts>([]);
  const ref = useDraw(
    async (el) => {
      const spec = parseGeometry(source);
      const { default: JXG } = await import("jsxgraph");
      const ink = dark ? "#e5e7eb" : "#1f2937";
      // The colours of \blue{…} etc. in the text, from the card theme.
      const css = getComputedStyle(el);
      const tint = (c?: string) => (c && css.getPropertyValue(`--m-${c}`).trim()) || ink;
      const [x0, y1, x1, y0] = spec.boundingBox;
      const ratio = Math.abs(x1 - x0) / Math.abs(y1 - y0);
      const box = document.createElement("div");
      box.style.width = "100%";
      // ponytail: 560px tall at most inline (the card iframe grows with its content, so vh is useless there); full screen lifts it in cards.css
      box.style.maxWidth = `calc(var(--fig-h, 560px) * ${ratio})`;
      box.style.aspectRatio = `${ratio}`;
      el.appendChild(box);
      const board: Board = JXG.JSXGraph.initBoard(box, {
        boundingBox: spec.boundingBox,
        axis: spec.axis ?? false,
        grid: spec.grid ?? false,
        showNavigation: false,
        showCopyright: false,
        pan: { enabled: false },
        zoom: false,
        keepAspectRatio: false,
      });
      const base = { fixed: true, strokeColor: ink, highlight: false } as const;
      const made: Parts = [];
      const pts = new Map<string, GeometryElement>();
      const pt = (r: string | [number, number]) =>
        typeof r === "string"
          ? pts.get(r)
          : board.create("point", r, { ...base, visible: false, name: "" });
      for (const e of spec.elements) {
        const c = tint(e.color);
        const dash = "dashed" in e && e.dashed ? 2 : 0;
        const name = "label" in e ? (e.label ?? "") : "";
        const style = { ...base, strokeColor: c, strokeWidth: e.color ? 3 : 2, dash, name, withLabel: name !== "", label: { color: c } };
        let made1: unknown;
        switch (e.type) {
          case "point":
            made1 = board.create("point", [e.x, e.y], {
              ...style,
              fillColor: c,
              size: e.color ? 3 : 2,
              name: e.label ?? "",
              withLabel: !!e.label,
            });
            pts.set(e.id, made1 as GeometryElement);
            break;
          case "segment":
            made1 = board.create("segment", [pt(e.from), pt(e.to)], style);
            break;
          case "line":
            made1 = board.create("line", [pt(e.through[0]), pt(e.through[1])], style);
            break;
          case "arrow":
            made1 = board.create("arrow", [pt(e.from), pt(e.to)], style);
            break;
          case "circle":
            made1 = board.create("circle", [pt(e.center), e.radius], style);
            break;
          case "polygon":
            made1 = board.create("polygon", e.vertices.map(pt), {
              ...base,
              fillColor: c,
              fillOpacity: e.fill ? 0.15 : 0,
              vertices: { visible: false },
              borders: { strokeColor: c, fixed: true },
            });
            break;
          case "angle":
            made1 = board.create("angle", e.points.map(pt), { ...style, radius: 0.5, fillColor: c });
            break;
          case "curve":
            made1 = board.create(
              "functiongraph",
              [board.jc.snippet(e.fn, true, "x", true), e.domain[0], e.domain[1]],
              { ...base, strokeColor: c, strokeWidth: e.color ? 3 : 2 },
            );
            break;
          case "text":
            made1 = board.create("text", [e.x, e.y, e.text], { ...base, fixed: true, strokeColor: c });
            break;
        }
        if (made1 && e.beat) made.push({ el: made1 as GeometryElement, beat: e.beat });
      }
      parts.current = made;
      showBeat(made, at.current);
      const svg = box.querySelector("svg");
      if (svg) svg.style.maxWidth = "100%";
      // A wider card (full screen, a resized window) redraws the board at its new size.
      // dontSet: the box keeps its CSS size (setting px sizes here would feed the observer again).
      let w = box.clientWidth;
      const ro = new ResizeObserver(() => {
        if (!box.clientWidth || Math.abs(box.clientWidth - w) < 2) return;
        w = box.clientWidth;
        board.resizeContainer(box.clientWidth, box.clientHeight, true, true);
      });
      ro.observe(box);
      return () => (ro.disconnect(), (parts.current = []), JXG.JSXGraph.freeBoard(board));
    },
    [source, dark],
  );
  useEffect(() => {
    at.current = beat;
    showBeat(parts.current, beat);
  }, [beat]);
  return <div ref={ref} className={`${boxClass} w-full`} />;
}
