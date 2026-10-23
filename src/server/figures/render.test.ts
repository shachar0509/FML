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
const example = async (kind: "graphviz" | "vegalite" | "tikz" | "map" | "image" | "pikchr" | "bytefield" | "score" | "chess" | "go" | "tree" | "sky") => {
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

it("map: the guide's example draws countries, points and a route with their beats; unknown names are listed", async () => {
  const svg = await renderFigure("map", await example("map"));
  expect(svg).toMatch(/^<svg[^>]*viewBox="0 0 800 520"/);
  expect(svg).toMatch(/<g class="m-orange" data-beat="1">/);
  expect(svg).toMatch(/<g class="m-blue" data-beat="3">.*stroke-dasharray/);
  expect(svg).toContain("הר סיני");
  expect(svg.length).toBeLessThan(4 * 1024 * 1024);
  await expect(renderFigure("map", '{"layers":[{"countries":["Isreal"]}]}')).rejects.toThrow(/Unknown country "Isreal".*Israel/);
});

it("image: a page of a course file with marks by beat; the crop is the viewBox; errors name the files", async () => {
  const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const d = await mkdtemp(join(tmpdir(), "shalav-"));
  Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
  const { initNode } = await import("../platform");
  const { coursePaths } = await import("@/core/lib/fs/paths");
  const { writeFileIndex } = await import("@/core/domain/ingest/indexStore");
  const { createCanvas } = await import("@napi-rs/canvas");
  const { dataRoot } = await initNode();
  const c = createCanvas(400, 600);
  c.getContext("2d").fillRect(100, 100, 200, 200);
  const dir = coursePaths(dataRoot, "999").materials;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "cell.png"), c.toBuffer("image/png"));
  const now = new Date().toISOString();
  await writeFileIndex("999", { schema: 1, sha256: "f".repeat(64), fileName: "cell.png", relPath: `${dir.slice(coursePaths(dataRoot, "999").course.length + 1)}/cell.png`, role: "material", mediaType: "image/png", pageCount: 1, addedAt: now, status: "indexed", error: null, indexedAt: now, indexModel: null, planVersion: null, materialPages: [], exercises: [] });
  const src = { ...JSON.parse(await example("image")), course: "999", file: "cell.png", page: 1 };
  const svg = await renderFigure("image", JSON.stringify(src));
  // [0.1,0.3,0.9,0.75] of 400 × 600, within the crop's pixel rounding
  const vb = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(" ").map(Number);
  [40, 180, 320, 270].forEach((v, k) => expect(vb[k]).toBeCloseTo(v, -0.5));
  expect(svg).toMatch(/<image href="data:image\/png;base64,[^"]+" x="3[12]\.\d+" y="168\.\d+" width="336" height="29\d"\/>/); // the crop at full resolution, padded as PageSource.crop pads it
  expect(svg).toMatch(/<g class="m-blue" data-beat="1">.*<circle.*גרעין/);
  expect(svg).toMatch(/<g class="m-green" data-beat="2">/);
  expect(svg).toContain('class="fig-paper-fill"');
  await expect(renderFigure("image", JSON.stringify({ ...src, file: "nope.pdf" }))).rejects.toThrow(/No course file "nope.pdf"; files: cell.png/);
  await expect(renderFigure("image", JSON.stringify({ ...src, marks: [{ type: "label", at: [0.5, 0.5], text: "a" }, { type: "arrow", from: [0.95, 0.5], to: [0.5, 0.5] }] }))).rejects.toThrow(/Mark 2 \(arrow\) reaches \[0.95, 0.5\], outside the crop/);
  const { gridImage } = await import("./image");
  expect((await gridImage("999", "cell.png", 1)).length).toBeGreaterThan(1000);
});

