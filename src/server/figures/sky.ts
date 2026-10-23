import { geoCircle, geoOrthographic, geoPath, geoStereographic } from "d3-geo";
import * as z from "zod";
import constellations from "../../../assets/sky/constellations.json";
import lines from "../../../assets/sky/lines.json";
import starnames from "../../../assets/sky/starnames.json";
import stars from "../../../assets/sky/stars.json";
import { beatAttrs } from "@/core/render/figures/beats";

/**
 * M82: star maps from d3-celestial's data (BSD-3; Hipparcos stars to magnitude 6, IAU constellation lines, names in Hebrew and
 * English), drawn with d3-geo on the server. A night sky of its own (fixed colours, `data-own-bg`), seen from inside the sphere
 * (east to the left). Coordinates are [right ascension in hours, declination in degrees].
 */
const radec = z.tuple([z.number().min(0).max(24), z.number().min(-90).max(90)]);
const color = z.enum(["m-blue", "m-green", "m-pink", "m-orange"]);
const when = { beat: z.number().int().min(0).optional(), until: z.number().int().min(1).optional() };
export const skySchema = z.object({
  center: radec.default([5.5, 0]),
  fov: z.number().min(10).max(180).default(70).describe("degrees across"),
  projection: z.enum(["stereographic", "orthographic"]).default("stereographic"),
  magnitude: z.number().min(1).max(6).default(5),
  lines: z.boolean().default(true),
  names: z.enum(["he", "en", "none"]).default("he"),
  width: z.number().min(300).max(1200).default(800),
  height: z.number().min(200).max(900).default(560),
  layers: z
    .array(
      z.union([
        z.object({ constellation: z.string(), color: color.default("m-blue"), ...when }),
        z.object({ star: z.string(), label: z.string().max(30).optional(), color: color.default("m-orange"), ...when }),
        z.object({ path: z.array(radec).min(2), color: color.default("m-pink"), dashed: z.boolean().default(false), label: z.string().max(30).optional(), ...when }),
        z.object({ at: radec, label: z.string().min(1).max(30), color: color.default("m-orange"), ...when }),
      ]),
    )
    .max(30)
    .default([]),
});

// bright theme colours on the night sky (the dark board's --m-* values)
const BRIGHT = { "m-blue": "#8cc8f2", "m-green": "#8fe0a4", "m-pink": "#ff9db0", "m-orange": "#ffc078" } as const;
const lon = ([h, d]: [number, number]) => [h * 15 > 180 ? h * 15 - 360 : h * 15, d] as [number, number];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fx = (n: number) => Math.round(n * 10) / 10;
type C = { en: string; he: string; at: [number, number] };
const CONS = constellations as unknown as Record<string, C>;
const LINES = lines as unknown as Record<string, [number, number][][]>;
const NAMES = starnames as unknown as Record<string, [string, string]>;
const STARS = stars as unknown as [number, number, number, number][];

