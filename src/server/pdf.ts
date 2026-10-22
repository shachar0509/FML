import { loadImage, PDFDocument, type SKRSContext2D } from "@napi-rs/canvas";

const A4 = [595.28, 841.89] as const;

/** M57: photos of handwritten pages as a PDF, one A4 page each (landscape photos on a landscape page), nothing redrawn. */
export async function imagesToPdf(images: Uint8Array[], title: string): Promise<Buffer> {
  const doc = new PDFDocument({ title, producer: "Shalav", encodingQuality: 85 });
  for (const bytes of images) {
    const img = await loadImage(Buffer.from(bytes));
    const [w, h] = img.width > img.height ? [A4[1], A4[0]] : A4;
    const k = Math.min(w / img.width, h / img.height);
    (doc.beginPage(w, h) as SKRSContext2D).drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
    doc.endPage();
  }
  return doc.close();
}
