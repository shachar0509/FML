import { FIGURE_FORMATS } from "./figures";

/**
 * M79: the figure kinds of teach_step / show_figure. The lesson prompt carries only CATALOGUE (one line per kind); the conventions
 * and an example of a kind come from the figure_guide tool when Claude first uses it, so a lesson pays only for the kinds it draws.
 */
const fmt = (tag: string) => FIGURE_FORMATS.split("\n").find((l) => l.startsWith(`- \`\`\`${tag} `))?.replace(/^- ```\w+\s+/, "") ?? "";

export const GUIDES = {
  plot: {
    line: "function graphs, data points, vectors",
    guide: `plot: ${fmt("plot")}
Beats: "beat": n and "until": m on data and annotations items (each beat redraws the plot; prefer geometry for a graph that builds up).`,
  },
  geometry: {
    line: "function investigations, vectors, forces, geometry, complex plane",
    guide: `geometry: ${fmt("geometry")}
Beats: "beat": n, "until": m and "color": "blue|green|pink|orange" on any element. A part cannot appear before the points it uses.
Example, f(x)=x^2-2x+1 with "axis": true: beats 1-2 compute f'(x)=2x-2=0 → x=1 (text only); beat 3 f(1)=0: the point V (1,0) with label "(1,0)" and "color":"blue"; beat 4 f''(x)=2>0; beat 5 opens upward: the curve x^2-2x+1; beat 6 f(0)=1: the point P (0,1); beat 7 symmetry: the point Q (2,1) and a dashed segment P–Q.`,
  },
  tikz: {
    line: "circuits, mechanics, optics, physics, pgfplots, 3D, chemfig, tikz-cd (real LaTeX)",
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
    line: "realistic biology and anatomy; OpenMoji pictograms (om-*) for any scene",
    guide: `bio: one <svg viewBox="0 0 W H"> that places realistic library illustrations with <use href="#name" x y width height/> (each keeps its proportions inside the box), plus your own arrows, molecules and labels in plain SVG.
Parts: {PARTS}.
Beats: data-beat="n" / data-until="m" / data-focus="n" on a <use> or a <g> (as in svg). Colours: class="m-blue|m-green|m-pink|m-orange" on your own strokes and text (stroke/fill="currentColor"); the library parts keep their natural colours (om-* parts are OpenMoji pictograms: om-factory, om-bus, om-money, om-person… for economics, history and everyday scenes), so link a word to a part by a coloured outline or arrow (class="m-blue" on an ellipse around it) and \\blue{word} in the text. Effects: class="shadow" (soft drop shadow, depth), class="glow" (highlight), class="flow" / "drift" (style="--dx:60;--dy:0") / "pulse" as in svg; fills fill="url(#shade-blue|shade-green|shade-pink|shade-orange|shade-gray)" give your own shapes a shaded, 3D look.
Labels: short, one language each, font-size about 4% of the width; centre Hebrew labels with text-anchor="middle"; molecules as text (CO₂, O₂, H₂O, C₆H₁₂O₆).
Example (photosynthesis): <svg viewBox="0 0 800 480"><use href="#leaf" x="160" y="90" width="480" height="290"/><use href="#chloroplast" x="330" y="190" width="150" height="80" class="shadow" data-beat="2"/><use href="#sun" x="20" y="10" width="120" height="120" data-beat="1"/><g class="m-blue" data-beat="3" data-until="5"><text x="110" y="300" fill="currentColor" font-size="30">CO₂</text><path class="flow" d="M180 290 L330 240" stroke="currentColor" stroke-width="4"/></g> … <g class="m-green drift" style="--dx:120;--dy:0" data-beat="6"><text x="560" y="250" fill="currentColor" font-size="30">O₂</text></g></svg>`,
  },
  graphviz: {
    line: "graphs, automata, trees, data structures, ER (Graphviz)",
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
    line: "flowcharts, algorithms, sequence/state diagrams, timelines, Gantt (Mermaid)",
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
    line: "statistics, data charts, regression, economics (Vega-Lite)",
    guide: `vegalite: a Vega-Lite JSON spec (data inline in "data": {"values": [...]}; no URLs), drawn on Shalav's server. Use "layer": [...] to build a chart up: each layer may carry "beat": n and "until": m (scales are computed from every layer, so axes never move). Width and height about 520 × 320.
Colours: "color": "m-blue" (also m-green, m-pink, m-orange) in a mark or in a scale range follows the card's theme; axes and labels are drawn in the board's ink. Axis titles: short; Hebrew works.
Example (a scatter, then its regression line, then the residual of one point):
{"width":520,"height":320,"data":{"values":[{"x":1,"y":2.1},{"x":2,"y":3.9},{"x":3,"y":6.2},{"x":4,"y":7.8},{"x":5,"y":10.1}]},
"layer":[{"mark":{"type":"point","filled":true,"size":80,"color":"m-blue"},"encoding":{"x":{"field":"x","type":"quantitative"},"y":{"field":"y","type":"quantitative"}}},
{"beat":2,"mark":{"type":"line","color":"m-orange"},"transform":[{"regression":"y","on":"x"}],"encoding":{"x":{"field":"x","type":"quantitative"},"y":{"field":"y","type":"quantitative"}}}]}`,
  },
  image: {
    line: "a region of a page from the course files (art, micrograph, map, machine) with marks",
    guide: `image: JSON {"file", "page", "crop": [x0, y0, x1, y1], "marks": [...]}. First call course_page({file, page}) to see the page: it comes with a grid of page fractions (x from the left, y from the top). Pages that consult_materials lists "has a figure" are the likely ones. The crop and every mark use those page fractions (not fractions of the crop); crop tight around the picture, leave out page text.
Marks: {"type":"arrow","from":[x,y],"to":[x,y],"text":"…"} (the text sits at the tail), {"type":"circle","at":[x,y],"r":0.05,"text":"…"} (r as a fraction of the page width), {"type":"box","box":[x0,y0,x1,y1],"text":"…"}, {"type":"label","at":[x,y],"text":"…"}. Each takes "color": "m-blue|m-green|m-pink|m-orange" (default m-pink; the same colour as the \\blue{…} word in the text), "beat": n and "until": m. Labels: a word or two (Hebrew works); a label sits on a paper-coloured pill, so it reads on any photo.
Example (a cell micrograph on page 4, the nucleus at beat 1, a mitochondrion at beat 2):
{"file":"lecture3.pdf","page":4,"crop":[0.1,0.3,0.9,0.75],"marks":[{"type":"circle","at":[0.42,0.5],"r":0.07,"text":"גרעין","color":"m-blue","beat":1},{"type":"arrow","from":[0.75,0.68],"to":[0.62,0.56],"text":"מיטוכונדריה","color":"m-green","beat":2}]}`,
  },
  map: {
    line: "geographic and historical maps: countries, routes, cities",
    guide: `map: JSON {"projection", "region": [[west, south], [east, north]], "width": 800, "height": 520, "layers": [...]}, drawn on Shalav's server from Natural Earth borders (today's borders; for a historical map shade today's countries or draw routes and labels). projection: "mercator" (default, regions), "equalEarth" or "naturalEarth" (the world), "orthographic" (a globe centred on the region), "conic" (a mid-latitude country or continent). Coordinates are [longitude, latitude] in degrees (east and north positive).
Layers, in drawing order: {"countries": ["Israel","Egypt"], "color":"m-blue", "label":"…"} (the label sits at the layer's centre: label one country per layer; English Natural Earth names: "United States of America", "United Kingdom", "Palestine", "Russia", "Dem. Rep. Congo"…; an unknown name lists the valid ones), {"route": [[lon,lat], …], "color":"m-pink", "arrow": true, "dashed": false, "label":"…"}, {"points": [{"at":[lon,lat], "label":"ירושלים"}], "color":"m-orange"}, {"label":"הים התיכון", "at":[lon,lat], "size": 1}. Each layer takes "beat": n and "until": m. Labels: short; Hebrew works.
Example (the Exodus route, 3 beats):
{"region":[[24,21],[40,34]],"layers":[{"countries":["Egypt"],"color":"m-orange","label":"מצרים","beat":1},{"points":[{"at":[31.2,30.0],"label":"גושן"},{"at":[33.97,28.54],"label":"הר סיני"}],"color":"m-pink","beat":2},{"route":[[31.2,30.0],[32.6,29.9],[33.5,29.0],[33.97,28.54]],"color":"m-blue","dashed":true,"beat":3},{"label":"הים התיכון","at":[29,33]}]}`,
  },
  abc: {
    line: "melodies, scales, rhythms on a staff, with Play (ABC)",
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
    line: "guitar or ukulele chord charts",
    guide: `chords: JSON {"strings": 6, "frets": 4, "chords": [{"title":"Am", "fingers": [[string, fret, "label"?], …], "barres": [{"fromString":6,"toString":1,"fret":1}], "position": 5?, "color":"m-blue"?, "beat": n?, "until": m?}]}. Strings are numbered from the thinnest (1 = high E) to the thickest (6 = low E); fret 0 is an open string and "x" a muted one; the label (a finger number 1-4) is written in the dot. position: the fret the chart starts at (for chords up the neck). Up to 12 chords side by side; a chord with a beat appears then.
Example (Am then E):
{"chords":[{"title":"Am","fingers":[[2,1,"1"],[3,2,"3"],[4,2,"2"],[1,0],[5,0],[6,"x"]]},{"title":"E","fingers":[[3,1,"1"],[4,2,"3"],[5,2,"2"],[1,0],[2,0],[6,0]],"beat":2}]}`,
  },
  pikchr: {
    line: "box-and-arrow diagrams in words: pipelines, architectures (Pikchr)",
    guide: `pikchr: Pikchr source (the PIC language): box "CPU" fit; arrow right 150%; cylinder "RAM"; down; arrow from CPU.s; oval "I/O" … Objects: box, circle, ellipse, oval, cylinder, file, diamond, dot, line, arrow, spline, move, text; place with right/down/left/up, "from X.e to Y.w", "at 1cm below X". Labels: "text" (several strings stack); Hebrew works but keep labels short (Pikchr estimates text width).
Beats: end a statement's line with # @n (from beat n) or # @n-m; one statement per marked line. The layout is computed once, so nothing moves.
Colours: color m-blue (also m-green, m-pink, m-orange) on a statement; fill m-blue fills it lightly (fills are always translucent, so text on them reads on both boards). Black is the board's ink.
Example (a compiler pipeline in 3 beats):
box "Source" fit
arrow right 120%
box "Lexer" fit color m-blue # @1
arrow right 120% # @2
box "Parser" fit color m-green # @2
arrow right 120% # @3
box "Code" "generator" fit fill m-orange # @3`,
  },
  bytefield: {
    line: "packet, register and instruction layouts",
    guide: `bytefield: bytefield-svg's DSL (Clojure-like lists): rows are 16 boxes by default; (def boxes-per-row 32) with (draw-column-headers {:labels (map str (range 32))}) for 32-bit words; (draw-column-headers); (draw-box "Label" {:span 4}); (draw-box nil {:span 8 :borders #{:left :right}}); (draw-gap "Payload"); (draw-bottom); (next-row); (draw-box 0x45 {:span 8}). Shown whole (no beats): explain the fields in the slide's beats instead.
Colours: {:fill "m-blue"} (also m-green, m-pink, m-orange) shades a field lightly; text is the board's ink.
Example (the first word of an IPv4 header):
(def boxes-per-row 32)
(draw-column-headers {:labels (map str (range 32))})
(draw-box "Version" {:span 4 :fill "m-blue"})
(draw-box "IHL" {:span 4})
(draw-box "DSCP" {:span 6})
(draw-box "ECN" {:span 2})
(draw-box "Total Length" {:span 16 :fill "m-green"})`,
  },
  score: {
    line: "engraved multi-staff scores from MusicXML; shown whole",
    guide: `score: a score engraved by Verovio: MusicXML (any number of staves and voices: <staves>2</staves> with <staff>1|2</staff> on each note and <backup> between staves) or ABC with one voice (several V: voices are not supported in ABC here). Shown whole, no beats and no Play button: for a melody that builds up beat by beat, or to let the student hear it, use abc. Keep it to a few bars (one system).
Example (a V–I cadence on a grand staff, MusicXML):
<score-partwise version="4.0"><part-list><score-part id="P1"><part-name></part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><type>half</type><staff>1</staff></note><note><pitch><step>B</step><octave>4</octave></pitch><duration>2</duration><type>half</type><staff>1</staff></note>
<backup><duration>4</duration></backup><note><pitch><step>G</step><octave>2</octave></pitch><duration>4</duration><type>whole</type><staff>2</staff></note></measure>
<measure number="2"><note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration><type>whole</type><staff>1</staff></note>
<backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><type>whole</type><staff>2</staff></note></measure></part></score-partwise>`,
  },
  chess: {
    line: "chess positions and moves",
    guide: `chess: JSON {"fen": "<piece placement or a full FEN>", "flip": false, "moves": [{"move":"e2e4","beat":1}, …], "arrows": [{"from":"g1","to":"f3","color":"m-green","beat":2}], "highlight": [{"squares":["e4","d5"],"color":"m-blue","beat":1}]}. Moves are from-square to-square ("e7e8q" promotes); captures, castling (the king moves two squares) and en passant are handled; each move happens at its beat (default: its order), and the last move's squares are tinted. arrows and highlight take "until" too. flip: true puts black at the bottom.
Example (the Scholar's mate threat, 3 beats):
{"fen":"rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR","moves":[{"move":"f1c4","beat":1},{"move":"b8c6","beat":2},{"move":"d1h5","beat":3}],"arrows":[{"from":"h5","to":"f7","color":"m-pink","beat":3},{"from":"c4","to":"f7","color":"m-pink","beat":3}]}`,
  },
  go: {
    line: "Go positions and sequences",
    guide: `go: JSON {"size": 19|13|9, "black": ["dd", …], "white": ["pp", …], "moves": [{"black":"qd","beat":1,"label":"1"}, {"white":"oc","label":"2"}, …], "marks": [{"at":"qf","type":"triangle|circle|square|label","text":"A","color":"m-pink","beat":2}], "region": ["jj","ss"]}. Points are SGF letters: column then row, "aa" at the top-left. Captured stones leave at the move that captures them. region shows a corner or side (top-left and bottom-right points). Each move happens at its beat (default: its order).
Example (white is in atari, then captured, 9×9 corner):
{"size":9,"region":["aa","ee"],"black":["bb","ac"],"white":["ab","cb"],"marks":[{"at":"aa","type":"triangle","color":"m-pink","beat":1,"until":1}],"moves":[{"black":"aa","beat":2,"label":"1"}]}`,
  },
  tree: {
    line: "syntax and other labelled trees from brackets",
    guide: `tree: labelled brackets [Label child child …]; a word without brackets is a leaf: [S [NP [D the] [N cat]] [VP [V sat] [PP [P on] [NP [D the] [N mat]]]]]. Quote a label with spaces or brackets: [NP "the big cat"]. Laid out by Graphviz with the children in order; leaves are drawn in blue.
Beats: Label@n (or Label@n-m) shows that node and its whole subtree from beat n.
Example (subject, then predicate):
[S [NP@1 [D the] [N cat]] [VP@2 [V sat] [PP@3 [P on] [NP [D the] [N mat]]]]]`,
  },
  sky: {
    line: "star maps: constellations, bright stars",
    guide: `sky: JSON {"center": [RA hours, Dec degrees], "fov": 70, "projection": "stereographic"|"orthographic", "magnitude": 5, "lines": true, "names": "he"|"en"|"none", "layers": [...]}. A night sky (dark, fixed colours) seen from Earth, east to the left; stars to the given magnitude, constellation lines and names (Hebrew names built in).
Layers: {"constellation":"Ori","color":"m-blue"} (IAU abbreviation or English name: its lines highlighted), {"star":"Betelgeuse","label":"בטלגז","color":"m-orange"} (proper name; the label defaults to its Hebrew name), {"path":[[RA,Dec], …],"color":"m-pink","dashed":true,"label":"…"} (a hop, the ecliptic), {"at":[RA,Dec],"label":"…"}. Each takes "beat": n and "until": m.
Example (Orion, then its two brightest stars):
{"center":[5.6,3],"fov":50,"layers":[{"constellation":"Ori","color":"m-blue","beat":1},{"star":"Betelgeuse","color":"m-orange","beat":2},{"star":"Rigel","color":"m-blue","beat":3}]}`,
  },
  smiles: {
    line: "molecules from SMILES",
    guide: `smiles: one SMILES string (c1ccccc1O), or JSON {"molecules": [{"smiles":"CCO","label":"אתנול","beat":1}, {"smiles":"CC=O","label":"אצטאלדהיד","beat":2}]} for up to 8 molecules side by side, each shown from its beat (a reaction step by step). Drawn in the card with standard atom colours; for a hand-placed structure with arrows (mechanisms) use tikz with chemfig.
Example (ethanol oxidised to acetaldehyde):
{"molecules":[{"smiles":"CCO","label":"אתנול","beat":1},{"smiles":"CC=O","label":"אצטאלדהיד","beat":2}]}`,
  },
  svg: {
    line: "anything else, drawn by hand",
    guide: `svg: ${fmt("svg")}
Beats: data-beat="n" and data-until="m" on any element or <g>; data-focus="n" stresses a part only during beat n. class="m-blue|m-green|m-pink|m-orange" colours a group (draw it with stroke/fill="currentColor"; never a fixed black, white or grey, which vanishes on the light or the dark board); class="flow" makes dashes run along a stroke (current in a wire, blood, a signal); class="drift" with style="--dx:60;--dy:0" moves a part by (dx, dy) in viewBox units again and again (CO₂ into a cell, O₂ out, ions); class="pulse" pulses; class="shadow" adds depth; fill="url(#shade-blue|shade-green|shade-pink|shade-orange|shade-gray)" shades a shape. class="draw" on a stroke (or a <g>) draws it in, line by line, when its beat comes; class="sketch" on a <g> redraws its shapes by hand (a whiteboard look). No <animate>. Labels are short and in one language each (R₁, I₂, CO₂, (1,0), גרעין); centre Hebrew labels with text-anchor="middle" (the drawing is laid out left to right). For biology prefer bio, for circuits and physics prefer tikz: they look professional.`,
  },
} as const satisfies Record<string, { line: string; guide: string }>;

export const FIGURE_KINDS = Object.keys(GUIDES) as [keyof typeof GUIDES, ...(keyof typeof GUIDES)[]];
export type FigureKind = keyof typeof GUIDES;

/** One line per kind, for the lesson prompt. */
export const CATALOGUE = FIGURE_KINDS.map((k) => `- ${k}: ${GUIDES[k].line}`).join("\n");

export const figureGuide = (kind: FigureKind, parts: string[]) => GUIDES[kind].guide.replace("{PARTS}", parts.join(", "));
