import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CARDS_URI = "ui://shalav/cards.html";

/** Next to server.mjs in the bundle (dist/), or ../../dist when run from source. SHALAV_CARDS_HTML overrides. */
export async function readCards(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const tries = [process.env.SHALAV_CARDS_HTML, join(here, "cards.html"), join(here, "../../dist/cards.html")].filter((p): p is string => !!p);
  for (const p of tries) {
    try {
      return await readFile(p, "utf8");
    } catch {
      /* next */
    }
  }
  throw new Error("cards.html not found; run pnpm build:cards");
}
