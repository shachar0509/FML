import { instance, type Viz } from "@viz-js/viz";
import * as vega from "vega";
import * as vl from "vega-lite";
import { BEAT_MARK, beatAttrs } from "@/core/render/figures/beats";

/** M80: Graphviz (@viz-js/viz, WebAssembly; Graphviz EPL) and Vega-Lite (BSD), drawn on the server. Both lay out the final state once; beats tag the output groups, so nothing moves. */

const unescape = (t: string) => t.replace(/&#45;/g, "-").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)));
const unquote = (id: string) => id.trim().replace(/^"(.*)"$/s, "$1");

/** The node and edge titles a marked DOT line declares (`a -> b -> c [..]` gives a->b and b->c). */
export function dotTitles(line: string): string[] {
  const out: string[] = [];
  for (const st of line.replace(/\[[^\]]*\]/g, "").split(";")) {
    const s = st.trim();
    if (!s || /^(graph|node|edge|subgraph|digraph|rankdir|rank|label|bgcolor|\{|\})\b/.test(s) || /^[\w-]+\s*=/.test(s)) continue;
    const op = s.includes("->") ? "->" : s.includes("--") ? "--" : null;
    if (!op) out.push(unquote(s));
    else {
      const ids = s.split(op).map(unquote);
      for (let i = 1; i < ids.length; i++) out.push(`${ids[i - 1]}${op}${ids[i]}`);
    }
  }
  return out;
}

let viz: Promise<Viz> | undefined;
export async function graphvizToSvg(source: string): Promise<string> {
  const beats = new Map<string, string>();
  const lines = source.replace(/\r/g, "").split("\n").map((line) => {
    const m = BEAT_MARK.exec(line);
    if (!m) return line;
    for (const t of dotTitles(line.slice(0, m.index))) beats.set(t, beatAttrs(m[1] ?? "0", m[2]));
    return line.slice(0, m.index);
  });
  // a sans font like the card's and a transparent page, unless the source sets its own
  const dot = lines.join("\n").replace(/\{/, '{ graph [fontname="Helvetica", bgcolor="transparent"]; node [fontname="Helvetica"]; edge [fontname="Helvetica"];\n');
  const r = (await (viz ??= instance())).render(dot, { format: "svg" });
  if (r.status !== "success") throw new Error(r.errors.map((e) => e.message).join(" ").trim() || "Graphviz could not draw it");
  let svg = r.output.slice(r.output.indexOf("<svg"));
  const missing = [...beats.keys()].filter((t) => !svg.includes(`<title>${t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/-/g, "&#45;")}</title>`) && !svg.includes(`<title>${t}</title>`));
  svg = svg.replace(/<g id="([^"]+)" class="(node|edge|cluster)">\s*<title>([^<]*)<\/title>/g, (m, id: string, cls: string, title: string) => {
    const b = beats.get(unescape(title));
    return b ? `<g id="${id}" class="${cls}" ${b}>\n<title>${title}</title>` : m;
  });
  if (missing.length && missing.length === beats.size) throw new Error(`The @n markers name no node or edge of the drawing (${missing.join(", ")}): put the marker on the node's or edge's own line`);
  return svg.replace(/<!--[\s\S]*?-->/g, "");
}

/** Vega-Lite: "beat"/"until" on a layer; ink colours become the board's (black), the page is transparent. */
export async function vegaLiteToSvg(source: string): Promise<string> {
  const spec = JSON.parse(source) as Record<string, unknown> & { layer?: Record<string, unknown>[] };
  const beats: string[] = [];
  for (const [i, layer] of (spec.layer ?? []).entries()) {
    const { beat, until } = layer as { beat?: number; until?: number };
    delete layer.beat;
    delete layer.until;
    if (beat || until) layer.name = `beat${i}`;
    beats[i] = beat || until ? beatAttrs(String(beat ?? 0), until ? String(until) : undefined) : "";
  }
  const ink = { labelColor: "#000", titleColor: "#000" };
  const config = { background: "transparent", font: "Helvetica", axis: { ...ink, domainColor: "#000", tickColor: "#000", gridColor: "#888", gridOpacity: 0.35 }, legend: ink, title: { color: "#000" }, header: ink, view: { stroke: null } };
  spec.config = { ...config, ...(spec.config as object | undefined), aria: false }; // no aria-label on plain paths (axe: aria-prohibited-attr); the slide text says what the chart shows
  let vgSpec: vega.Spec;
  try {
    vgSpec = vl.compile(spec as unknown as vl.TopLevelSpec).spec;
  } catch (e) {
    throw new Error(`Vega-Lite: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  const svg = await new vega.View(vega.parse(vgSpec), { renderer: "none" }).toSVG();
  // a layer named beatN is drawn as <g class="mark-… beatN_marks">
  return svg.replace(/<g class="([^"]*\bbeat(\d+)_marks[^"]*)"/g, (m, cls: string, i: string) => (beats[Number(i)] ? `<g class="${cls}" ${beats[Number(i)]}` : m));
}
