import DOMPurify from "dompurify";
import { z } from "zod";

const pair = z.tuple([z.number(), z.number()]);
/** M78: the beat of a slide that brings a part in (it stays after, or until the beat `until`), and a colour shared with the text's \blue{…} etc. */
export const COLORS = ["blue", "green", "pink", "orange"] as const;
export const MAX_BEATS = 16;
const beat = z.number().int().min(1).max(MAX_BEATS).optional();
const tag = { beat, until: beat, color: z.enum(COLORS).optional() };

const plotSchema = z.object({
  title: z.string().optional(),
  xDomain: pair,
  yDomain: pair.optional(),
  grid: z.boolean().optional(),
  data: z.array(
    z.union([
      z.object({
        fn: z.string(),
        label: z.string().optional(),
        range: pair.optional(),
        color: z.string().optional(),
        beat,
        until: beat,
      }),
      z.object({
        points: z.array(pair),
        mode: z.enum(["scatter", "polyline"]),
        label: z.string().optional(),
        beat,
        until: beat,
      }),
      z.object({ vector: pair, offset: pair.optional(), label: z.string().optional(), beat, until: beat }),
    ]),
  ),
  annotations: z
    .array(
      z.union([
        z.object({ x: z.number(), text: z.string().optional(), beat, until: beat }),
        z.object({ y: z.number(), text: z.string().optional(), beat, until: beat }),
      ]),
    )
    .optional(),
});

const ref = z.string();
const endpoint = z.union([ref, pair]);

const geometrySchema = z.object({
  boundingBox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  axis: z.boolean().optional(),
  grid: z.boolean().optional(),
  elements: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("point"),
        id: ref,
        x: z.number(),
        y: z.number(),
        label: z.string().optional(),
        ...tag,
      }),
      z.object({
        type: z.literal("segment"),
        from: ref,
        to: ref,
        label: z.string().optional(),
        dashed: z.boolean().optional(),
        ...tag,
      }),
      z.object({
        type: z.literal("line"),
        through: z.tuple([ref, ref]),
        dashed: z.boolean().optional(),
        ...tag,
      }),
      z.object({
        type: z.literal("arrow"),
        from: endpoint,
        to: endpoint,
        label: z.string().optional(),
        ...tag,
      }),
      z.object({
        type: z.literal("circle"),
        center: ref,
        radius: z.number(),
        dashed: z.boolean().optional(),
        ...tag,
      }),
      z.object({
        type: z.literal("polygon"),
        vertices: z.array(ref),
        fill: z.boolean().optional(),
        ...tag,
      }),
      z.object({
        type: z.literal("angle"),
        points: z.tuple([ref, ref, ref]),
        label: z.string().optional(),
        ...tag,
      }),
      z.object({ type: z.literal("curve"), fn: z.string(), domain: pair, ...tag }),
      z.object({ type: z.literal("text"), x: z.number(), y: z.number(), text: z.string(), ...tag }),
    ]),
  ),
});

export type PlotSpec = z.infer<typeof plotSchema>;
export type GeometrySpec = z.infer<typeof geometrySchema>;

export function parsePlot(src: string): PlotSpec {
  return plotSchema.parse(JSON.parse(src));
}

export function parseGeometry(src: string): GeometrySpec {
  const spec = geometrySchema.parse(JSON.parse(src));
  const ids = new Map<string, number>();
  for (const e of spec.elements) if (e.type === "point") ids.set(e.id, e.beat ?? 0);
  for (const e of spec.elements) {
    const need = (id: string | [number, number]) => {
      if (typeof id !== "string") return;
      if (!ids.has(id)) throw new Error(`Unknown point id: ${id}`);
      if ((ids.get(id) ?? 0) > (e.beat ?? 0)) throw new Error(`A ${e.type} at beat ${e.beat ?? "0 (always shown)"} uses point ${id}, which appears only at beat ${ids.get(id)}`);
    };
    if (e.type === "segment" || e.type === "arrow") [e.from, e.to].forEach(need);
    else if (e.type === "line") e.through.forEach(need);
    else if (e.type === "circle") need(e.center);
    else if (e.type === "polygon") e.vertices.forEach(need);
    else if (e.type === "angle") e.points.forEach(need);
  }
  return spec;
}

const MAX_SVG = 50 * 1024;

/** M81: a server drawing (`max` given) may hold its page image as a PNG/JPEG data URI on <image>; nothing else leaves the SVG. */
const stripExternalHrefs = (server: boolean) => (node: Element) => {
  for (const name of ["href", "xlink:href"]) {
    const v = node.getAttribute(name);
    if (v === null || v.startsWith("#") || (server && node.localName === "image" && /^data:image\/(png|jpeg);base64,/.test(v))) continue;
    node.removeAttribute(name);
  }
};

export function sanitizeSvg(src: string, max?: number): string {
  if (src.length > (max ?? MAX_SVG)) throw new Error(`SVG is larger than ${Math.round((max ?? MAX_SVG) / 1024)} KB`);
  const strip = stripExternalHrefs(max !== undefined);
  DOMPurify.addHook("afterSanitizeAttributes", strip);
  let clean: string;
  try {
    clean = DOMPurify.sanitize(src, {
      USE_PROFILES: { svg: true, svgFilters: false },
      FORBID_TAGS: ["foreignObject", "script", "animate", "animateMotion", "animateTransform", "set"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", strip);
  }
  const t = document.createElement("template");
  t.innerHTML = clean;
  const root = t.content.firstElementChild;
  if (t.content.children.length !== 1 || root?.localName !== "svg") {
    throw new Error("Expected a single <svg> element");
  }
  if (!root.hasAttribute("viewBox")) throw new Error("SVG needs a viewBox");
  return clean;
}
