import { BEAT_MARK, beatAttrs, MARK, markColors } from "@/core/render/figures/beats";
import { graphvizToSvg } from "./graphs";

/** M82: Pikchr (diagrams in words), bytefield (packet and register layouts), Verovio (engraved scores) and bracket syntax trees, on the server. */

let pik: Promise<typeof import("pikchr-wasm").default> | undefined;
const loadPikchr = () =>
  (pik ??= import("pikchr-wasm").then(async (m) => {
    await m.default.loadWASM();
    return m.default;
  }));

const hex = (n: keyof typeof MARK) => `0x${MARK[n]}`;
const rgbOf = (h: string) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");

/**
 * Pikchr: a marked line gets a colour of its own (rgb(1,k,7)), so each SVG element it draws can be found after a single layout
 * and tagged with its beat; the colour then becomes the board's ink (or the line's m-colour). Fills turn translucent so text on them
 * reads on both boards.
 */
export async function pikchrToSvg(source: string): Promise<string> {
  const pikchr = await loadPikchr();
  const marks: { attrs: string; cls: string }[] = [];
  const lines = source.replace(/\r/g, "").split("\n").map((line) => {
    const m = BEAT_MARK.exec(line);
    let body = (m ? line.slice(0, m.index) : line).replace(/\bfill\s+"?m-(blue|green|pink|orange)"?/g, (_, n: keyof typeof MARK) => `fill ${hex(n)}`);
    if (!m) return body.replace(/\bcolor\s+"?m-(blue|green|pink|orange)"?/g, (_, n: keyof typeof MARK) => `color ${hex(n)}`);
    let cls = "";
    body = body.replace(/\bcolor\s+"?m-(blue|green|pink|orange)"?/g, (_, n: string) => ((cls = `m-${n}`), ""));
    const k = marks.push({ attrs: beatAttrs(m[1] ?? "0", m[2]), cls });
    if (k > 250) throw new Error("too many marked lines (250 at most)");
    return `${body.replace(/;\s*$/, "")} color 0x01${k.toString(16).padStart(2, "0")}07`;
  });
  const out = pikchr.render(lines.join("\n"));
  if (!/^<svg/.test(out.trim())) throw new Error(out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 400) || "Pikchr could not draw it");
  const mark = new Map(Object.entries(MARK).map(([n, h]) => [rgbOf(h), `m-${n}`]));
  return out
    .replace(/<(path|polygon|text|circle|ellipse|polyline)\b[^>]*>/g, (tag, name: string) => {
      const add: string[] = [];
      let extra = "";
      let t = tag.replace(/rgb\((\d+),(\d+),(\d+)\)/g, (_, r: string, g: string, b: string) => {
        const c = `${r},${g},${b}`;
        if (r === "1" && b === "7") {
          const mk = marks[Number(g) - 1];
          if (mk) {
            extra = ` ${mk.attrs}`;
            if (mk.cls) add.push(mk.cls);
          }
          return "currentColor";
        }
        if (c === "0,0,0") return "currentColor";
        if (c === "255,255,255") return "var(--card)";
        const m = mark.get(c);
        if (m) add.push(m);
        return m ? "currentColor" : `rgb(${c})`;
      });
      // a filled shape (not an arrowhead): translucent, so text on it reads on the light and the dark board
      if (name === "path" && /fill:(?!none)/.test(t)) t = t.replace(/style="/, 'style="fill-opacity:0.22;');
      if (add.length) t = t.replace(/^<\w+/, (n) => `${n} class="${[...new Set(add)].join(" ")}"`);
      return extra ? t.replace(/^<\w+/, (n) => `${n}${extra}`) : t;
    })
    .replace(/<svg\b/, '<svg fill="currentColor"');
}

