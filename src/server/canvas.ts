import { createCanvas, loadImage, type Canvas } from "@napi-rs/canvas";
import { setNodeCanvas } from "@/core/lib/images";

/** Route lib/images + lib/pdf through @napi-rs/canvas. Call once at server start. */
export function enableNodeCanvas(): void {
  setNodeCanvas({
    create: (w, h) => createCanvas(w, h) as unknown as HTMLCanvasElement,
    encode: async (c, type, q) => {
      const cv = c as unknown as Canvas;
      return new Uint8Array(type === "image/png" ? await cv.encode("png") : await cv.encode("jpeg", Math.round((q ?? 0.92) * 100)));
    },
    decode: async (bytes) => (await loadImage(Buffer.from(bytes))) as unknown as CanvasImageSource & { width: number; height: number },
  });
}
