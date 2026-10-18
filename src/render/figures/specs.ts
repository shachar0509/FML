import DOMPurify from "dompurify";
import { z } from "zod";

const pair = z.tuple([z.number(), z.number()]);

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
      }),
      z.object({
        points: z.array(pair),
        mode: z.enum(["scatter", "polyline"]),
        label: z.string().optional(),
      }),
      z.object({ vector: pair, offset: pair.optional(), label: z.string().optional() }),
    ]),
  ),
  annotations: z
    .array(
      z.union([
        z.object({ x: z.number(), text: z.string().optional() }),
        z.object({ y: z.number(), text: z.string().optional() }),
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
      }),
      z.object({
        type: z.literal("segment"),
        from: ref,
        to: ref,
        label: z.string().optional(),
        dashed: z.boolean().optional(),
      }),
      z.object({
        type: z.literal("line"),
        through: z.tuple([ref, ref]),
        dashed: z.boolean().optional(),
      }),
      z.object({
        type: z.literal("arrow"),
        from: endpoint,
        to: endpoint,
        label: z.string().optional(),
      }),
      z.object({
        type: z.literal("circle"),
        center: ref,
        radius: z.number(),
        dashed: z.boolean().optional(),
      }),
      z.object({
        type: z.literal("polygon"),
        vertices: z.array(ref),
        fill: z.boolean().optional(),
      }),
      z.object({
        type: z.literal("angle"),
        points: z.tuple([ref, ref, ref]),
        label: z.string().optional(),
      }),
      z.object({ type: z.literal("curve"), fn: z.string(), domain: pair }),
      z.object({ type: z.literal("text"), x: z.number(), y: z.number(), text: z.string() }),
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
  const ids = new Set<string>();
  for (const e of spec.elements) if (e.type === "point") ids.add(e.id);
  const need = (id: string | [number, number]) => {
    if (typeof id === "string" && !ids.has(id)) throw new Error(`Unknown point id: ${id}`);
  };
  for (const e of spec.elements) {
    if (e.type === "segment" || e.type === "arrow") [e.from, e.to].forEach(need);
    else if (e.type === "line") e.through.forEach(need);
    else if (e.type === "circle") need(e.center);
    else if (e.type === "polygon") e.vertices.forEach(need);
    else if (e.type === "angle") e.points.forEach(need);
  }
  return spec;
}

const MAX_SVG = 50 * 1024;

function stripExternalHrefs(node: Element) {
  for (const name of ["href", "xlink:href"]) {
    if (!node.getAttribute(name)?.startsWith("#") && node.hasAttribute(name)) {
      node.removeAttribute(name);
    }
  }
}

export function sanitizeSvg(src: string): string {
  if (src.length > MAX_SVG) throw new Error("SVG is larger than 50 KB");
  DOMPurify.addHook("afterSanitizeAttributes", stripExternalHrefs);
  let clean: string;
  try {
    clean = DOMPurify.sanitize(src, {
      USE_PROFILES: { svg: true, svgFilters: false },
      FORBID_TAGS: ["foreignObject", "script"],
    });
  } finally {
    DOMPurify.removeHook("afterSanitizeAttributes", stripExternalHrefs);
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
