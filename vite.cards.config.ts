import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** KaTeX lists every font as woff2 + woff + ttf; the host webview supports woff2, so keep only that (~3x smaller). */
const katexWoff2Only = {
  name: "katex-woff2-only",
  enforce: "pre" as const,
  transform: (code: string, id: string) =>
    id.includes("katex.min.css") ? code.replace(/,url\([^)]*\.woff\) format\("woff"\)/g, "").replace(/,url\([^)]*\.ttf\) format\("truetype"\)/g, "") : null,
};

/** `pnpm build:cards` -> dist/cards.html, one self-contained file served as ui://shalav/cards.html. */
export default defineConfig({
  root: "src/cards",
  plugins: [katexWoff2Only, react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: [
      // The card bundle renders Markdown + KaTeX only; code highlighting and figures stay in the desktop build.
      { find: /^\.\/CodeBlock$/, replacement: fileURLToPath(new URL("./src/cards/stubs/CodeBlock.tsx", import.meta.url)) },
      { find: /^\.\/Figure$/, replacement: fileURLToPath(new URL("./src/cards/stubs/Figure.tsx", import.meta.url)) },
      { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
    ],
  },
  build: { outDir: "../../dist", emptyOutDir: false, rollupOptions: { input: "src/cards/cards.html" } },
});
