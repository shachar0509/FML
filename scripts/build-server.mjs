import { copyFile, cp } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/server/main.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  external: ["@napi-rs/canvas", "playwright-core"],
  // bundled CJS deps (e.g. pdfjs) need require()
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: "info",
});

await cp("node_modules/pdfjs-dist/standard_fonts", "dist/standard_fonts", { recursive: true });
// pdfjs (legacy build) imports its worker next to the file that bundles it.
await copyFile("node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", "dist/pdf.worker.mjs");
// M79: the TeX engine's files and the BaKoMa fonts (TikZ text becomes paths), and the biology library (src/server/figures)
await cp("node_modules/node-tikzjax/tex", "dist/tikz/tex", { recursive: true, dereference: true });
await cp("node_modules/node-tikzjax/css/bakoma/ttf", "dist/tikz/ttf", { recursive: true, dereference: true });
await cp("assets/biolib", "dist/biolib", { recursive: true });
