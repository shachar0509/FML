import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { beatAttrs } from "@/core/render/figures/beats";

/**
 * M82: chess (FEN + moves by beat) and Go (setup + moves by beat, captures) boards, drawn on the server. A piece or stone is one
 * element per stay on a square (data-beat … data-until), so the board never redraws. The boards keep their own wood colours on both
 * themes (text on the wood is fixed dark, `data-own-bg` keeps the contrast guard off it); coordinates are outside the board in the board's ink.
 */
const color = z.enum(["m-blue", "m-green", "m-pink", "m-orange"]);
const when = { beat: z.number().int().min(0).optional(), until: z.number().int().min(1).optional() };
const span = (b?: number, u?: number) => (b || u !== undefined ? ` ${beatAttrs(String(b ?? 0), u !== undefined ? String(u) : undefined)}` : "");
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

// built server: chess/ next to server.mjs; dev and tests: assets/chess
const here = dirname(fileURLToPath(import.meta.url));
const PIECES = [join(here, "chess"), join(here, "../../../assets/chess")].find((d) => existsSync(d)) ?? "";
const pieceSvg = new Map<string, string>();
let uid = 0;
/** A piece (wK, bP…) as a nested <svg> on a 100-unit square (Chessnut pieces, Apache-2.0). */
function piece(code: string, x: number, y: number, attrs: string) {
  let svg = pieceSvg.get(code);
  if (!svg) pieceSvg.set(code, (svg = readFileSync(join(PIECES, `${code}.svg`), "utf8")));
  const vb = /viewBox="([^"]*)"/.exec(svg)?.[1] ?? "0 0 45 45";
  const id = `c${uid++}-`;
  const inner = svg.replace(/^[\s\S]*?<svg\b[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/\bid="([^"]+)"/g, `id="${id}$1"`).replace(/(href="#|url\(#)([^")]+)/g, `$1${id}$2`);
  return `<svg x="${x}" y="${y}" width="100" height="100" viewBox="${vb}"${attrs}>${inner}</svg>`;
}

const square = z.string().regex(/^[a-h][1-8]$/, "a square is a1 … h8");
export const chessSchema = z.object({
  fen: z.string().default("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"),
  flip: z.boolean().default(false).describe("black at the bottom"),
  moves: z.array(z.object({ move: z.string().regex(/^[a-h][1-8][a-h][1-8][qrbn]?$/, 'a move is from-to, like "e2e4" or "e7e8q"'), beat: z.number().int().min(1).optional() })).max(60).default([]),
  arrows: z.array(z.object({ from: square, to: square, color: color.default("m-green"), ...when })).max(20).default([]),
  highlight: z.array(z.object({ squares: z.array(square).min(1), color: color.default("m-blue"), ...when })).max(20).default([]),
});

