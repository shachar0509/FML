import type { FunctionPlotDatum } from "function-plot";
import { useEffect, useState } from "react";
import { ensureContrast } from "./contrast";
import { parsePlot } from "./specs";
import { boxClass, useDraw } from "./useDraw";

export function Plot({ source, beat }: { source: string; dark: boolean; beat?: number }) {
  const [w, setW] = useState(0);
  const ref = useDraw(
    async (el) => {
      const all = parsePlot(source);
      // M78: only the parts whose beat has come (function-plot redraws fast, so a beat change redraws).
      const on = (p: { beat?: number; until?: number }) => beat === undefined || ((p.beat ?? 0) <= beat && beat <= (p.until ?? Infinity));
      const spec = { ...all, data: all.data.filter(on), annotations: all.annotations?.filter(on) };
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
      // ponytail: 560px tall at most inline (vh is useless in a card iframe that grows with its content); full screen lifts it via --fig-h
      const tall = parseFloat(getComputedStyle(el).getPropertyValue("--fig-h")) || 560;
      const width = Math.round(Math.min(el.clientWidth || 480, tall / 0.65));
      el.dataset.w = String(width);
      el.dataset.cap = String(Math.round(tall / 0.65));
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
      ensureContrast(el);
    },
    [source, beat, w],
  );
  // Redraw when the card gets wider or narrower (full screen); only on a real change, so the redraw can't loop.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const want = Math.min(el.clientWidth, Number(el.dataset.cap ?? Infinity));
      if (want && Math.abs(want - Number(el.dataset.w ?? 0)) > 24) setW(want);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return <div ref={ref} className={`${boxClass} w-full`} />;
}
