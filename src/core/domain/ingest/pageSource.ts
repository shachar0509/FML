// Real OpenSource (spec 5.4, 5.6, 9.8): PDF, image and txt/md files as numbered pages.
import { fs } from "@/core/lib/fs/fs";
import { join } from "@/core/lib/fs/paths";
import { nodeDirs } from "@/core/lib/platform";
import { bytesToBase64, cropBox, decodeImage, drawTo, encodeCrop, fitImageFile, fitJpeg } from "@/core/lib/images";
import { collapseWs, hasImagePaint, openPdf, pageText, renderPage } from "@/core/lib/pdf";
import type { OpenSource, PageSource, Rendered } from "./types";

const jpeg = (b: Uint8Array): Rendered => ({ base64: bytesToBase64(b), mediaType: "image/jpeg" });

/** Page JPEG cache file; null without a cache dir (no caching). */
export async function cachePath(sha256: string, page: number): Promise<string | null> {
  if (nodeDirs.cache) return join(nodeDirs.cache, "pages", sha256, `p${page}.jpg`);
  return null;
}

export async function cached(sha256: string, page: number, make: () => Promise<Uint8Array>): Promise<Rendered> {
  const p = await cachePath(sha256, page);
  if (p && (await fs().exists(p))) return jpeg(await fs().readBytes(p));
  const b = await make();
  if (p) {
    await fs().mkdir(p.slice(0, p.lastIndexOf("/")));
    await fs().writeBytes(p, b);
  }
  return jpeg(b);
}

export const openSource: OpenSource = async ({ path, mediaType, sha256 }) => {
  const bytes = await fs().readBytes(path);

  if (mediaType.startsWith("image/")) {
    return {
      pageCount: 1,
      text: async () => "",
      imageNeeded: async () => true,
      image: () => cached(sha256, 1, () => fitImageFile(bytes, mediaType)),
      async crop(_p, bbox) {
        const bmp = await decodeImage(bytes, mediaType);
        const b = cropBox(bmp.width, bmp.height, bbox);
        return encodeCrop(drawTo(bmp, b.w, b.h, b));
      },
      close() {},
    } satisfies PageSource;
  }

  if (mediaType !== "application/pdf") {
    const text = collapseWs(new TextDecoder().decode(bytes));
    const noImage = async (): Promise<never> => {
      throw new Error("Text files have no page image");
    };
    return { pageCount: 1, text: async () => text, imageNeeded: async () => false, image: noImage, crop: noImage, close() {} };
  }

  const doc = await openPdf(bytes);
  return {
    pageCount: doc.numPages,
    async text(n) {
      return pageText(await doc.getPage(n));
    },
    async imageNeeded(n, role) {
      if (role !== "material") return true; // exercises and teacher notes (handwritten marks) are always read as images
      return (await pageText(await doc.getPage(n))).length < 400 || hasImagePaint(await doc.getPage(n));
    },
    image: (n) =>
      cached(sha256, n, async () => {
        const c = await renderPage(await doc.getPage(n), 1568);
        return fitJpeg(c);
      }),
    async crop(n, bbox) {
      const c = await renderPage(await doc.getPage(n), 2400);
      const b = cropBox(c.width, c.height, bbox);
      return encodeCrop(drawTo(c, b.w, b.h, b));
    },
    close() {
      void doc.loadingTask.destroy();
    },
  };
};
