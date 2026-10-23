import { createCanvas, loadImage } from "@napi-rs/canvas";
import * as z from "zod";
import { openSource } from "@/core/domain/ingest/pageSource";
import { listFileIndexes } from "@/core/domain/ingest/indexStore";
import { coursePaths, join } from "@/core/lib/fs/paths";
import { beatAttrs } from "@/core/render/figures/beats";
import { useSettings } from "@/stores/settings";

/**
 * M81: an annotated course image: a region of a page from the student's files (a painting, a micrograph, a map, a machine),
 * with arrows, circles, boxes and labels by beat. Coordinates are fractions of the whole page (the grid course_page shows Claude);
 * the SVG shows the page image and its viewBox is the crop, so nothing is converted.
 */
const xy = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const box = z.tuple([z.number(), z.number(), z.number(), z.number()]).refine(([a, b, c, d]) => a < c && b < d && Math.min(a, b) >= 0 && Math.max(c, d) <= 1, "a box is [x0, y0, x1, y1] with 0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1");
const tag = { text: z.string().max(60).optional(), color: z.enum(["m-blue", "m-green", "m-pink", "m-orange"]).default("m-pink"), beat: z.number().int().min(0).optional(), until: z.number().int().min(1).optional() };
export const imageSchema = z.object({
  course: z.string(),
  file: z.string(),
  page: z.number().int().min(1).default(1),
  crop: box.optional(),
  marks: z
    .array(
      z.discriminatedUnion("type", [
        z.object({ type: z.literal("arrow"), from: xy, to: xy, ...tag }),
        z.object({ type: z.literal("circle"), at: xy, r: z.number().min(0.005).max(0.5).default(0.05), ...tag }),
        z.object({ type: z.literal("box"), box, ...tag }),
        z.object({ type: z.literal("label"), at: xy, text: z.string().min(1).max(60), color: tag.color, beat: tag.beat, until: tag.until }),
      ]),
    )
    .max(30)
    .default([]),
});

/** The course file by its name (as consult_materials writes it) or its path in the course folder. */
async function courseFile(course: string, file: string) {
  const all = (await listFileIndexes(course)).filter((f) => f.status === "indexed" || f.status === "pending");
  const f = all.find((x) => x.fileName === file || x.relPath === file);
  if (!f) throw new Error(all.length ? `No course file "${file}"; files: ${all.map((x) => x.fileName).join(", ")}` : `No course file "${file}": the course has no scanned files`);
  return f;
}

/** Opens a course file's page source; `run` runs with it open. */
async function withPage<T>(course: string, file: string, page: number, run: (src: Awaited<ReturnType<typeof openSource>>) => Promise<T>): Promise<T> {
  const f = await courseFile(course, file);
  if (page > f.pageCount) throw new Error(`"${file}" has ${f.pageCount} pages`);
  const src = await openSource({ path: join(coursePaths(useSettings.getState().settings.dataRoot, course).course, f.relPath), mediaType: f.mediaType, sha256: f.sha256 });
  try {
    return await run(src);
  } finally {
    src.close();
  }
}

/** The page as a JPEG (the cached page image the indexer also uses) and its size. */
export const pageImage = (course: string, file: string, page: number) =>
  withPage(course, file, page, async (src) => {
    const { base64 } = await src.image(page);
    const img = await loadImage(Buffer.from(base64, "base64"));
    return { base64, w: img.width, h: img.height };
  });