/** bytefield-svg (EPL-2.0): its own Clojure-like DSL; shown whole. Text in the board's ink, fills translucent. */
export async function bytefieldToSvg(source: string): Promise<string> {
  const bytefield = (await import("bytefield-svg")).default;
  let svg: string;
  try {
    svg = bytefield(source);
  } catch (e) {
    throw new Error(`bytefield: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
  }
  return svg
    .slice(svg.indexOf("<svg"))
    .replace(/\s(width|height)="[\d.]+"(?=[^<]*viewBox)/g, "")
    .replace(/<svg\b/, '<svg fill="currentColor" stroke="currentColor"')
    .replace(/(<text\b[^>]*?)>/g, '$1 stroke="none">')
    .replace(/fill="#(?!000\b|000000\b)([0-9a-fA-F]{3,6})"/g, 'fill="#$1" fill-opacity="0.35"');
}

let vero: Promise<{ tk: import("verovio/esm").VerovioToolkit }> | undefined;
/** Verovio (LGPL-3.0): ABC (one voice) or MusicXML / MEI (several staves) engraved as a score; shown whole (abc is the kind with beats). Glyphs are inlined (the card drops <use>). */
export async function scoreToSvg(source: string): Promise<string> {
  const { tk } = await (vero ??= (async () => {
    const [{ default: wasm }, { VerovioToolkit, enableLog, LOG_OFF }] = await Promise.all([import("verovio/wasm"), import("verovio/esm")]);
    const mod = await wasm();
    enableLog(LOG_OFF, mod); // its warnings ("Title field missing") would only fill the server log
    return { tk: new VerovioToolkit(mod) };
  })());
  tk.setOptions({ adjustPageHeight: true, adjustPageWidth: true, pageWidth: 1400, pageMarginLeft: 20, pageMarginRight: 20, pageMarginTop: 20, pageMarginBottom: 20, scale: 70, footer: "none", header: "none", breaks: "auto" });
  if (!tk.loadData(source)) throw new Error("Verovio could not read the score (ABC with X: and K:, MusicXML, MEI or Humdrum)");
  const svg = tk.renderToSVG(1);
  const glyphs = new Map([...svg.matchAll(/<g id="([^"]+)">\s*(<path[^>]*\/>)\s*<\/g>/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));
  return svg
    .replace(/<desc>[\s\S]*?<\/desc>/, "")
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    .replace(/<use xlink:href="#([^"]+)"([^>]*?)\/>/g, (m, id: string, rest: string) => (glyphs.has(id) ? `<g${rest}>${glyphs.get(id)}</g>` : m))
    .replace(/<svg width="([\d.]+)px" height="([\d.]+)px"/, '<svg viewBox="0 0 $1 $2"')
    .replace(/<svg\b/, '<svg fill="currentColor" stroke="currentColor"');
}

/**
 * Syntax trees from brackets ([S [NP [D the] [N cat]] [VP@2 [V sat]]]); `@n` / `@n-m` after a label shows that subtree from beat n.
 * Laid out by Graphviz (ordering=out keeps the word order), so the beats are its node and edge markers.
 */
export function treeToDot(source: string): string {
  const tokens = source.match(/\[|\]|"[^"]*"|[^\s[\]]+/g) ?? [];
  let i = 0;
  let n = 0;
  const out: string[] = [];
  const label = (t: string) => t.replace(/^"|"$/g, "");
  const node = (beat?: string): string => {
    if (tokens[i] !== "[") throw new Error(`expected "[" at token ${i + 1}`);
    i++;
    const raw = tokens[i++] ?? "";
    const m = /^(.*?)@(\d+(?:-\d+)?)$/.exec(raw);
    const own = m ? m[2] : beat;
    const id = `n${n++}`;
    const mark = (b?: string) => (b ? ` // @${b}` : "");
    out.push(`${id} [label=${JSON.stringify(label(m ? (m[1] ?? "") : raw))}];${mark(own)}`);
    while (i < tokens.length && tokens[i] !== "]") {
      const child = tokens[i] === "[" ? node(own) : (() => {
        const w = tokens[i++] ?? "";
        const leaf = `n${n++}`;
        out.push(`${leaf} [label=${JSON.stringify(label(w))}, fontcolor="m-blue", shape=plaintext];${mark(own)}`);
        return leaf;
      })();
      out.push(`${id} -> ${child};${mark(own)}`);
    }
    if (tokens[i] !== "]") throw new Error('a "[" is not closed');
    i++;
    return id;
  };
  node();
  if (i < tokens.length) throw new Error(`text after the tree: ${tokens.slice(i).join(" ")}`);
  return `digraph { ordering=out; node [shape=plaintext, fontsize=16]; edge [arrowhead=none];\n${out.join("\n")}\n}`;
}
export const treeToSvg = (source: string) => graphvizToSvg(markColors(treeToDot(source)));
