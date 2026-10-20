import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/** `pnpm build:cards` -> dist/cards.html, one self-contained file served as ui://shalav/cards.html. */
export default defineConfig({
  root: "src/cards",
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: "../../dist", emptyOutDir: false, rollupOptions: { input: "src/cards/cards.html" } },
});
