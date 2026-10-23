import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BEAT_MARK, beatAttrs, MARK, markColors } from "@/core/render/figures/beats";
import { graphvizToSvg, vegaLiteToSvg } from "./graphs";
import { imageToSvg } from "./image";
import { mapToSvg } from "./map";
import { tikzToSvg, textToPaths } from "./tikz";

/**
 * M79: figure kinds drawn on the server (heavy engines stay out of the card). The card asks for the SVG with the app-only tool
 * figure_render, so the drawing never enters the model's context; the card then shows it like an `svg` figure (beats, colours).
 */
export const SERVER_KINDS = ["tikz", "bio", "graphviz", "vegalite", "map", "image"] as const;
export type ServerKind = (typeof SERVER_KINDS)[number];
export const isServerKind = (k: string): k is ServerKind => (SERVER_KINDS as readonly string[]).includes(k);

/** Black and white become the board's ink and paper; the four theme colours follow the card's light/dark values. */
export function themeColors(svg: string): string {
  const paint = /\b(fill|stroke)="(#[0-9a-f]{3,6}|black|white)"/gi;
  // per tag, so the classes added join a class the tag already has (Vega marks carry one)
  return svg
    .replace(/<[a-zA-Z][^<>]*>/g, (tag) => {
      const add: string[] = [];
      const out = tag.replace(paint, (m, attr: string, c: string) => {
        const v = c.toLowerCase();
        if (["#000", "#000000", "black"].includes(v)) return `${attr}="currentColor"`;
        // classes, not style: an element may carry both a fill and a stroke (cards.css: .fig-paper-fill etc.)
        if (["#fff", "#ffffff", "white"].includes(v)) return add.push(`fig-paper-${attr}`), m;
        const name = Object.entries(MARK).find(([, hex]) => v === `#${hex}`)?.[0];
        return name ? (add.push(`m-${name}`), `${attr}="currentColor"`) : m;
      });
      if (!add.length) return out;
      return /\bclass="/.test(out) ? out.replace(/\bclass="([^"]*)"/, (_, c: string) => `class="${c} ${add.join(" ")}"`) : out.replace(/^<[a-zA-Z][\w:-]*/, (n) => `${n} class="${add.join(" ")}"`);
    })
    .replace(/<svg\b/, '<svg fill="currentColor"');
}

const PREAMBLE = `${Object.entries(MARK)
  .map(([n, hex]) => `\\definecolor{m-${n}}{HTML}{${hex.toUpperCase()}}`)
  .join("")}\\definecolor{m-white}{HTML}{FEFEFE}\\definecolor{m-black}{HTML}{262626}`; // fixed, for lettering on a filled shape
const PACKAGES = ["circuitikz", "chemfig", "pgfplots", "tikz-3dplot", "amsmath", "amssymb", "tikz-cd", "array"];

/** Claude writes the picture (optionally after \usepackage / \usetikzlibrary lines); the document around it is added here. */
export function tikzDocument(source: string): string {
  const lines = source.replace(/\r/g, "").split("\n");
  const head: string[] = [];
  const body: string[] = [];
  for (const line of lines) {
    if (/^\s*\\(documentclass|begin\{document\}|end\{document\})/.test(line)) continue;
    const pkg = /^\s*\\usepackage(?:\[[^\]]*\])?\{([^}]*)\}/.exec(line);
    if (pkg) {
      const bad = (pkg[1] ?? "").split(",").map((p) => p.trim()).filter((p) => !PACKAGES.includes(p) && p !== "tikz");
      if (bad.length) throw new Error(`Package ${bad.join(", ")} is not available; available: ${PACKAGES.join(", ")}`);
      head.push(line);
      continue;
    }
    if (/^\s*\\(usetikzlibrary|usepgfplotslibrary|pgfplotsset|tdplotsetmaincoords)\b/.test(line) && !body.some((l) => /\\begin\{/.test(l))) {
      head.push(line);
      continue;
    }
    const m = BEAT_MARK.exec(line);
    // a marked statement is wrapped in a raw <g>: the beat toggles it in the card, and the layout never changes
    body.push(m ? `\\special{dvisvgm:raw <g ${beatAttrs(m[1] ?? "0", m[2])}>}${line.slice(0, m.index)}\\special{dvisvgm:raw </g>}` : line);
  }
  if (!body.some((l) => /\\begin\{(tikzpicture|circuitikz)\}|\\chemfig/.test(l))) throw new Error("Expected \\begin{tikzpicture} … \\end{tikzpicture} (or circuitikz, or \\chemfig)");
  // the packages a picture needs are loaded even when Claude leaves out the \usepackage line
  const text = body.join("\n");
  const need = NEEDS.filter(([p, re]) => re.test(text) && !head.some((h) => h.includes(`{${p}}`))).map(([p]) => `\\usepackage{${p}}`);
  return `${[...need, ...head].join("\n")}\n\\usetikzlibrary{${LIBS}}\n${PREAMBLE}\n\\begin{document}\n${text}\n\\end{document}\n`;
}
const NEEDS = [
  ["circuitikz", /\\begin\{circuitikz\}/],
  ["chemfig", /\\chemfig/],
  ["pgfplots", /\\begin\{(axis|semilogxaxis|semilogyaxis|loglogaxis|polaraxis)\}/],
  ["tikz-3dplot", /\\tdplot/],
  ["tikz-cd", /\\begin\{tikzcd\}/],
] as const;
const LIBS = "arrows.meta,calc,angles,quotes,decorations.markings,decorations.pathmorphing,patterns,shadows,positioning,3d";

