// Image helpers (spec 9.8, 5.6). Pure parts are tested; canvas parts are browser-only.
import type { Bbox } from "@/domain/ingest/types";

export type Px = { x: number; y: number; w: number; h: number };
type Src = CanvasImageSource & { width: number; height: number };

/** Normalized bbox + padding, clamped to the page, in whole pixels. */
export function cropBox(w: number, h: number, [x0, y0, x1, y1]: Bbox, pad = 0.02): Px {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  const l = Math.floor(c(x0 - pad) * w);
  const t = Math.floor(c(y0 - pad) * h);
  return { x: l, y: t, w: Math.max(1, Math.ceil(c(x1 + pad) * w) - l), h: Math.max(1, Math.ceil(c(y1 + pad) * h) - t) };
}

/** Downscale so the long edge <= longEdge; never upscale. */
export function fitSize(w: number, h: number, longEdge: number): { w: number; h: number } {
  const k = Math.min(1, longEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

export function bytesToBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
export const base64ToBytes = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Node server hook (server/canvas.ts): @napi-rs/canvas instead of the DOM. */
export type NodeCanvas = {
  create(w: number, h: number): HTMLCanvasElement;
  encode(c: HTMLCanvasElement, type: string, q?: number): Promise<Uint8Array>;
  decode(bytes: Uint8Array): Promise<Src>;
};
let node: NodeCanvas | null = null;
export const setNodeCanvas = (n: NodeCanvas): void => {
  node = n;
};
export const newCanvas = (w: number, h: number): HTMLCanvasElement => {
  if (node) return node.create(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
/** Decode image bytes to something drawImage accepts (browser: ImageBitmap). */
export const decodeImage = async (bytes: Uint8Array, mediaType: string): Promise<Src> =>
  node ? node.decode(bytes) : createImageBitmap(new Blob([bytes as BlobPart], { type: mediaType }));

const toBytes = (c: HTMLCanvasElement, type: string, q?: number) =>
  node ? node.encode(c, type, q) : new Promise<Uint8Array>((res, rej) =>
    c.toBlob((b) => (b ? b.arrayBuffer().then((a) => res(new Uint8Array(a)), rej) : rej(new Error("encode failed"))), type, q),
  );

/** Draw `src` (optionally a sub-rect) to a new canvas of the given size. */
export function drawTo(src: Src, w: number, h: number, from?: Px): HTMLCanvasElement {
  const c = newCanvas(w, h);
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context");
  if (from) g.drawImage(src, from.x, from.y, from.w, from.h, 0, 0, w, h);
  else g.drawImage(src, 0, 0, w, h);
  return c;
}

/** 9.8: long edge <= longEdge, JPEG q (0.85); > 4.5 MB re-encodes at 0.7. */
export async function fitJpeg(src: Src, longEdge = 1568, quality = 0.85): Promise<Uint8Array> {
  const { w, h } = fitSize(src.width, src.height, longEdge);
  const c = drawTo(src, w, h);
  const out = await toBytes(c, "image/jpeg", quality);
  return out.length > 4.5e6 ? toBytes(c, "image/jpeg", 0.7) : out;
}

/** 5.6/9.8: PNG unless > 1 MB, then JPEG 0.9. */
export async function encodeCrop(c: HTMLCanvasElement): Promise<{ bytes: Uint8Array; ext: "png" | "jpg" }> {
  const png = await toBytes(c, "image/png");
  return png.length <= 1e6 ? { bytes: png, ext: "png" } : { bytes: await toBytes(c, "image/jpeg", 0.9), ext: "jpg" };
}

export async function fitImageFile(bytes: Uint8Array, mediaType: string, longEdge = 1568): Promise<Uint8Array> {
  const bmp = await decodeImage(bytes, mediaType);
  try {
    return await fitJpeg(bmp, longEdge);
  } finally {
    (bmp as Partial<ImageBitmap>).close?.();
  }
}
