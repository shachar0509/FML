import type { FunctionPlotDatum } from "function-plot";
import { parsePlot } from "./specs";
import { boxClass, useDraw } from "./useDraw";

export function Plot({ source }: { source: string; dark: boolean }) {
  const ref = useDraw(
    async (el) => {
      const spec = parsePlot(source);
      // CJS interop: the default export is nested once more in some bundles (Vite dev).
      const m = (await import("function-plot")) as unknown as { default: { default?: typeof import("function-plot").default } & typeof import("function-plot").default };
      const functionPlot = m.default.default ?? m.default;
      const data: FunctionPlotDatum[] = spec.data.map((d) => {
        if ("fn" in d) return { fn: d.fn, range: d.range, color: d.color, graphType: "polyline" };
        if ("points" in d) {
          return {
            fnType: "points",
            graphType: d.mode === "scatter" ? "scatter" : "polyline",
            points: d.points,
          };
        }
        return {
          fnType: "vector",
          graphType: "polyline",
          vector: d.vector,
          offset: d.offset ?? [0, 0],
        };
      });
      const width = Math.min(el.clientWidth || 480, 640);
      functionPlot({
        target: el,
        title: spec.title,
        width,
        height: Math.round(width * 0.65),
        xAxis: { domain: spec.xDomain },
        yAxis: spec.yDomain ? { domain: spec.yDomain } : undefined,
        grid: spec.grid ?? true,
        disableZoom: true,
        tip: { renderer: () => "" },
        data,
        annotations: spec.annotations,
      });
      // Theme: axes, ticks and text follow the current text colour.
      const svg = el.querySelector("svg");
      if (!svg) throw new Error("function-plot produced no svg");
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.style.color = "inherit";
      svg.querySelectorAll("text").forEach((t) => (t.style.fill = "currentColor"));
      svg
        .querySelectorAll(".domain, .tick line, .origin")
        .forEach((n) => ((n as SVGElement).style.stroke = "currentColor"));
    },
    [source],
  );
  return <div ref={ref} className={boxClass} />;
}
