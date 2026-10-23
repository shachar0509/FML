import { useEffect, useRef } from "react";
import { BEAT_MARK } from "./beats";
import { showBeat } from "./Svg";
import { boxClass, useDraw } from "./useDraw";

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

const LINK = /<?(?:-{2,}|={2,}|-\.+-)[->ox]?|~~~/g;
const ID = /(?:^|[\s&;]|-->|---|==>|-\.->|\|)\s*([\p{L}\w]+)(?=\s*(?:[[({>]|-|=|&|;|$|:::|\s))/gu;

/** M80: `%% @n` / `%% @n-m` at a line's end: the nodes the line names first and its edges (by their order in the source) appear at beat n. */
export function mermaidBeats(source: string) {
  const nodes = new Map<string, [string, string?]>();
  const edges: ([string, string?] | null)[] = [];
  const seen = new Set<string>();
  const lines = source.replace(/\r/g, "").split("\n").map((line) => {
    const m = BEAT_MARK.exec(line);
    const body = m ? line.slice(0, m.index) : line;
    if (/^\s*(%%|classDef|class |style |linkStyle|flowchart|graph|stateDiagram|direction|subgraph|end\b)/.test(body)) return body;
    const b: [string, string?] | null = m ? [m[1] ?? "0", m[2]] : null;
    const code = body.replace(/"[^"]*"/g, "").replace(/\|[^|]*\|/g, "|").replace(/:\s.*$/, "").replace(/(["[({])[^"\])}]*["\])}]+/g, "$1");
    for (let k = (code.match(LINK) ?? []).length; k > 0; k--) edges.push(b);
    // a node appears with the first line that names it (an unmarked line: from the start)
    for (const [, n] of code.matchAll(ID)) {
      if (!n || seen.has(n) || /^(end|subgraph|state|as|note)$/.test(n)) continue;
      seen.add(n);
      if (b) nodes.set(n, b);
    }
    return body;
  });
  return { source: lines.join("\n"), nodes, edges };
}

export function Mermaid({ source, dark, beat }: { source: string; dark: boolean; beat?: number }) {
  const at = useRef(beat);
  const ref = useDraw(
    async (el) => {
      const { default: mermaid } = await import("mermaid");
      const marked = mermaidBeats(source);
      // mermaid.initialize is global and render is not reentrant: serialise.
      const job = queue.then(async () => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          theme: dark ? "dark" : "default",
        });
        return mermaid.render(`mermaid-${++seq}`, marked.source);
      });
      queue = job.catch(() => undefined);
      const { svg } = await job;
      el.innerHTML = svg;
      const s = el.querySelector("svg");
      if (s) s.style.maxWidth = "100%";
      const tag = (e: Element, [b, u]: [string, string?]) => {
        e.setAttribute("data-beat", b);
        if (u) e.setAttribute("data-until", u);
      };
      for (const g of el.querySelectorAll("g.node[id]")) {
        const id = /-(?:flowchart|state)-(.+)-\d+$/.exec(g.id)?.[1];
        const b = id && marked.nodes.get(id);
        if (b) tag(g, b);
      }
      [...el.querySelectorAll("path.flowchart-link, path.transition")].forEach((p, i) => {
        const b = marked.edges[i];
        if (!b) return;
        tag(p, b);
        const lid = p.id.replace(/^mermaid-\d+-/, "");
        for (const l of el.querySelectorAll(`[data-id="${CSS.escape(lid)}"]`)) tag(l.closest("g.edgeLabel") ?? l, b);
      });
      showBeat(el, at.current);
    },
    [source, dark],
  );
  useEffect(() => {
    at.current = beat;
    if (ref.current) showBeat(ref.current, beat);
  }, [ref, beat]);
  return <div ref={ref} className={`${boxClass} fig-svg fig-mermaid`} dir="ltr" />;
}
