// Thin pdfjs-dist wrappers (spec 5.4). Browser-only; pdfjs is imported lazily so jsdom tests never load it.
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { newCanvas } from "@/core/lib/images";
import { PasswordProtectedError, TooManyPagesError } from "@/core/domain/ingest/types";

export const MAX_PAGES = 500;

export const collapseWs = (s: string): string => s.replace(/\s+/g, " ").trim();

const pdfjs = async () => {
  // Node (no DOM): the legacy build runs there and finds its own worker.
  if (typeof document === "undefined") return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as typeof import("pdfjs-dist");
  const m = await import("pdfjs-dist");
  m.GlobalWorkerOptions.workerSrc ||= new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  return m;
};

export async function openPdf(data: Uint8Array): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  try {
    // Node: the server points SHALAV_PDF_FONTS at the bundled standard_fonts/ (for PDFs that do not embed Helvetica/Times).
    const fonts = typeof document === "undefined" ? process.env.SHALAV_PDF_FONTS : undefined;
    const doc = await m.getDocument({ data: data.slice(), ...(fonts ? { standardFontDataUrl: fonts } : {}) }).promise; // pdfjs transfers the buffer
    if (doc.numPages > MAX_PAGES) {
      const n = doc.numPages;
      void doc.loadingTask.destroy();
      throw new TooManyPagesError(n);
    }
    return doc;
  } catch (e) {
    if (e instanceof m.PasswordException) throw new PasswordProtectedError();
    throw e;
  }
}

/** Items joined by line (new line on hasEOL or y change), whitespace-collapsed. */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const { items } = await page.getTextContent();
  let out = "";
  let y: number | undefined;
  for (const it of items) {
    if (!("str" in it)) continue;
    const ty = it.transform[5];
    if (y !== undefined && ty !== y) out += " ";
    y = ty;
    out += it.str + (it.hasEOL ? " " : "");
  }
  return collapseWs(out);
}

export async function hasImagePaint(page: PDFPageProxy): Promise<boolean> {
  const { OPS } = await pdfjs();
  const paint = new Set<number>([
    OPS.paintImageXObject,
    OPS.paintInlineImageXObject,
    OPS.paintImageMaskXObject,
    OPS.paintImageXObjectRepeat,
    OPS.paintImageMaskXObjectRepeat,
    OPS.paintInlineImageXObjectGroup,
    OPS.paintSolidColorImageMask,
  ]);
  return (await page.getOperatorList()).fnArray.some((f) => paint.has(f));
}

export async function renderPage(page: PDFPageProxy, longEdge: number): Promise<HTMLCanvasElement> {
  const v1 = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: longEdge / Math.max(v1.width, v1.height) });
  const canvas = newCanvas(Math.round(viewport.width), Math.round(viewport.height));
  await page.render({ canvas, viewport }).promise;
  return canvas;
}
