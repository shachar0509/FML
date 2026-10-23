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
