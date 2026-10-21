import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, cropBox, fitSize } from "./images";
import { collapseWs } from "./pdf";

describe("images", () => {
  it("cropBox pads 2% and clamps to the page", () => {
    expect(cropBox(1000, 500, [0.1, 0.2, 0.5, 0.6])).toEqual({ x: 80, y: 90, w: 440, h: 220 });
    expect(cropBox(1000, 500, [0, 0, 1, 1])).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
  });
  it("fitSize downscales only", () => {
    expect(fitSize(3136, 1568, 1568)).toEqual({ w: 1568, h: 784 });
    expect(fitSize(100, 50, 1568)).toEqual({ w: 100, h: 50 });
  });
  it("base64 round-trips", () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(b))).toEqual(b);
  });
  it("collapseWs", () => expect(collapseWs("  a \n\t b  ")).toBe("a b"));
});
