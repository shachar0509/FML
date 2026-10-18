// Contract between the PDF/image layer (lib/pdf.ts, lib/images.ts), indexing and import (spec 5.2-5.6).

export type Bbox = [number, number, number, number]; // normalized 0..1 (x0,y0,x1,y1)
export type Rendered = { base64: string; mediaType: "image/jpeg" | "image/png" };

/** One opened file (PDF, image, txt/md) viewed as numbered pages (1-based). */
export interface PageSource {
  readonly pageCount: number;
  /** Whitespace-collapsed text of the page (5.4). Empty for images. */
  text(page: number): Promise<string>;
  /** 5.4: <400 chars, or has image paint ops, or role is exercises; never for txt/md. */
  imageNeeded(page: number, role: "material" | "exercises"): Promise<boolean>;
  /** JPEG q0.85, long edge <= 1568 px, disk-cached in appCacheDir()/pages/<sha256>/p<N>.jpg (5.4, 9.8). */
  image(page: number): Promise<Rendered>;
  /** Crop a figure from the page rendered at 2400 px long edge with 2 % padding; PNG bytes (<=1 MB else JPEG 0.9, see `ext`). */
  crop(page: number, bbox: Bbox): Promise<{ bytes: Uint8Array; ext: "png" | "jpg" }>;
  close(): void;
}

export class PasswordProtectedError extends Error {
  constructor() {
    super("Password-protected PDF");
  }
}
export class TooManyPagesError extends Error {
  constructor(public pages: number) {
    super(`PDF has ${pages} pages (max 500)`);
  }
}

/** Opens a file already inside the course folder. Throws PasswordProtectedError / TooManyPagesError. */
export type OpenSource = (file: { path: string; mediaType: string; sha256: string }) => Promise<PageSource>;
