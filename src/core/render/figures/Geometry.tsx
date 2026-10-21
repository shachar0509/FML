import type { Board, GeometryElement } from "jsxgraph";
import { parseGeometry } from "./specs";
import { boxClass, useDraw } from "./useDraw";

export function Geometry({ source, dark }: { source: string; dark: boolean }) {
  const ref = useDraw(
    async (el) => {
      const spec = parseGeometry(source);
      const { default: JXG } = await import("jsxgraph");
      const ink = dark ? "#e5e7eb" : "#1f2937";
      const [x0, y1, x1, y0] = spec.boundingBox;
      const box = document.createElement("div");
      box.style.width = "100%";
      box.style.maxWidth = "480px";
      box.style.aspectRatio = `${Math.abs(x1 - x0)} / ${Math.abs(y1 - y0)}`;
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
      const pts = new Map<string, GeometryElement>();
      const pt = (r: string | [number, number]) =>
        typeof r === "string"
          ? pts.get(r)
          : board.create("point", r, { ...base, visible: false, name: "" });
      for (const e of spec.elements) {
        const dash = "dashed" in e && e.dashed ? 2 : 0;
        const name = "label" in e ? (e.label ?? "") : "";
        const style = { ...base, dash, name, withLabel: name !== "", label: { color: ink } };
        switch (e.type) {
          case "point":
            pts.set(
              e.id,
              board.create("point", [e.x, e.y], {
                ...style,
                fillColor: ink,
                size: 2,
                name: e.label ?? "",
                withLabel: !!e.label,
              }),
            );
            break;
          case "segment":
            board.create("segment", [pt(e.from), pt(e.to)], style);
            break;
          case "line":
            board.create("line", [pt(e.through[0]), pt(e.through[1])], style);
            break;
          case "arrow":
            board.create("arrow", [pt(e.from), pt(e.to)], style);
            break;
          case "circle":
            board.create("circle", [pt(e.center), e.radius], style);
            break;
          case "polygon":
            board.create("polygon", e.vertices.map(pt), {
              ...base,
              fillColor: ink,
              fillOpacity: e.fill ? 0.15 : 0,
              vertices: { visible: false },
              borders: { strokeColor: ink, fixed: true },
            });
            break;
          case "angle":
            board.create("angle", e.points.map(pt), { ...style, radius: 0.5, fillColor: ink });
            break;
          case "curve":
            board.create(
              "functiongraph",
              [board.jc.snippet(e.fn, true, "x", true), e.domain[0], e.domain[1]],
              base,
            );
            break;
          case "text":
            board.create("text", [e.x, e.y, e.text], { ...base, fixed: true, strokeColor: ink });
            break;
        }
      }
      const svg = box.querySelector("svg");
      if (svg) svg.style.maxWidth = "100%";
      return () => JXG.JSXGraph.freeBoard(board);
    },
    [source, dark],
  );
  return <div ref={ref} className={boxClass} />;
}
