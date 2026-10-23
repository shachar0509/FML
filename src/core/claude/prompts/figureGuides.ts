import { FIGURE_FORMATS } from "./figures";

/**
 * M79: the figure kinds of teach_step / show_figure. The lesson prompt carries only CATALOGUE (one line per kind); the conventions
 * and an example of a kind come from the figure_guide tool when Claude first uses it, so a lesson pays only for the kinds it draws.
 */
const fmt = (tag: string) => FIGURE_FORMATS.split("\n").find((l) => l.startsWith(`- \`\`\`${tag} `))?.replace(/^- ```\w+\s+/, "") ?? "";

export const GUIDES = {
  plot: {
    line: "graphs of functions, data points, vectors (function-plot JSON)",
    guide: `plot: ${fmt("plot")}
Beats: "beat": n and "until": m on data and annotations items (each beat redraws the plot; prefer geometry for a graph that builds up).`,
  },
  geometry: {
    line: "function investigations, vectors, forces, Euclidean geometry, the complex plane (JSXGraph JSON)",
    guide: `geometry: ${fmt("geometry")}
Beats: "beat": n, "until": m and "color": "blue|green|pink|orange" on any element. A part cannot appear before the points it uses.
Example, f(x)=x^2-2x+1 with "axis": true: beats 1-2 compute f'(x)=2x-2=0 → x=1 (text only); beat 3 f(1)=0: the point V (1,0) with label "(1,0)" and "color":"blue"; beat 4 f''(x)=2>0; beat 5 opens upward: the curve x^2-2x+1; beat 6 f(0)=1: the point P (0,1); beat 7 symmetry: the point Q (2,1) and a dashed segment P–Q.`,
  },
  tikz: {
    line: "circuits (circuitikz), mechanics and forces, optics, physics diagrams, pgfplots, 3D sketches (tikz-3dplot), chemical structures (chemfig), commutative diagrams (tikz-cd): drawn in real LaTeX",
    guide: `tikz: the source is \\begin{tikzpicture} … \\end{tikzpicture} (or \\begin{circuitikz} … \\end{circuitikz}, or \\chemfig{…}), optionally after \\usepackage{circuitikz|chemfig|pgfplots|tikz-3dplot|tikz-cd|amsmath|amssymb} and \\usetikzlibrary{…} lines. No \\documentclass or \\begin{document} (added for you). Shalav renders it on its server with a real TeX engine, so standard TikZ works: arrows.meta, calc, angles, quotes, decorations, patterns, shadings (ball color, shading=axis) look professional.
Beats: end a statement's line with % @n (shown from beat n) or % @n-m (from n until m). One statement per marked line; the layout never moves when a part appears.
Colours: the colours m-blue, m-green, m-pink, m-orange follow the card's light/dark theme (\\draw[m-blue] …, \\node[m-pink] …); use them for the parts the text colours with \\blue{…} etc. Plain black (the default) becomes the board's ink, white fills become the board's paper (the board is dark in dark mode). Avoid other fixed colours for lines and text. Lettering on a filled shape keeps a fixed colour: text=m-black on a light fill, text=m-white on a dark one. A background area: fill=gray, fill opacity=0.25 (works on both boards). Depth: \\shade[ball color=…] for spheres and atoms, top color/bottom color for blocks.
Labels: math and Latin only ($R_1$, $I_2$, $F_g$, $\\theta$, CO$_2$); no Hebrew inside TikZ (the TeX engine has no Hebrew font): put Hebrew words in the slide text and colour-link them.
Example (a parallel circuit in 4 beats):
\\begin{circuitikz}
\\draw (0,0) to[battery1, l=$V$] (0,3) -- (5,3); % @1
\\draw[m-blue] (2.5,3) to[R, l=$R_1$, i>^=$I_1$] (2.5,0); % @2
\\draw[m-green] (5,3) to[R, l=$R_2$, i>^=$I_2$] (5,0); % @3
\\draw (5,0) -- (0,0); % @1
\\draw[m-orange, ->, thick] (0.3,3.4) -- (2,3.4) node[midway, above] {$I = I_1 + I_2$}; % @4
\\end{circuitikz}
Example (forces on an inclined plane, a force per beat):
\\begin{tikzpicture}[scale=1.4]
\\fill[gray, fill opacity=0.25] (0,0) -- (6,0) -- (6,3.46) -- cycle; \\draw (0,0) -- (6,0) -- (6,3.46) -- cycle;
\\draw (1.2,0) arc (0:30:1.2) node[midway, right] {$\\theta$};
\\begin{scope}[rotate around={30:(0,0)}]
\\shade[top color=orange!60, bottom color=orange!90!black, draw=black] (3.2,0) rectangle (4.4,0.8);
\\draw[m-blue, -{Stealth}, very thick] (3.8,0.4) -- ++(-120:1.9) node[below left] {$mg$}; % @2
\\draw[m-green, -{Stealth}, very thick] (3.8,0.8) -- ++(0,1.5) node[above] {$N$}; % @3
\\end{scope}
\\end{tikzpicture}`,
  },
  bio: {
    line: "realistic biology and anatomy: cells, organelles, membranes, DNA, microbes, organs, plants (library illustrations placed in an SVG)",
    guide: `bio: one <svg viewBox="0 0 W H"> that places realistic library illustrations with <use href="#name" x y width height/> (each keeps its proportions inside the box), plus your own arrows, molecules and labels in plain SVG.
Parts: {PARTS}.
Beats: data-beat="n" / data-until="m" / data-focus="n" on a <use> or a <g> (as in svg). Colours: class="m-blue|m-green|m-pink|m-orange" on your own strokes and text (stroke/fill="currentColor"); the library parts keep their natural colours, so link a word to a part by a coloured outline or arrow (class="m-blue" on an ellipse around it) and \\blue{word} in the text. Effects: class="shadow" (soft drop shadow, depth), class="glow" (highlight), class="flow" / "drift" (style="--dx:60;--dy:0") / "pulse" as in svg; fills fill="url(#shade-blue|shade-green|shade-pink|shade-orange|shade-gray)" give your own shapes a shaded, 3D look.
Labels: short, one language each, font-size about 4% of the width; centre Hebrew labels with text-anchor="middle"; molecules as text (CO₂, O₂, H₂O, C₆H₁₂O₆).
Example (photosynthesis): <svg viewBox="0 0 800 480"><use href="#leaf" x="160" y="90" width="480" height="290"/><use href="#chloroplast" x="330" y="190" width="150" height="80" class="shadow" data-beat="2"/><use href="#sun" x="20" y="10" width="120" height="120" data-beat="1"/><g class="m-blue" data-beat="3" data-until="5"><text x="110" y="300" fill="currentColor" font-size="30">CO₂</text><path class="flow" d="M180 290 L330 240" stroke="currentColor" stroke-width="4"/></g> … <g class="m-green drift" style="--dx:120;--dy:0" data-beat="6"><text x="560" y="250" fill="currentColor" font-size="30">O₂</text></g></svg>`,
  },
  graphviz: {
    line: "graphs, automata (DFA/NFA), trees, data structures, state machines, ER diagrams, dependency graphs (Graphviz DOT, automatic layout)",
    guide: `graphviz: Graphviz DOT source (digraph { … } or graph { … }); Shalav lays it out on its server. rankdir=LR for automata; shape=circle / doublecircle (accepting states), an invisible start node (start [shape=point]) with an arrow into the start state; shape=record or shape=plain with HTML-like labels for data structures; nodes in a tree in order.
Beats: end a node's or an edge's own line with // @n (from beat n) or // @n-m (until beat m): "q1 -> q2 [label="b"]; // @2". A chain a -> b -> c on a marked line marks both edges. A node shows from the start unless its own line is marked. The layout is computed for the final graph, so nothing moves when a part appears.
Colours: color="m-blue", fontcolor="m-blue", fillcolor="m-green" (with style=filled) follow the card's theme; black (the default) is the board's ink. Labels: short; Hebrew works in labels ("גרעין") but keep them a word or two.
Example (a DFA for strings ending in ab, 3 beats):
digraph { rankdir=LR; node [shape=circle];
start [shape=point]; start -> q0;
q0 -> q1 [label="a"]; // @1
q1 -> q2 [label="b"]; // @2
q2 [shape=doublecircle, color="m-green"]; // @2
q0 -> q0 [label="b"]; q1 -> q1 [label="a"]; // @3
q2 -> q1 [label="a"]; q2 -> q0 [label="b"]; // @3
}`,
  },
  mermaid: {
    line: "flowcharts, algorithms, sequence diagrams, state diagrams, mind maps, timelines, Gantt charts, class diagrams (Mermaid; Hebrew labels work)",
    guide: `mermaid: Mermaid source (flowchart TD|LR, sequenceDiagram, stateDiagram-v2, classDiagram, mindmap, timeline, gantt, journey, pie, quadrantChart). Drawn in the card with the board's theme. Hebrew labels work: A[קלט] --> B{"האם x>0?"}. Quote a label with special characters: A["f(x) = x²"].
Beats (flowchart and stateDiagram-v2): end a line with %% @n (from beat n) or %% @n-m; that line's edges and the nodes it names first appear at beat n. Name each node first on the line that should bring it in. Other diagram types show whole.
Colours: class A,B m-blue (also m-green, m-pink, m-orange) outlines nodes in the theme colour that the text links with \\blue{…}. No style/classDef colours: they don't follow the dark board.
Example (an algorithm in 4 beats):
flowchart TD
  S([התחלה]) --> R[/קלוט n/]
  R --> C{"n > 1?"} %% @2
  C -->|כן| D[n ← n/2] %% @3
  D --> C %% @3
  C -->|לא| E([סוף]) %% @4
  class C m-blue`,
  },
  vegalite: {
    line: "statistics, data charts, distributions, regression, economics and finance charts (Vega-Lite JSON)",
    guide: `vegalite: a Vega-Lite JSON spec (data inline in "data": {"values": [...]}; no URLs), drawn on Shalav's server. Use "layer": [...] to build a chart up: each layer may carry "beat": n and "until": m (scales are computed from every layer, so axes never move). Width and height about 520 × 320.
Colours: "color": "m-blue" (also m-green, m-pink, m-orange) in a mark or in a scale range follows the card's theme; axes and labels are drawn in the board's ink. Axis titles: short; Hebrew works.
Example (a scatter, then its regression line, then the residual of one point):
{"width":520,"height":320,"data":{"values":[{"x":1,"y":2.1},{"x":2,"y":3.9},{"x":3,"y":6.2},{"x":4,"y":7.8},{"x":5,"y":10.1}]},
"layer":[{"mark":{"type":"point","filled":true,"size":80,"color":"m-blue"},"encoding":{"x":{"field":"x","type":"quantitative"},"y":{"field":"y","type":"quantitative"}}},
{"beat":2,"mark":{"type":"line","color":"m-orange"},"transform":[{"regression":"y","on":"x"}],"encoding":{"x":{"field":"x","type":"quantitative"},"y":{"field":"y","type":"quantitative"}}}]}`,
  },
  image: {
    line: "a region of a page from the student's own course files (a painting, a micrograph, a historical map, a machine, a lecture diagram) with arrows, circles and labels",
    guide: `image: JSON {"file", "page", "crop": [x0, y0, x1, y1], "marks": [...]}. First call course_page({file, page}) to see the page: it comes with a grid of page fractions (x from the left, y from the top). Pages that consult_materials lists "has a figure" are the likely ones. The crop and every mark use those page fractions (not fractions of the crop); crop tight around the picture, leave out page text.
Marks: {"type":"arrow","from":[x,y],"to":[x,y],"text":"…"} (the text sits at the tail), {"type":"circle","at":[x,y],"r":0.05,"text":"…"} (r as a fraction of the page width), {"type":"box","box":[x0,y0,x1,y1],"text":"…"}, {"type":"label","at":[x,y],"text":"…"}. Each takes "color": "m-blue|m-green|m-pink|m-orange" (default m-pink; the same colour as the \\blue{…} word in the text), "beat": n and "until": m. Labels: a word or two (Hebrew works); a label sits on a paper-coloured pill, so it reads on any photo.
Example (a cell micrograph on page 4, the nucleus at beat 1, a mitochondrion at beat 2):
{"file":"lecture3.pdf","page":4,"crop":[0.1,0.3,0.9,0.75],"marks":[{"type":"circle","at":[0.42,0.5],"r":0.07,"text":"גרעין","color":"m-blue","beat":1},{"type":"arrow","from":[0.75,0.68],"to":[0.62,0.56],"text":"מיטוכונדריה","color":"m-green","beat":2}]}`,
  },
  map: {
    line: "geographic maps: countries, regions, routes, cities, battles, trade and migration (Natural Earth, d3-geo)",
    guide: `map: JSON {"projection", "region": [[west, south], [east, north]], "width": 800, "height": 520, "layers": [...]}, drawn on Shalav's server from Natural Earth borders (today's borders; for a historical map shade today's countries or draw routes and labels). projection: "mercator" (default, regions), "equalEarth" or "naturalEarth" (the world), "orthographic" (a globe centred on the region), "conic" (a mid-latitude country or continent). Coordinates are [longitude, latitude] in degrees (east and north positive).
Layers, in drawing order: {"countries": ["Israel","Egypt"], "color":"m-blue", "label":"…"} (the label sits at the layer's centre: label one country per layer; English Natural Earth names: "United States of America", "United Kingdom", "Palestine", "Russia", "Dem. Rep. Congo"…; an unknown name lists the valid ones), {"route": [[lon,lat], …], "color":"m-pink", "arrow": true, "dashed": false, "label":"…"}, {"points": [{"at":[lon,lat], "label":"ירושלים"}], "color":"m-orange"}, {"label":"הים התיכון", "at":[lon,lat], "size": 1}. Each layer takes "beat": n and "until": m. Labels: short; Hebrew works.
Example (the Exodus route, 3 beats):
{"region":[[24,21],[40,34]],"layers":[{"countries":["Egypt"],"color":"m-orange","label":"מצרים","beat":1},{"points":[{"at":[31.2,30.0],"label":"גושן"},{"at":[33.97,28.54],"label":"הר סיני"}],"color":"m-pink","beat":2},{"route":[[31.2,30.0],[32.6,29.9],[33.5,29.0],[33.97,28.54]],"color":"m-blue","dashed":true,"beat":3},{"label":"הים התיכון","at":[29,33]}]}`,
  },
  abc: {
    line: "music: melodies, scales, intervals, rhythms, chords on a staff, with a Play button (ABC notation, abcjs)",
    guide: `abc: ABC notation (X:1, T:title, M:4/4, L:1/8, Q:1/4=90, K:C, then the music lines). Drawn in the card in the board's ink; the student can press Play to hear the music shown so far.
Beats: end a music line with % @n (from beat n) or % @n-m; one music line per beat (break a melody into lines: each line in the source is a line of staff). Header lines show from the start.
One voice only (no V: lines): beats follow the staff lines. Colours: none (keep it plain; name the notes in the text). Chord symbols: "Am" before a note; lyrics: w: lines.
Example (a C major scale, then its triad):
X:1
T:C major
M:4/4
L:1/4
Q:1/4=90
K:C
C D E F | G A B c | % @1
[CEG]4 | % @2`,
  },
  chords: {
    line: "guitar, ukulele or bass chord charts (svguitar)",
    guide: `chords: JSON {"strings": 6, "frets": 4, "chords": [{"title":"Am", "fingers": [[string, fret, "label"?], …], "barres": [{"fromString":6,"toString":1,"fret":1}], "position": 5?, "color":"m-blue"?, "beat": n?, "until": m?}]}. Strings are numbered from the thinnest (1 = high E) to the thickest (6 = low E); fret 0 is an open string and "x" a muted one; the label (a finger number 1-4) is written in the dot. position: the fret the chart starts at (for chords up the neck). Up to 12 chords side by side; a chord with a beat appears then.
Example (Am then E):
{"chords":[{"title":"Am","fingers":[[2,1,"1"],[3,2,"3"],[4,2,"2"],[1,0],[5,0],[6,"x"]]},{"title":"E","fingers":[[3,1,"1"],[4,2,"3"],[5,2,"2"],[1,0],[2,0],[6,0]],"beat":2}]}`,
  },
  svg: {
    line: "anything else, drawn by hand (schematics, processes, timelines, simple diagrams)",
    guide: `svg: ${fmt("svg")}
Beats: data-beat="n" and data-until="m" on any element or <g>; data-focus="n" stresses a part only during beat n. class="m-blue|m-green|m-pink|m-orange" colours a group (draw it with stroke/fill="currentColor"; never a fixed black, white or grey, which vanishes on the light or the dark board); class="flow" makes dashes run along a stroke (current in a wire, blood, a signal); class="drift" with style="--dx:60;--dy:0" moves a part by (dx, dy) in viewBox units again and again (CO₂ into a cell, O₂ out, ions); class="pulse" pulses; class="shadow" adds depth; fill="url(#shade-blue|shade-green|shade-pink|shade-orange|shade-gray)" shades a shape. No <animate>. Labels are short and in one language each (R₁, I₂, CO₂, (1,0), גרעין); centre Hebrew labels with text-anchor="middle" (the drawing is laid out left to right). For biology prefer bio, for circuits and physics prefer tikz: they look professional.`,
  },
} as const satisfies Record<string, { line: string; guide: string }>;

export const FIGURE_KINDS = Object.keys(GUIDES) as [keyof typeof GUIDES, ...(keyof typeof GUIDES)[]];
export type FigureKind = keyof typeof GUIDES;

/** One line per kind, for the lesson prompt. */
export const CATALOGUE = FIGURE_KINDS.map((k) => `- ${k}: ${GUIDES[k].line}`).join("\n");

export const figureGuide = (kind: FigureKind, parts: string[]) => GUIDES[kind].guide.replace("{PARTS}", parts.join(", "));
