/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** M79: the card test host draws server figures (TikZ, the biology library) with the real renderer. Dev server only. */
const figures: Plugin = {
  name: "shalav-figures",
  configureServer(server) {
    server.middlewares.use("/__figure", (req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", async () => {
        const { kind, source } = JSON.parse(body) as { kind: string; source: string };
        const { renderFigure } = (await server.ssrLoadModule("/src/server/figures/render.ts")) as typeof import("./src/server/figures/render");
        if (kind === "image") await ((await server.ssrLoadModule("/e2e/fixtures/devCourse.ts")) as typeof import("./e2e/fixtures/devCourse")).ensureDevCourse();
        res.setHeader("content-type", "application/json");
        try {
          res.end(JSON.stringify({ structuredContent: { svg: await renderFigure(kind as "tikz", source) } }));
        } catch (e) {
          res.end(JSON.stringify({ isError: true, structuredContent: { error: String(e) } }));
        }
      });
    });
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), figures],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: { reporters: ["dot"], exclude: ["e2e/**", "node_modules/**"], environment: "jsdom", globals: true, setupFiles: ["src/test/setup.ts"] },
});
