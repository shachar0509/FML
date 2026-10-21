// @vitest-environment node
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFPageProxy } from "pdfjs-dist";
import { expect, it } from "vitest";
import { hasImagePaint } from "./pdf";

const page = (ops: [number, unknown[]][]) => ({ getOperatorList: async () => ({ fnArray: ops.map((o) => o[0]), argsArray: ops.map((o) => o[1]) }) }) as unknown as PDFPageProxy;

it("a few-pixel spacer image is not a figure; a real image or a mask is", async () => {
  expect(await hasImagePaint(page([[OPS.paintImageXObject, ["img_p0_1", 2, 2]]]))).toBe(false);
  expect(await hasImagePaint(page([[OPS.paintImageXObject, ["img_p0_1", 2, 2]], [OPS.paintImageXObject, ["img_p0_2", 308, 160]]]))).toBe(true);
  expect(await hasImagePaint(page([[OPS.paintImageMaskXObject, [{}]]]))).toBe(true);
  expect(await hasImagePaint(page([[OPS.save, []]]))).toBe(false);
});
