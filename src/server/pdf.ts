import { join } from "node:path";
import { loadImage, PDFDocument, type SKRSContext2D } from "@napi-rs/canvas";
import { chromium } from "playwright-core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { nodeDirs } from "@/core/lib/platform";
import { ensureChromium } from "./browser";

const A4 = [595.28, 841.89] as const;

/** M57: photos of handwritten pages as a PDF, one A4 page each (landscape photos on a landscape page), nothing redrawn. */
export async function imagesToPdf(images: Uint8Array[], title: string): Promise<Buffer> {
  const doc = new PDFDocument({ title, producer: "Shalav", encodingQuality: 85 });
  for (const bytes of images) {
    const img = await loadImage(Buffer.from(bytes));
    const [w, h] = img.width > img.height ? [A4[1], A4[0]] : A4;
    const k = Math.min(w / img.width, h / img.height);
    (doc.beginPage(w, h) as SKRSContext2D).drawImage(img, (w - img.width * k) / 2, (h - img.height * k) / 2, img.width * k, img.height * k);
    doc.endPage();
  }
  return doc.close();
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const md = (text: string) =>
  renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm, remarkMath], rehypePlugins: [[rehypeKatex, { output: "mathml", throwOnError: false, strict: "ignore" }]] }, text));

/** M58: the AI's homework solutions as a printable page: each question, then its full solution. Math is MathML (no fonts or CSS to ship). */
export function solutionsHtml(title: string, items: { label: string; statementMd: string; solutionMd: string }[], rtl: boolean, solutionWord: string): string {
  return `<!doctype html><html lang="${rtl ? "he" : "en"}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font-family:"Rubik","Arial Hebrew","Segoe UI",Arial,sans-serif;font-size:11.5pt;line-height:1.6;color:#111}
h1{font-size:20pt;margin:0 0 12pt}h2{font-size:14pt;margin:18pt 0 6pt;break-after:avoid}h3{font-size:12pt;margin:10pt 0 4pt;color:#1f5fbf}
section{break-inside:auto}section+section{border-top:1px solid #ccc;padding-top:6pt}.q{background:#f3f5f7;border-radius:6pt;padding:6pt 10pt}
math{font-size:1.08em;direction:ltr}math[display=block]{margin:6pt 0}pre{white-space:pre-wrap;background:#f6f6f6;padding:6pt;direction:ltr;text-align:left}
table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:2pt 6pt}
</style></head><body><h1>${esc(title)}</h1>${items
    .map((q) => `<section><h2>${esc(q.label)}</h2><div class="q">${md(q.statementMd)}</div><h3>${esc(solutionWord)}</h3>${md(q.solutionMd)}</section>`)
    .join("")}</body></html>`;
}

/** Prints HTML to an A4 PDF with Shalav's own Chromium (the one Moodle import uses; downloaded once, `onInstall` reports %). */
export async function htmlToPdf(html: string, onInstall: (pct: number) => void): Promise<Buffer> {
  const executablePath = await ensureChromium(join(nodeDirs.config ?? "", "browsers"), onInstall);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "15mm", right: "15mm" } });
  } finally {
    await browser.close();
  }
}
