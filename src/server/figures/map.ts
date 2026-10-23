import { geoConicConformal, geoEqualEarth, geoGraticule10, geoMercator, geoNaturalEarth1, geoOrthographic, geoPath, type ExtendedFeature, type GeoGeometryObjects, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-50m.json";
import * as z from "zod";
import { beatAttrs } from "@/core/render/figures/beats";

/** M81: maps from Natural Earth (public domain, via world-atlas 50m) drawn with d3-geo on the server. Layers carry beats; the projection is fitted once, so nothing moves. */
const ll = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const color = z.enum(["m-blue", "m-green", "m-pink", "m-orange"]);
const when = { beat: z.number().int().min(0).optional(), until: z.number().int().min(1).optional() };
export const mapSchema = z.object({
  projection: z.enum(["mercator", "equalEarth", "naturalEarth", "orthographic", "conic"]).default("mercator"),
  region: z.tuple([ll, ll]).optional().describe("[[west, south], [east, north]] in degrees; the map is fitted to it"),
  width: z.number().min(200).max(1200).default(800),
  height: z.number().min(150).max(900).default(520),
  layers: z
    .array(
      z.union([
        z.object({ countries: z.array(z.string()).min(1), color: color.default("m-blue"), label: z.string().max(40).optional(), ...when }),
        z.object({ route: z.array(ll).min(2), color: color.default("m-pink"), arrow: z.boolean().default(true), dashed: z.boolean().default(false), label: z.string().max(40).optional(), ...when }),
        z.object({ points: z.array(z.object({ at: ll, label: z.string().max(40).optional() })).min(1), color: color.default("m-orange"), ...when }),
        z.object({ label: z.string().min(1).max(40), at: ll, size: z.number().min(0.5).max(3).default(1), ...when }),
      ]),
    )
    .max(30)
    .default([]),
});

type Country = ExtendedFeature<GeoGeometryObjects, { name: string }>;
let countries: Country[] | undefined;
const all = () => (countries ??= (feature(world as never, world.objects.countries as never) as unknown as { features: Country[] }).features);
export const countryNames = () => all().map((c) => c.properties.name);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const fx = (n: number) => Math.round(n * 10) / 10;

export function mapToSvg(source: string): string {
  const spec = mapSchema.parse(JSON.parse(source));
  const { width: W, height: H } = spec;
  const byName = new Map(all().map((c) => [c.properties.name.toLowerCase(), c]));
  const find = (n: string) => {
    const c = byName.get(n.toLowerCase());
    if (!c) throw new Error(`Unknown country "${n}"; names like: ${countryNames().filter((x) => x[0]?.toLowerCase() === n[0]?.toLowerCase()).join(", ") || countryNames().slice(0, 40).join(", ")}`);
    return c;
  };
  const [[w, s], [e, n]] = spec.region ?? [[-180, -60], [180, 80]];
  const proj: GeoProjection =
    spec.projection === "conic"
      ? geoConicConformal().rotate([-(w + e) / 2, 0]).parallels([s + (n - s) / 3, n - (n - s) / 3])
      : spec.projection === "orthographic"
        ? geoOrthographic().rotate([-(w + e) / 2, -(s + n) / 2])
        : { mercator: geoMercator, equalEarth: geoEqualEarth, naturalEarth: geoNaturalEarth1 }[spec.projection]();
  // fitted to the region's outline (its corners and edge midpoints), then clipped to the frame
  const frame = { type: "MultiPoint" as const, coordinates: [[w, s], [e, s], [w, n], [e, n], [(w + e) / 2, s], [(w + e) / 2, n], [w, (s + n) / 2], [e, (s + n) / 2]] };
  proj.fitExtent([[10, 10], [W - 10, H - 10]], frame);
  proj.clipExtent([[0, 0], [W, H]]);
  const path = geoPath(proj);
  const at = (p: [number, number]) => (proj(p) ?? [-999, -999]).map(fx) as [number, number];
  const text = (x: number, y: number, t: string, size = 1, cls = "") =>
    `<text${cls ? ` class="${cls}"` : ""} x="${x}" y="${y}" font-size="${fx(W * 0.024 * size)}" text-anchor="middle" fill="currentColor" stroke-width="${fx(W * 0.006)}" paint-order="stroke" stroke-linejoin="round" font-weight="600"><tspan class="fig-paper-stroke">${esc(t)}</tspan></text>`;
  const out: string[] = [
    `<path d="${path(geoGraticule10()) ?? ""}" fill="none" stroke="currentColor" stroke-opacity="0.12" stroke-width="0.6"/>`,
    // land in a soft grey that sits on both boards, borders in the paper colour
    `<g fill="currentColor" fill-opacity="0.16" stroke="currentColor" stroke-opacity="0.45" stroke-width="0.6">${all().map((c) => `<path d="${path(c) ?? ""}"/>`).join("")}</g>`,
  ];
  for (const l of spec.layers) {
    const b = l.beat || l.until ? ` ${beatAttrs(String(l.beat ?? 0), l.until ? String(l.until) : undefined)}` : "";
    let body: string;
    let cls = "";
    if ("countries" in l) {
      cls = l.color;
      const fs = l.countries.map(find);
      body = `<g fill="currentColor" fill-opacity="0.5" stroke="currentColor" stroke-width="1.4">${fs.map((c) => `<path d="${path(c) ?? ""}"/>`).join("")}</g>`;
      if (l.label) body += text(...(path.centroid({ type: "FeatureCollection", features: fs }).map(fx) as [number, number]), l.label);
    } else if ("route" in l) {
      cls = l.color;
      const pts = l.route.map(at);
      const d = `M${pts.map((p) => p.join(" ")).join("L")}`;
      const [p, q] = [pts.at(-2), pts.at(-1)] as [[number, number], [number, number]]; // a route has 2+ points
      const a = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const k = W * 0.02;
      const head = l.arrow ? `<path d="M${fx(q[0] - k * Math.cos(a - 0.45))} ${fx(q[1] - k * Math.sin(a - 0.45))}L${q.join(" ")}L${fx(q[0] - k * Math.cos(a + 0.45))} ${fx(q[1] - k * Math.sin(a + 0.45))}"/>` : "";
      body = `<g fill="none" stroke="currentColor" stroke-width="${fx(W * 0.005)}" stroke-linecap="round" stroke-linejoin="round"${l.dashed ? ` stroke-dasharray="${fx(W * 0.012)} ${fx(W * 0.01)}"` : ""}><path d="${d}"/>${head}</g>`;
      const mid = pts[Math.floor(pts.length / 2)] as [number, number];
      if (l.label) body += text(mid[0], mid[1] - W * 0.015, l.label);
    } else if ("points" in l) {
      cls = l.color;
      body = l.points.map((p) => {
        const [x, y] = at(p.at);
        return `<circle cx="${x}" cy="${y}" r="${fx(W * 0.007)}" fill="currentColor" class="${l.color}"/>${p.label ? text(x, y - W * 0.015, p.label) : ""}`;
      }).join("");
    } else body = text(...at(l.at), l.label, l.size);
    out.push(`<g${cls ? ` class="${cls}"` : ""}${b}>${body}</g>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${out.join("")}</svg>`;
}