export function chessToSvg(source: string): string {
  const spec = chessSchema.parse(JSON.parse(source));
  const rows = spec.fen.trim().split(/\s+/)[0]?.split("/") ?? [];
  if (rows.length !== 8) throw new Error("the FEN placement needs 8 ranks separated by /");
  type P = { code: string; sq: string; from: number; until?: number };
  const live = new Map<string, P>();
  const all: P[] = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else {
        if (!/[KQRBNPkqrbnp]/.test(ch) || f > 7) throw new Error(`bad FEN rank "${row}"`);
        const p = { code: `${ch === ch.toUpperCase() ? "w" : "b"}${ch.toUpperCase()}`, sq: `${"abcdefgh"[f]}${8 - r}`, from: 0 };
        live.set(p.sq, p);
        all.push(p);
        f++;
      }
    }
    if (f !== 8) throw new Error(`FEN rank "${row}" has ${f} squares`);
  });
  const lastMove: { from: string; to: string; beat: number }[] = [];
  spec.moves.forEach((m, i) => {
    const b = m.beat ?? i + 1;
    const [from, to, promo] = [m.move.slice(0, 2), m.move.slice(2, 4), m.move[4]];
    const p = live.get(from);
    if (!p) throw new Error(`move ${i + 1} (${m.move}): no piece on ${from}`);
    const end = (q: P | undefined) => {
      if (!q) return;
      q.until = b - 1;
      live.delete(q.sq);
    };
    end(live.get(to)); // a capture
    if (p.code[1] === "P" && from[0] !== to[0] && !live.has(to)) end(live.get(`${to[0]}${from[1]}`)); // en passant
    end(p);
    const moved = { code: promo ? `${p.code[0]}${promo.toUpperCase()}` : p.code, sq: to, from: b };
    live.set(to, moved);
    all.push(moved);
    // castling: the rook comes along
    if (p.code[1] === "K" && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
      const [rf, rt] = to[0] === "g" ? ["h", "f"] : ["a", "d"];
      const rook = live.get(`${rf}${from[1]}`);
      if (rook) {
        end(rook);
        const r2 = { code: rook.code, sq: `${rt}${from[1]}`, from: b };
        live.set(r2.sq, r2);
        all.push(r2);
      }
    }
    lastMove.push({ from, to, beat: b });
  });
  const M = 40; // margin for the coordinates
  const xy = (sq: string) => {
    const f = sq.charCodeAt(0) - 97;
    const r = Number(sq[1]) - 1;
    return (spec.flip ? [M + (7 - f) * 100, M + r * 100] : [M + f * 100, M + (7 - r) * 100]) as [number, number];
  };
  const out: string[] = [];
  for (let f = 0; f < 8; f++)
    for (let r = 0; r < 8; r++) {
      const [x, y] = xy(`${"abcdefgh"[f]}${r + 1}`);
      out.push(`<rect x="${x}" y="${y}" width="100" height="100" fill="${(f + r) % 2 ? "#f0d9b5" : "#b58863"}"/>`);
    }
  // the last move's squares, while it is the last move
  lastMove.forEach((m, i) => {
    const next = lastMove[i + 1]?.beat;
    for (const sq of [m.from, m.to]) {
      const [x, y] = xy(sq);
      out.push(`<rect x="${x}" y="${y}" width="100" height="100" fill="#cdd26a" opacity="0.75"${span(m.beat, next !== undefined ? next - 1 : undefined)}/>`);
    }
  });
  for (const h of spec.highlight)
    out.push(`<g class="${h.color}"${span(h.beat, h.until)}>${h.squares.map((sq) => { const [x, y] = xy(sq); return `<rect x="${x + 4}" y="${y + 4}" width="92" height="92" fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="6"/>`; }).join("")}</g>`);
  for (const p of all) {
    const [x, y] = xy(p.sq);
    out.push(piece(p.code, x, y, span(p.from, p.until)));
  }
  for (const a of spec.arrows) {
    const [[ax, ay], [bx, by]] = [xy(a.from), xy(a.to)].map(([x, y]) => [x + 50, y + 50] as const) as [readonly [number, number], readonly [number, number]];
    const t = Math.atan2(by - ay, bx - ax);
    const [ex, ey] = [bx - 30 * Math.cos(t), by - 30 * Math.sin(t)];
    const head = [[bx, by], [ex - 22 * Math.sin(t), ey + 22 * Math.cos(t)], [ex + 22 * Math.sin(t), ey - 22 * Math.cos(t)]].map((p) => p.map((v) => v.toFixed(1)).join(",")).join(" ");
    out.push(`<g class="${a.color}" opacity="0.85"${span(a.beat, a.until)}><path d="M${ax} ${ay}L${ex} ${ey}" stroke="currentColor" stroke-width="16" stroke-linecap="round"/><polygon points="${head}" fill="currentColor"/></g>`);
  }
  // coordinates in the board's ink, outside the squares
  for (let i = 0; i < 8; i++) {
    const [fx] = xy(`${"abcdefgh"[i]}1`);
    const [, ry] = xy(`a${i + 1}`);
    out.push(`<text x="${fx + 50}" y="${M + 800 + 28}" font-size="24" text-anchor="middle" fill="currentColor">${"abcdefgh"[i]}</text><text x="${M / 2}" y="${ry + 58}" font-size="24" text-anchor="middle" fill="currentColor">${i + 1}</text>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${800 + 2 * M} ${800 + 2 * M}" font-family="sans-serif">${out.join("")}</svg>`;
}

const point = z.string().regex(/^[a-s]{2}$/, 'a point is two letters, column then row from the top-left, like "dd" (SGF)');
export const goSchema = z.object({
  size: z.union([z.literal(9), z.literal(13), z.literal(19)]).default(19),
  black: z.array(point).default([]),
  white: z.array(point).default([]),
  moves: z.array(z.object({ black: point.optional(), white: point.optional(), beat: z.number().int().min(1).optional(), label: z.string().max(3).optional() })).max(80).default([]),
  marks: z.array(z.object({ at: point, type: z.enum(["circle", "triangle", "square", "label"]).default("circle"), text: z.string().max(3).optional(), color: color.default("m-pink"), ...when })).max(40).default([]),
  region: z.tuple([point, point]).optional().describe("show only this corner or side: [top-left, bottom-right]"),
});

export function goToSvg(source: string): string {
  const spec = goSchema.parse(JSON.parse(source));
  const N = spec.size;
  const at = (p: string) => [p.charCodeAt(0) - 97, p.charCodeAt(1) - 97] as const;
  type S = { c: "b" | "w"; x: number; y: number; from: number; until?: number; label?: string };
  const grid = new Map<string, S>();
  const stones: S[] = [];
  const put = (c: "b" | "w", p: string, from: number, label?: string) => {
    const [x, y] = at(p);
    if (x >= N || y >= N) throw new Error(`point ${p} is off a ${N}×${N} board`);
    if (grid.has(`${x},${y}`)) throw new Error(`point ${p} is taken`);
    const s: S = { c, x, y, from, label };
    grid.set(`${x},${y}`, s);
    stones.push(s);
    return s;
  };
  for (const p of spec.black) put("b", p, 0);
  for (const p of spec.white) put("w", p, 0);
  const near = (x: number, y: number) => ([[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]] as [number, number][]).filter(([a, b]) => a >= 0 && b >= 0 && a < N && b < N);
  /** The group of a stone and whether it has a liberty. */
  const group = (s: S) => {
    const seen = new Set([`${s.x},${s.y}`]);
    const todo = [s];
    let free = false;
    while (todo.length) {
      const t = todo.pop() as S;
      for (const [a, b] of near(t.x, t.y)) {
        const o = grid.get(`${a},${b}`);
        if (!o) free = true;
        else if (o.c === s.c && !seen.has(`${a},${b}`)) {
          seen.add(`${a},${b}`);
          todo.push(o);
        }
      }
    }
    return { free, cells: [...seen] };
  };
  spec.moves.forEach((m, i) => {
    const p = m.black ?? m.white;
    if (!p || (m.black && m.white)) throw new Error(`move ${i + 1}: give "black" or "white"`);
    const b = m.beat ?? i + 1;
    const s = put(m.black ? "b" : "w", p, b, m.label);
    // captures: neighbouring enemy groups without a liberty leave
    for (const [a, c] of near(s.x, s.y)) {
      const o = grid.get(`${a},${c}`);
      if (!o || o.c === s.c) continue;
      const g = group(o);
      if (!g.free)
        for (const k of g.cells) {
          const dead = grid.get(k) as S;
          dead.until = b - 1;
          grid.delete(k);
        }
    }
  });
  const U = 40;
  const [[x0, y0], [x1, y1]] = spec.region ? [at(spec.region[0]), at(spec.region[1])] : [[0, 0], [N - 1, N - 1]];
  const pos = (v: number) => U + v * U;
  const lines: string[] = [];
  for (let i = 0; i < N; i++) lines.push(`M${pos(0)} ${pos(i)}H${pos(N - 1)}M${pos(i)} ${pos(0)}V${pos(N - 1)}`);
  const stars = N === 19 ? [3, 9, 15] : N === 13 ? [3, 6, 9] : [2, 4, 6];
  const dots = stars.flatMap((a) => stars.map((b) => (N === 9 && (a === 4) !== (b === 4) ? "" : `<circle cx="${pos(a)}" cy="${pos(b)}" r="4" fill="#3a2a10"/>`))).join("");
  const g = `g${uid++}-`;
  const defs = `<defs><radialGradient id="${g}b" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#666"/><stop offset=".5" stop-color="#1c1c1c"/><stop offset="1" stop-color="#000"/></radialGradient><radialGradient id="${g}w" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".7" stop-color="#e6e6e6"/><stop offset="1" stop-color="#b8b8b8"/></radialGradient></defs>`;
  const st = stones.map((s) => `<g${span(s.from, s.until)}><circle cx="${pos(s.x)}" cy="${pos(s.y)}" r="${U * 0.47}" fill="url(#${g}${s.c})"${s.c === "w" ? ' stroke="#8a8a8a" stroke-width="1"' : ""}/>${s.label ? `<text x="${pos(s.x)}" y="${pos(s.y) + 7}" font-size="20" text-anchor="middle" fill="${s.c === "b" ? "#fefefe" : "#111"}">${esc(s.label)}</text>` : ""}</g>`).join("");
  const mk = spec.marks.map((m) => {
    const [x, y] = at(m.at);
    const [cx, cy] = [pos(x), pos(y)];
    const shape = m.type === "circle" ? `<circle cx="${cx}" cy="${cy}" r="11" fill="none" stroke="currentColor" stroke-width="4"/>` : m.type === "square" ? `<rect x="${cx - 10}" y="${cy - 10}" width="20" height="20" fill="none" stroke="currentColor" stroke-width="4"/>` : m.type === "triangle" ? `<polygon points="${cx},${cy - 13} ${cx - 12},${cy + 9} ${cx + 12},${cy + 9}" fill="none" stroke="currentColor" stroke-width="4"/>` : `<circle cx="${cx}" cy="${cy}" r="14" fill="#dcb35c" stroke="currentColor" stroke-width="3"/><text x="${cx}" y="${cy + 8}" font-size="22" font-weight="700" text-anchor="middle" fill="#111">${esc(m.text ?? "A")}</text>`;
    return `<g class="${m.color}"${span(m.beat, m.until)}>${shape}</g>`;
  }).join("");
  const pad = U * 0.6;
  const vb = [pos(x0) - pad, pos(y0) - pad, pos(x1) - pos(x0) + 2 * pad, pos(y1) - pos(y0) + 2 * pad].join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" font-family="sans-serif">${defs}<rect x="${pos(x0) - pad}" y="${pos(y0) - pad}" width="${pos(x1) - pos(x0) + 2 * pad}" height="${pos(y1) - pos(y0) + 2 * pad}" rx="6" fill="#dcb35c"/><g data-own-bg=""><path d="${lines.join("")}" stroke="#3a2a10" stroke-width="1.4"/>${dots}${st}${mk}</g></svg>`;
}