export function skyToSvg(source: string): string {
  const spec = skySchema.parse(JSON.parse(source));
  const { width: W, height: H } = spec;
  const c = lon(spec.center);
  const proj = (spec.projection === "orthographic" ? geoOrthographic() : geoStereographic()).rotate([-c[0], -c[1]]).reflectX(true);
  proj.fitExtent([[0, 0], [W, H]], geoCircle().center(c).radius(spec.fov / 2)());
  proj.clipAngle(spec.projection === "orthographic" ? 90 : Math.min(150, spec.fov)).clipExtent([[0, 0], [W, H]]);
  const path = geoPath(proj);
  const pt = (p: [number, number]) => proj(p)?.map(fx) as [number, number] | undefined;
  const k = W / 800;
  const text = (x: number, y: number, t: string, fill: string, size = 15, weight = 400) =>
    `<text x="${x}" y="${y}" font-size="${fx(size * k)}" text-anchor="middle" fill="${fill}" font-weight="${weight}">${esc(t)}</text>`;
  const consLines = (id: string) => `<path d="${path({ type: "MultiLineString", coordinates: LINES[id] ?? [] }) ?? ""}"/>`;
  const findCons = (n: string) => {
    const id = Object.keys(CONS).find((k) => k.toLowerCase() === n.toLowerCase() || CONS[k]?.en.toLowerCase() === n.toLowerCase() || CONS[k]?.he === n);
    if (!id) throw new Error(`Unknown constellation "${n}"; use the IAU abbreviation (Ori, UMa, Cas, Sco…) or its English name`);
    return id;
  };
  const findStar = (n: string) => {
    const hip = Object.keys(NAMES).find((h) => NAMES[h]?.[0].toLowerCase() === n.toLowerCase() || NAMES[h]?.[1] === n);
    const s = hip && STARS.find((x) => String(x[3]) === hip);
    if (!s || !hip) throw new Error(`Unknown star "${n}" (a proper name like Sirius, Betelgeuse, Polaris), or give "at": [RA hours, Dec degrees]`);
    return { at: [s[0], s[1]] as [number, number], he: NAMES[hip]?.[1] ?? "", en: NAMES[hip]?.[0] ?? n };
  };
  const out: string[] = [
    `<defs><radialGradient id="sky-bg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#16244a"/><stop offset="1" stop-color="#070d1f"/></radialGradient></defs><rect width="${W}" height="${H}" rx="8" fill="url(#sky-bg)"/>`,
    `<path d="${path({ type: "MultiLineString", coordinates: Array.from({ length: 12 }, (_, i) => Array.from({ length: 37 }, (_, j) => [i * 30 - 180, j * 5 - 90])).concat(Array.from({ length: 11 }, (_, i) => Array.from({ length: 73 }, (_, j) => [j * 5 - 180, i * 15 - 75]))) }) ?? ""}" fill="none" stroke="#5a6f9e" stroke-opacity="0.25" stroke-width="0.7"/>`,
  ];
  if (spec.lines) out.push(`<g fill="none" stroke="#7d93c4" stroke-opacity="0.55" stroke-width="${fx(1.1 * k)}">${Object.keys(LINES).map(consLines).join("")}</g>`);
  const dots: string[] = [];
  for (const [x, y, m] of STARS) {
    if (m > spec.magnitude) continue;
    const p = pt([x, y]);
    if (!p || p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) continue;
    dots.push(`<circle cx="${p[0]}" cy="${p[1]}" r="${fx(Math.max(0.7, (spec.magnitude + 1.2 - m) * 0.85) * k)}"/>`);
  }
  out.push(`<g fill="#f4f1e6">${dots.join("")}</g>`);
  if (spec.names !== "none")
    for (const [id, cn] of Object.entries(CONS)) {
      const p = pt(cn.at);
      if (p && p[0] > 30 && p[1] > 20 && p[0] < W - 30 && p[1] < H - 10) out.push(text(p[0], p[1], spec.names === "he" ? cn.he || cn.en : cn.en, "#9fb2dc", 13, 400).replace("<text", `<text data-cons="${id}"`));
    }
  for (const l of spec.layers) {
    const b = l.beat || l.until ? ` ${beatAttrs(String(l.beat ?? 0), l.until ? String(l.until) : undefined)}` : "";
    const col = BRIGHT[l.color];
    let body: string;
    if ("constellation" in l) {
      const id = findCons(l.constellation);
      body = `<g fill="none" stroke="${col}" stroke-width="${fx(2.6 * k)}" stroke-linecap="round">${consLines(id)}</g>`;
    } else if ("star" in l) {
      const s = findStar(l.star);
      const p = pt(s.at);
      if (!p) throw new Error(`${l.star} is outside this view: move "center" or widen "fov"`);
      body = `<circle cx="${p[0]}" cy="${p[1]}" r="${fx(9 * k)}" fill="none" stroke="${col}" stroke-width="${fx(2 * k)}"/>${text(p[0], p[1] - 14 * k, l.label ?? (spec.names === "en" ? s.en : s.he || s.en), col, 15, 600)}`;
    } else if ("path" in l) {
      const pts = l.path.map((q) => lon(q));
      body = `<path d="${path({ type: "LineString", coordinates: pts }) ?? ""}" fill="none" stroke="${col}" stroke-width="${fx(2.2 * k)}"${l.dashed ? ` stroke-dasharray="${fx(8 * k)} ${fx(6 * k)}"` : ""}/>`;
      const mid = pt(pts[Math.floor(pts.length / 2)] as [number, number]);
      if (l.label && mid) body += text(mid[0], mid[1] - 10 * k, l.label, col, 15, 600);
    } else {
      const p = pt(lon(l.at));
      if (!p) throw new Error(`[${l.at.join(", ")}] is outside this view`);
      body = text(p[0], p[1], l.label, col, 16, 600);
    }
    out.push(`<g${b}>${body}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="sans-serif"><g data-own-bg="">${out.join("")}</g></svg>`;
}
