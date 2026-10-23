import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { writeFileIndex } from "@/core/domain/ingest/indexStore";
import { coursePaths } from "@/core/lib/fs/paths";
import { initNode } from "@/server/platform";

/** M81: course 999 with one scanned "textbook page" (the library's heart section on a page with text bars), for image figures in the test host. */
let ready: Promise<void> | undefined;
export const ensureDevCourse = () =>
  (ready ??= (async () => {
    const d = await mkdtemp(join(tmpdir(), "shalav-dev-"));
    Object.assign(process.env, { SHALAV_CONFIG_DIR: join(d, "c"), SHALAV_CACHE_DIR: join(d, "k"), SHALAV_DOCUMENTS_DIR: join(d, "d") });
    const { dataRoot } = await initNode();
    const page = createCanvas(1240, 1754); // A4 at 150 dpi
    const g = page.getContext("2d");
    g.fillStyle = "#fbfaf6";
    g.fillRect(0, 0, 1240, 1754);
    g.fillStyle = "#c9c6bd";
    for (let y = 120; y < 1754 - 100; y += 46) if (y < 420 || y > 1330) g.fillRect(110, y, y % 3 ? 1020 : 760, 16);
    g.drawImage(await loadImage(await readFile(join(import.meta.dirname, "../../assets/biolib/heart-section.svg"))), 270, 460, 700, 840);
    const p = coursePaths(dataRoot, "999");
    await mkdir(p.materials, { recursive: true });
    await writeFile(join(p.materials, "anatomy.png"), page.toBuffer("image/png"));
    const now = new Date().toISOString();
    await writeFileIndex("999", { schema: 1, sha256: "a".repeat(64), fileName: "anatomy.png", relPath: `${p.materials.slice(p.course.length + 1)}/anatomy.png`, role: "material", mediaType: "image/png", pageCount: 1, addedAt: now, status: "indexed", error: null, indexedAt: now, indexModel: null, planVersion: null, materialPages: [], exercises: [] });
  })());
