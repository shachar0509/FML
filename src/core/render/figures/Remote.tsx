import { useEffect, useState } from "react";
import { Svg } from "./Svg";

/** M79: figures drawn on Shalav's server (TikZ, the biology library…): the card fetches the SVG (figure_render) and shows it like an svg figure. */
type Render = (kind: string, source: string) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
let render: Render | undefined;
export const setFigureRenderer = (r: Render) => void (render = r);

export function Remote({ kind, source, dark, beat }: { kind: string; source: string; dark: boolean; beat?: number }) {
  const [got, setGot] = useState<{ key: string; svg?: string; error?: string }>();
  const key = `${kind}\n${source}`;
  useEffect(() => {
    let live = true;
    (render ? render(kind, source) : Promise.reject(new Error("no renderer")))
      .then((r) => {
        const svg = (r.structuredContent as { svg?: string } | undefined)?.svg;
        if (live) setGot(r.isError || !svg ? { key, error: "render failed" } : { key, svg });
      })
      .catch((e: unknown) => live && setGot({ key, error: String(e) }));
    return () => {
      live = false;
    };
  }, [kind, source, key]);
  if (got?.key === key && got.error) throw new Error(got.error); // the figure boundary shows the source
  if (got?.key !== key || !got.svg) return <div className="my-3 h-40 animate-pulse rounded-lg bg-card" />;
  return <Svg source={got.svg} dark={dark} beat={beat} max={4 * 1024 * 1024} />;
}
