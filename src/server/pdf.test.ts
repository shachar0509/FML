// @vitest-environment node
import { createCanvas } from "@napi-rs/canvas";
import { expect, it } from "vitest";
import { imagesToPdf } from "./pdf";

it("M57: one A4 page per photo, landscape kept", async () => {
  const jpg = (w: number, h: number) => new Uint8Array(createCanvas(w, h).toBuffer("image/jpeg"));
  const pdf = (await imagesToPdf([jpg(300, 400), jpg(400, 300)], "t")).toString("latin1");
  expect(pdf.startsWith("%PDF")).toBe(true);
  expect(pdf.match(/\/Subtype \/Image/g)?.length).toBe(2); // the photos themselves, not redrawn
  expect(pdf.match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
  expect(pdf.match(/\/MediaBox \[[\d. ]+\]/g)).toEqual(["/MediaBox [0 0 595 842]", "/MediaBox [0 0 842 595]"]);
});
