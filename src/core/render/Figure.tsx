import { Component, lazy, Suspense, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDark } from "./useDark";
import { Remote } from "./figures/Remote";

const F = {
  mermaid: lazy(() => import("./figures/Mermaid").then((m) => ({ default: m.Mermaid }))),
  plot: lazy(() => import("./figures/Plot").then((m) => ({ default: m.Plot }))),
  geometry: lazy(() => import("./figures/Geometry").then((m) => ({ default: m.Geometry }))),
  wavedrom: lazy(() => import("./figures/Wavedrom").then((m) => ({ default: m.Wavedrom }))),
  svg: lazy(() => import("./figures/Svg").then((m) => ({ default: m.Svg }))),
  abc: lazy(() => import("./figures/Abc").then((m) => ({ default: m.Abc }))),
  chords: lazy(() => import("./figures/Chords").then((m) => ({ default: m.Chords }))),
  smiles: lazy(() => import("./figures/Smiles").then((m) => ({ default: m.Smiles }))),
};
/** M79: kinds drawn on the server (src/server/figures/render.ts SERVER_KINDS) */
const REMOTE = new Set(["tikz", "bio", "graphviz", "vegalite", "map", "image", "pikchr", "bytefield", "score", "chess", "go", "tree", "sky"]);
export const FIGURE_TAGS = Object.keys(F);
export const isFigureTag = (lang: string): lang is keyof typeof F => Object.hasOwn(F, lang);
export { setFigureRenderer } from "./figures/Remote";

function Fallback({ source }: { source: string }) {
  const { t } = useTranslation();
  return (
    <div className="my-3 rounded-lg border border-border p-3 text-sm text-muted" role="alert">
      {t("render.figureFailed")}
      <details className="mt-1">
        <summary className="cursor-pointer">{t("render.showSource")}</summary>
        <pre dir="ltr" className="mt-1 overflow-x-auto text-xs">{source}</pre>
      </details>
    </div>
  );
}

/** A figure that throws (parse or render) must never take the message down. */
class Boundary extends Component<{ source: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidUpdate(prev: { source: string }) {
    if (prev.source !== this.props.source && this.state.failed) this.setState({ failed: false });
  }
  render() {
    return this.state.failed ? <Fallback source={this.props.source} /> : this.props.children;
  }
}

/** `beat` (M78): the slide's current beat; parts tagged with a later beat stay hidden. Undefined shows every part. */
export function Figure({ tag, source, beat }: { tag: string; source: string; beat?: number }) {
  const dark = useDark();
  const C = F[tag as keyof typeof F];
  return (
    <Boundary source={source}>
      <Suspense fallback={<div className="my-3 h-24 animate-pulse rounded-lg bg-card" />}>
        {REMOTE.has(tag) ? <Remote kind={tag} source={source} dark={dark} beat={beat} /> : C ? <C source={source} dark={dark} beat={beat} /> : <Fallback source={source} />}
      </Suspense>
    </Boundary>
  );
}
