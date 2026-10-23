// @vitest-environment node
import { expect, it } from "vitest";
import { libraryParts, ownIds, renderFigure, themeColors, tikzDocument, withLibrary } from "./render";

const CIRCUIT = String.raw`\begin{circuitikz}
\draw (0,0) to[battery1, l=$V$] (0,3) -- (4,3); % @1
\draw[m-blue] (2,3) to[R, l=$R_1$] (2,0); % @2
\draw (4,3) to[R, l=$R_2$] (4,0) -- (0,0); % @2-3
\draw[fill=white] (6,3) circle (0.3) node {$\Omega$};
\end{circuitikz}`;

it("tikz: drawn by TeX, beats as groups, text as paths, theme colours, own ids", async () => {
  const t = Date.now();
  const svg = await renderFigure("tikz", CIRCUIT);
  expect(Date.now() - t).toBeLessThan(10_000);
  expect(svg).toMatch(/^<svg [^>]*fill="currentColor"/);
  expect(svg).toContain('<g data-beat="1">');
  expect(svg).toContain('<g data-beat="2">');
  expect(svg).toContain('<g data-beat="2" data-until="3">');
  expect(svg).not.toMatch(/<text\b/); // BaKoMa glyphs became paths: the card needs no TeX font
  expect(svg).not.toMatch(/(fill|stroke)="(#000|#000000|black)"/); // black is the board's ink
  expect(svg).toContain('class="m-blue"');
  expect(svg).toContain('class="fig-paper-fill"');
  expect((svg.match(/<g[\s>]/g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length); // balanced (dvi2html leaves groups open)
  expect(svg.length).toBeLessThan(200_000);
});

it("tikz: the document is built around the picture; errors say what to fix", async () => {
  const doc = tikzDocument(String.raw`\begin{tikzpicture}\chemfig{H-C}\end{tikzpicture}`);
  expect(doc).toMatch(/\\usepackage\{chemfig\}[\s\S]*\\usetikzlibrary\{arrows\.meta[\s\S]*\\begin\{document\}/);
  expect(() => tikzDocument(String.raw`\usepackage{hebrew}\begin{tikzpicture}\end{tikzpicture}`)).toThrow(/Package hebrew is not available/);
  expect(() => tikzDocument("\\draw (0,0) -- (1,1);")).toThrow(/Expected \\begin\{tikzpicture\}/);
  await expect(renderFigure("tikz", String.raw`\begin{tikzpicture}\foo\end{tikzpicture}`)).rejects.toThrow(/Undefined control sequence/);
  // the engine recovers for the next drawing
  expect(await renderFigure("tikz", String.raw`\begin{tikzpicture}\draw[->] (0,0) -- (1,1);\end{tikzpicture}`)).toMatch(/^<svg/);
});

it("theme colours and own ids", () => {
  expect(themeColors('<svg><path fill="#1f5fbe" stroke="#000"/><path class="x" fill="#fff"/></svg>')).toBe('<svg fill="currentColor"><path class="m-blue" fill="currentColor" stroke="currentColor"/><path class="x fig-paper-fill" fill="#fff"/></svg>');
  const a = ownIds('<svg><radialGradient id="pgfsh2"/><circle style="fill:url(#pgfsh2)"/><use href="#lib-x"/><path fill="url(#shade-blue)"/></svg>', "a");
  expect(a).toMatch(/id="(f\w+-)pgfsh2"[\s\S]*url\(#\1pgfsh2\)[\s\S]*href="#\1lib-x"/);
  expect(a).toContain("url(#shade-blue)");
  expect(ownIds('<g id="x"/>', "a")).not.toBe(ownIds('<g id="x"/>', "b"));
});

it("bio: each placement becomes the part in a nested svg (the card drops <use>), with the credit; unknown parts are listed", () => {
  expect(Object.keys(libraryParts())).toEqual(expect.arrayContaining(["nucleus", "mitochondrion", "leaf", "chloroplast", "cell-oval", "heart"]));
  const svg = withLibrary('<svg viewBox="0 0 100 100"><use href="#nucleus" x="0" y="0" width="50" height="50" data-beat="1"/><use href="#leaf" width="9" height="9"/></svg>');
  expect(svg).toMatch(/<g data-beat="1" data-part="nucleus"><svg x="0" y="0" width="50" height="50" viewBox="[^"]+" preserveAspectRatio="xMidYMid meet"/);
  expect(svg).not.toMatch(/<use\b|<symbol\b/);
  expect(svg).toContain('data-credit="Servier Medical Art (CC BY 3.0)"');
  expect(() => withLibrary('<svg viewBox="0 0 9 9"><use href="#nucleous"/></svg>')).toThrow(/Unknown library part nucleous; parts: .*nucleus/);
  expect(() => withLibrary('<svg viewBox="0 0 9 9"><circle r="2"/></svg>')).toThrow(/at least one library part/);
});

/** The guide's own example of a kind (after its "Example (…):" line). */
const example = async (kind: "graphviz" | "vegalite" | "tikz") => {
  const { GUIDES } = await import("@/core/claude/prompts/figureGuides");
  const g = GUIDES[kind].guide;
  const from = g.indexOf("\n", g.indexOf("Example ("));
  const next = g.indexOf("\nExample (", from);
  return g.slice(from + 1, next < 0 ? undefined : next);
};

it("graphviz: the guide's DFA lays out once; marked nodes and edges get their beats; theme colours", async () => {
  const svg = await renderFigure("graphviz", await example("graphviz"));
  expect(svg).toMatch(/^<svg/);
  expect(svg).toMatch(/class="edge" data-beat="1">\s*<title>q0&#45;&gt;q1<\/title>/);
  expect(svg).toMatch(/class="node" data-beat="2">\s*<title>q2<\/title>/);
  expect((svg.match(/data-beat="3"/g) ?? []).length).toBe(4);
  expect(svg).toMatch(/class="m-green"/);
  expect(svg).not.toMatch(/(fill|stroke)="black"/);
  await expect(renderFigure("graphviz", "digraph { a -> }")).rejects.toThrow(/syntax error/i);
});

it("vegalite: layers keep their beats; ink follows the board", async () => {
  const svg = await renderFigure("vegalite", await example("vegalite"));
  expect(svg).toMatch(/<g class="mark-line role-mark beat1_marks" data-beat="2"/);
  expect(svg).toContain("m-blue");
  expect(svg).toContain("m-orange");
  expect(svg).not.toMatch(/(fill|stroke)="#000"/);
  await expect(renderFigure("vegalite", '{"mark":"bar","encoding":{"x":{"field":"a","type":"bogus"}}}')).rejects.toThrow(/Vega-Lite|Invalid|type/);
});

it("tikz: the guide's examples render", async () => {
  const { GUIDES } = await import("@/core/claude/prompts/figureGuides");
  const g = GUIDES.tikz.guide;
  for (const m of g.matchAll(/\n(\\begin\{(circuitikz|tikzpicture)\}[\s\S]*?\\end\{\2\})/g)) expect(await renderFigure("tikz", m[1] ?? "")).toMatch(/data-beat/);
});