/** The page with a 10 × 10 grid of page fractions, for Claude to choose a crop and place marks (course_page). */
export async function gridImage(course: string, file: string, page: number): Promise<string> {
  const { base64, w, h } = await pageImage(course, file, page);
  const c = createCanvas(w, h);
  const g = c.getContext("2d");
  g.drawImage(await loadImage(Buffer.from(base64, "base64")), 0, 0);
  g.font = `${Math.round(w / 70)}px sans-serif`;
  for (let i = 1; i < 10; i++) {
    g.strokeStyle = i === 5 ? "rgba(220,0,90,.7)" : "rgba(220,0,90,.35)";
    g.lineWidth = i === 5 ? 2 : 1;
    g.beginPath();
    g.moveTo((i * w) / 10, 0);
    g.lineTo((i * w) / 10, h);
    g.moveTo(0, (i * h) / 10);
    g.lineTo(w, (i * h) / 10);
    g.stroke();
    g.fillStyle = "rgb(220,0,90)";
    g.fillText(`.${i}`, (i * w) / 10 + 3, w / 60);
    g.fillText(`.${i}`, 3, (i * h) / 10 - 3);
  }
  return (await c.encode("jpeg", 85)).toString("base64");
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

export async function imageToSvg(source: string): Promise<string> {
  const spec = imageSchema.parse(JSON.parse(source));
  const [x0, y0, x1, y1] = spec.crop ?? [0, 0, 1, 1];
  // a mark placed outside the crop would be cut off without a word
  const inside = ([x, y]: [number, number]) => x >= x0 - 0.005 && x <= x1 + 0.005 && y >= y0 - 0.005 && y <= y1 + 0.005;
  spec.marks.forEach((m, i) => {
    const pts: [number, number][] = m.type === "arrow" ? [m.from, m.to] : m.type === "box" ? [[m.box[0], m.box[1]], [m.box[2], m.box[3]]] : m.type === "circle" ? [[m.at[0] - m.r, m.at[1]], [m.at[0] + m.r, m.at[1]]] : [m.at];
    const out = pts.find((p) => !inside(p));
    if (out) throw new Error(`Mark ${i + 1} (${m.type}) reaches [${out.join(", ")}], outside the crop [${[x0, y0, x1, y1].join(", ")}]: move it or widen the crop (marks are in page fractions)`);
  });
  // a crop comes from the full-resolution page (2400 px for a PDF, the photo's own pixels), not the smaller cached page image
  const pic = await withPage(spec.course, spec.file, spec.page, async (src) => {
    if (!spec.crop) return { ...(await src.image(spec.page)), at: [0, 0, 1, 1] as const, mediaType: "image/jpeg" };
    const { bytes, ext } = await src.crop(spec.page, spec.crop);
    const c = (v: number) => Math.min(1, Math.max(0, v)); // the padding PageSource.crop adds (cropBox's 0.02)
    return { base64: Buffer.from(bytes).toString("base64"), at: [c(x0 - 0.02), c(y0 - 0.02), c(x1 + 0.02), c(y1 + 0.02)] as const, mediaType: ext === "png" ? "image/png" : "image/jpeg" };
  });
  const img = await loadImage(Buffer.from(pic.base64, "base64"));
  // page units: the picture's pixels stretched over the whole page
  const w = img.width / (pic.at[2] - pic.at[0]);
  const h = img.height / (pic.at[3] - pic.at[1]);
  const vw = (x1 - x0) * w;
  const s = vw / 100; // stroke and type scale with the crop, so a mark looks the same at any zoom
  const P = ([x, y]: [number, number]) => [x * w, y * h] as const;
  const label = (x: number, y: number, text: string) => {
    const fs = 3.4 * s;
    const tw = text.length * fs * 0.56 + fs;
    // a paper pill under board ink: reads in both themes, whatever the photo is
    return `<rect class="fig-paper-fill" x="${x - tw / 2}" y="${y - fs * 0.95}" width="${tw}" height="${fs * 1.35}" rx="${fs * 0.4}" opacity="0.92"/><text x="${x}" y="${y}" font-size="${fs}" text-anchor="middle" fill="currentColor" font-weight="600">${esc(text)}</text>`;
  };
  const marks = spec.marks.map((m) => {
    const b = m.beat || m.until ? ` ${beatAttrs(String(m.beat ?? 0), m.until ? String(m.until) : undefined)}` : "";
    // the shape twice: a wide paper halo, then the colour on top
    const both = (d: string) => `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><g class="fig-paper-stroke" stroke-width="${1.6 * s}">${d}</g><g stroke="currentColor" stroke-width="${0.8 * s}">${d}</g></g>`;
    let body: string;
    if (m.type === "arrow") {
      const [[ax, ay], [bx, by]] = [P(m.from), P(m.to)];
      const a = Math.atan2(by - ay, bx - ax);
      const k = 3.2 * s;
      const head = `M${bx - k * Math.cos(a - 0.45)} ${by - k * Math.sin(a - 0.45)}L${bx} ${by}L${bx - k * Math.cos(a + 0.45)} ${by - k * Math.sin(a + 0.45)}`;
      body = both(`<path d="M${ax} ${ay}L${bx} ${by}"/><path d="${head}"/>`) + (m.text ? label(ax, ay + (ay <= by ? -2 * s : 4.4 * s), m.text) : "");
    } else if (m.type === "circle") {
      const [cx, cy] = P(m.at);
      const r = m.r * w;
      body = both(`<circle cx="${cx}" cy="${cy}" r="${r}"/>`) + (m.text ? label(cx, cy - r - 1.6 * s, m.text) : "");
    } else if (m.type === "box") {
      const [[ax, ay], [bx, by]] = [P([m.box[0], m.box[1]]), P([m.box[2], m.box[3]])];
      body = both(`<rect x="${ax}" y="${ay}" width="${bx - ax}" height="${by - ay}" rx="${s}"/>`) + (m.text ? label((ax + bx) / 2, ay - 1.6 * s, m.text) : "");
    } else body = label(...P(m.at), m.text);
    return `<g class="${m.color}"${b}>${body}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 * w} ${y0 * h} ${vw} ${(y1 - y0) * h}"><image href="data:${pic.mediaType};base64,${pic.base64}" x="${pic.at[0] * w}" y="${pic.at[1] * h}" width="${img.width}" height="${img.height}"/>${marks.join("")}</svg>`;
}
