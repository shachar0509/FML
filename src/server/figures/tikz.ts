import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { dvi2html } from "@prinsss/dvi2html";
import opentype from "opentype.js";
import * as library from "node-tikzjax/dist/library.js";

/**
 * M79: TikZ → SVG on the server with node-tikzjax's TeX engine (WebAssembly; LPPL-1.3c). Only its engine (`library.js`) and its
 * files are used: the package's own wrapper needs jsdom, memfs and tar-fs, which do not bundle. Text comes out as <text> in the
 * BaKoMa TeX fonts (glyphs at TeX positions), so it is turned into paths here: the card needs no font.
 */
const here = dirname(fileURLToPath(import.meta.url));
// built server: the assets are staged next to server.mjs (build-server.mjs); dev and tests: node_modules
const pkg = existsSync(join(here, "tikz")) ? join(here, "tikz") : dirname(createRequire(import.meta.url).resolve("node-tikzjax/package.json"));
const TEX = existsSync(join(pkg, "tex")) ? join(pkg, "tex") : pkg;
const TTF = existsSync(join(pkg, "css/bakoma/ttf")) ? join(pkg, "css/bakoma/ttf") : join(pkg, "ttf");

let engine: { core: Uint8Array; wasm: Uint8Array; files: Map<string, Uint8Array> } | undefined;
function load() {
  if (engine) return engine;
  const files = new Map<string, Uint8Array>();
  // ustar: 512-byte header (name at 0, octal size at 124), then the data padded to 512
  const tar = gunzipSync(readFileSync(join(TEX, "tex_files.tar.gz")));
  for (let o = 0; o + 512 <= tar.length && tar[o]; ) {
    const name = tar.toString("latin1", o, o + 100).replace(/\0.*$/s, "").replace(/^\.\//, "");
    const size = parseInt(tar.toString("latin1", o + 124, o + 136).replace(/\0.*$/s, "").trim() || "0", 8);
    if (name && !name.endsWith("/")) files.set(`/tex_files/${name}`, tar.subarray(o + 512, o + 512 + size));
    o += 512 + Math.ceil(size / 512) * 512;
  }
  engine = { core: gunzipSync(readFileSync(join(TEX, "core.dump.gz"))), wasm: gunzipSync(readFileSync(join(TEX, "tex.wasm.gz"))), files };
  return engine;
}

const fonts = new Map<string, opentype.Font>();
const font = (name: string) => {
  let f = fonts.get(name);
  if (!f) fonts.set(name, (f = opentype.parse(readFileSync(join(TTF, `${name.replace(/[^a-z0-9]/gi, "")}.ttf`)).buffer as ArrayBuffer)));
  return f;
};
const unescape = (t: string) => t.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");

/** dvi2html's <text font-family="cmmi10" font-size x y>…</text> → a filled path in the same place. */
export const textToPaths = (svg: string) =>
  svg.replace(/<text\b([^>]*)>([^<]*)<\/text>/g, (_, attrs: string, text: string) => {
    const a = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(attrs)?.[1];
    const fam = a("font-family");
    if (!fam) return "";
    // tikzjax swaps the soft hyphen (TeX position 0x0A, e.g. \Omega) for ¬ in the BaKoMa encoding
    const d = font(fam).getPath(unescape(text).replace(/­/g, "¬"), Number(a("x") ?? 0), Number(a("y") ?? 0), Number(a("font-size") ?? 10)).toPathData(2);
    const keep = attrs.replace(/\s*\b(x|y|font-family|font-size|stroke)="[^"]*"/g, "");
    return d ? `<path${keep} d="${d}"/>` : "";
  });

let queue: Promise<unknown> = Promise.resolve();
/** One TeX run at a time: the engine's state (memory, files) is global. */
export function tikzToSvg(doc: string): Promise<string> {
  const run = queue.then(async () => {
    const { core, wasm, files } = load();
    library.writeFileSync("input.tex", Buffer.from(doc));
    const memory = new WebAssembly.Memory({ initial: library.pages, maximum: library.pages });
    new Uint8Array(memory.buffer, 0, library.pages * 65536).set(core);
    library.setMemory(memory.buffer);
    library.setShowConsole(); // TeX's log goes to console.log, which the run captures for its error message (reset by deleteEverything)
    library.setInput(" input.tex \n\\end\n", undefined);
    let log = "";
    library.setFileLoader(async (name: string) => {
      const f = files.get(name);
      if (!f) throw new Error(`no ${name}`);
      return f;
    });
    const out = console.log;
    console.log = (...m: unknown[]) => void (log += m.join(" ") + "\n"); // the engine prints TeX's log to the console
    try {
      const inst = await WebAssembly.instantiate(wasm, { library, env: { memory } } as unknown as WebAssembly.Imports);
      await library.executeAsync((inst as unknown as { instance: WebAssembly.Instance }).instance.exports);
      let dvi: Uint8Array;
      try {
        dvi = library.readFileSync("input.dvi");
      } catch {
        throw new Error(texError(log) || "TeX produced no drawing");
      }
      let html = "";
      await dvi2html(
        (async function* () {
          yield Buffer.from(dvi);
        })(),
        { write: (c: string | Buffer) => void (html += c.toString()) },
      );
      // dvi2html leaves groups and the <svg> open (the package repaired that with jsdom): close what is open
      const raw = html.replaceAll("&#173;", "&#172;").replace(/<\/svg>\s*$/, "");
      const at = raw.indexOf("<svg");
      if (at < 0) throw new Error("TeX produced no drawing");
      const open = (raw.match(/<g[\s>]/g)?.length ?? 0) - (raw.match(/<\/g>/g)?.length ?? 0);
      const svg = `${raw.slice(at)}${"</g>".repeat(Math.max(0, open))}</svg>`;
      return svg;
    } finally {
      console.log = out;
      library.deleteEverything();
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

/** The first TeX error and its line ("! Undefined control sequence. … l.7 \foo"). */
const texError = (log: string) => {
  const i = log.indexOf("\n!");
  return i < 0 ? "" : log.slice(i + 1, i + 400).split("\n").slice(0, 4).join(" ").replace(/\s+/g, " ").trim();
};