/** Ids made unique per drawing: several figures share one card (a lesson's slides), and TeX names every shading pgfsh1, pgfsh2… */
export function ownIds(svg: string, key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h * 33) ^ key.charCodeAt(i)) >>> 0;
  const p = `f${h.toString(36)}-`;
  return svg.replace(/\bid="([^"]+)"/g, `id="${p}$1"`).replace(/(href="#|url\(#)(?!shade-)([^")]+)/g, `$1${p}$2`); // the card's shading kit (shade-*) keeps its names
}

const cache = new Map<string, Promise<string>>();
/** The card-ready SVG of a server figure; errors say exactly what to fix. Recent results are cached (a slide replays every beat). */
export function renderFigure(kind: ServerKind, source: string): Promise<string> {
  const key = `${kind}\n${source}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      if (kind === "tikz") return ownIds(themeColors(textToPaths(await tikzToSvg(tikzDocument(source)))), key);
      if (kind === "bio") return ownIds(withLibrary(source), key);
      if (kind === "graphviz") return ownIds(themeColors(await graphvizToSvg(markColors(source))), key);
      if (kind === "vegalite") return ownIds(themeColors(await vegaLiteToSvg(markColors(source))), key);
      if (kind === "map") return mapToSvg(source);
      if (kind === "image") return imageToSvg(source);
      throw new Error(`Unknown figure kind ${kind as string}`);
    })();
    cache.set(key, hit);
    hit.catch(() => cache.delete(key));
    if (cache.size > 64) cache.delete(cache.keys().next().value ?? "");
  }
  return hit;
}

// built server: biolib/ next to server.mjs; dev and tests: assets/biolib
const here = dirname(fileURLToPath(import.meta.url));
const LIB = [join(here, "biolib"), join(here, "../../../assets/biolib")].find((d) => existsSync(d)) ?? "";
type Part = { license: string; author: string };
let parts: Record<string, Part> | undefined;
export const libraryParts = () => (parts ??= JSON.parse(readFileSync(join(LIB, "manifest.json"), "utf8")) as Record<string, Part>);

/**
 * `bio`: an <svg viewBox> whose <use href="#nucleus" x y width height/> place realistic library parts (Servier Medical Art, CC BY 3.0,
 * plus CC0 parts and Shalav's own). Each placement becomes the part itself in a nested <svg>; the credit for the parts used rides on data-credit.
 */
export function withLibrary(source: string): string {
  if (!/^\s*<svg[\s>]/i.test(source)) throw new Error("source must be one <svg viewBox=...> element");
  const all = libraryParts();
  const used = [...new Set([...source.matchAll(/<use\b[^>]*\bhref="#([\w-]+)"/g)].map((m) => m[1] ?? ""))];
  const ownIds = new Set([...source.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1] ?? ""));
  const unknown = used.filter((n) => !all[n] && !ownIds.has(n));
  if (unknown.length) throw new Error(`Unknown library part ${unknown.join(", ")}; parts: ${Object.keys(all).join(", ")}`);
  const lib = used.filter((n) => all[n] && !ownIds.has(n));
  if (!lib.length) throw new Error(`Place at least one library part with <use href="#name" x y width height/>; parts: ${Object.keys(all).join(", ")}`);
  const files = new Map(lib.map((n) => [n, readFileSync(join(LIB, `${n}.svg`), "utf8")]));
  const credits = [...new Set(lib.map((n) => all[n] ?? { license: "own", author: "" }).filter((p) => p.license !== "own" && p.license !== "cc-0").map((p) => (p.author === "Servier" ? "Servier Medical Art (CC BY 3.0)" : `${p.author} (${p.license.toUpperCase().replace("CC-BY-", "CC BY ")})`)))];
  let k = 0;
  // the card's sanitizer drops <use> and <symbol>, so each placement becomes the part itself in a nested <svg> (ids made unique per copy)
  return source
    .replace(/<use\b([^>]*?)\bhref="#([\w-]+)"([^>]*?)\/?>(?:\s*<\/use>)?/g, (m, a: string, n: string, b: string) => {
      const svg = files.get(n);
      if (!svg) return m;
      const attrs = `${a} ${b}`;
      const box = ["x", "y", "width", "height"].map((q) => new RegExp(`\\b${q}="[^"]*"`).exec(attrs)?.[0] ?? "").join(" ");
      const rest = attrs.replace(/\b(x|y|width|height)="[^"]*"/g, "").replace(/\s+/g, " ").trim();
      const vb = /viewBox="([^"]*)"/.exec(svg)?.[1] ?? "0 0 100 100";
      const id = `p${k++}-`;
      const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/\bid="([^"]+)"/g, `id="${id}$1"`).replace(/(href="#|url\(#)([^")]+)/g, `$1${id}$2`);
      return `<g${rest ? ` ${rest}` : ""} data-part="${n}"><svg ${box} viewBox="${vb}" preserveAspectRatio="xMidYMid meet" overflow="visible">${inner}</svg></g>`;
    })
    .replace(/<svg\b([^>]*)>/, (_, a: string) => `<svg${a}${credits.length ? ` data-credit="${credits.join("; ")}"` : ""}>`);
}
