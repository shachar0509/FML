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
  expect(themeColors('<svg><path fill="#1f5fbe" stroke="#000"/><path fill="#fff"/></svg>')).toBe('<svg fill="currentColor"><path fill="currentColor" class="m-blue" stroke="currentColor"/><path fill="#fff" class="fig-paper-fill"/></svg>');
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