it("pikchr: one layout; a marked line's elements get its beat and colour; errors come back", async () => {
  const svg = await renderFigure("pikchr", await example("pikchr"));
  expect(svg).toMatch(/data-beat="1" class="m-blue"/);
  expect((svg.match(/data-beat="2"/g) ?? []).length).toBeGreaterThanOrEqual(3); // the arrow (line + head) and the Parser box and its text
  expect(svg).toContain("fill-opacity:0.22");
  expect(svg).not.toMatch(/rgb\(0,0,0\)|rgb\(1,\d+,7\)/);
  await expect(renderFigure("pikchr", "box \"A\" frobnicate")).rejects.toThrow(/frobnicate|syntax/i);
});

it("bytefield and score (Verovio) draw their examples in the board's ink; Verovio's glyphs are inlined", async () => {
  expect(await renderFigure("bytefield", await example("bytefield"))).toMatch(/^<svg[^>]*fill="currentColor"[\s\S]*Total Length/);
  const score = await renderFigure("score", await example("score"));
  expect(score).toMatch(/^<svg[^>]*viewBox="0 0 /);
  expect(score).not.toMatch(/<use\b|<defs>/);
  expect((score.match(/class="staff"/g) ?? []).length).toBe(4); // 2 bars × 2 staves
  await expect(renderFigure("score", "not music")).rejects.toThrow(/Verovio/);
});

it("chess: moves by beat (captures, castling), arrows; bad moves are named", async () => {
  const svg = await renderFigure("chess", await example("chess"));
  expect((svg.match(/<svg x=/g) ?? []).length).toBe(32 + 3); // 32 pieces, each moved piece has a second stay
  expect(svg).toMatch(/data-beat="0" data-until="0"[^>]*>.*?<\/svg>/); // the bishop leaves f1 at beat 1
  expect(svg).toMatch(/class="m-pink" opacity="0.85" data-beat="3"/);
  const castle = await renderFigure("chess", '{"fen":"4k3/8/8/8/8/8/8/4K2R","moves":[{"move":"e1g1"}]}');
  expect((castle.match(/data-beat="1"/g) ?? []).length).toBe(2 + 2); // king and rook arrive; the move's two squares are tinted
  await expect(renderFigure("chess", '{"moves":[{"move":"e3e4"}]}')).rejects.toThrow(/no piece on e3/);
});

it("go: a stone without liberties leaves at the capturing move; region crops the board", async () => {
  const svg = await renderFigure("go", await example("go"));
  expect(svg).toMatch(/<g data-beat="0" data-until="1"><circle[^>]*url\(#[^)]*w\)/); // the white stone on ab, captured at beat 2
  expect(svg).toMatch(/viewBox="16 16 /);
  await expect(renderFigure("go", '{"size":9,"black":["jj"]}')).rejects.toThrow(/off a 9×9 board/);
});

it("tree: brackets become a Graphviz tree; Label@n shows the subtree from beat n", async () => {
  const svg = await renderFigure("tree", await example("tree"));
  expect((svg.match(/class="node" data-beat="2"/g) ?? []).length).toBe(3); // VP, V, sat
  expect((svg.match(/class="node" data-beat="3"/g) ?? []).length).toBe(8); // PP and its subtree
  expect(svg).toContain("m-blue");
  await expect(renderFigure("tree", "[S [NP")).rejects.toThrow(/not closed/);
});

it("sky: stars, constellation lines and Hebrew names; layers by beat; unknown names are explained", async () => {
  const svg = await renderFigure("sky", await example("sky"));
  expect(svg).toMatch(/data-own-bg/);
  expect(svg).toMatch(/<g data-beat="2">.*ביטלג'וז/); // the star's Hebrew name by default
  expect(svg).toContain("אוריון");
  await expect(renderFigure("sky", '{"layers":[{"constellation":"Orionis"}]}')).rejects.toThrow(/Unknown constellation/);
  await expect(renderFigure("sky", '{"layers":[{"star":"Krypton"}]}')).rejects.toThrow(/Unknown star/);
});
