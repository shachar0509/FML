/** Pure HTML helpers for Moodle pages (regex, no DOM); selectors live here so a real-site fix is one file. */
export type Link = { url: string; text: string; section: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const abs = (href: string, base: string) => new URL(decode(href), base).href;

/** 6-digit Technion numbers are the old form of 8-digit ones (104195 → 01040195). */
const norm = (n: string) => (/^\d{6}$/.test(n) ? `0${n.slice(0, 3)}0${n.slice(3)}` : n);

/** Course numbers in a Moodle course name; a combined course "02340114/7" (or "02340114/02340117") counts for both. */
export function courseNumbers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<!\d)\d{5,8}(?:\s*\/\s*\d{1,8})*(?!\d)/g)) {
    const [first, ...rest] = m[0].split("/").map((x) => x.trim()) as [string, ...string[]];
    out.push(norm(first), ...rest.map((x) => norm(x.length >= first.length ? x : first.slice(0, -x.length) + x)));
  }
  return out;
}

/** What to type in Moodle's course search: without the last digit, so combined courses ("02340114/7") show up too; parseSearch filters. */
export const searchTerm = (number: string) => (/^\d{8}$/.test(number) ? number.slice(0, -1) : number);

/**
 * Courses of a search (or course list) page whose name has the course number. Works on any theme: the page is cut into one block per
 * course (from its first link or onclick to the next course), the name is the block's first heading (Technion tiles), else its text.
 * Order: the main course, then group courses ("קב' 082"), then courses hidden from students.
 */
export function parseSearch(html: string, base: string, number: string): { url: string; text: string }[] {
  const want = norm(number);
  const firsts: { id: string; at: number }[] = [];
  for (const m of html.matchAll(/course\/view\.php\?id=(\d+)/g)) if (!firsts.some((f) => f.id === m[1])) firsts.push({ id: m[1] as string, at: html.lastIndexOf("<", m.index) });
  const out: { url: string; text: string; rank: number }[] = [];
  firsts.forEach((f, i) => {
    const block = html.slice(f.at, firsts[i + 1]?.at ?? html.length);
    const text = strip(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(block)?.[1] ?? block).slice(0, 200);
    if (!courseNumbers(text).includes(want)) return;
    out.push({ url: new URL(`/course/view.php?id=${f.id}`, base).href, text, rank: (/קב'|קבוצה|group/i.test(text) ? 1 : 0) + (/dimmed/.test(block) ? 2 : 0) });
  });
  return out.sort((a, b) => a.rank - b.rank).map(({ url, text }) => ({ url, text }));
}

/** Section pages of a course shown one section per page (Moodle 4: course/section.php?id=…, older: view.php?id=<course>&section=N). */
export function parseSections(html: string, base: string): string[] {
  const id = new URL(base).searchParams.get("id");
  return [...new Set([...html.matchAll(/href="([^"]*\/course\/(?:section\.php\?id=\d+|view\.php\?id=(\d+)[^"]*?[?&;]section=\d+)[^"]*)"/gi)].filter((m) => !m[2] || m[2] === id).map((m) => abs((m[1] as string).split("#")[0] as string, base)))];
}

/** File-ish links of a course page with their section title: resource / folder / assignment / page views and direct pluginfile links. */
export function parseCourse(html: string, base: string): Link[] {
  const out: Link[] = [];
  const parts = html.split(/(?=<li\b[^>]*\bid="section-\d+")/i);
  for (const part of parts) {
    const section = strip(/data-sectionname="([^"]*)"/i.exec(part)?.[1] ?? /<h[1-6][^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(part)?.[1] ?? "");
    for (const m of part.matchAll(/<a\b[^>]*href="([^"]*(?:\/mod\/(?:resource|folder|assign|page)\/view\.php\?id=\d+|pluginfile\.php\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      const url = abs(m[1] as string, base);
      if (!out.some((o) => o.url === url)) out.push({ url, text: strip(m[2] as string).replace(/\s*(?:File|Folder|קובץ|תיקייה)$/i, ""), section });
    }
  }
  return out;
}

/** pluginfile links inside a resource landing page or a folder page. */
export function parsePluginfiles(html: string, base: string): string[] {
  return [...new Set([...html.matchAll(/(?:href|src|data)="([^"]*pluginfile\.php\/[^"]*)"/gi)].map((m) => abs(m[1] as string, base)))];
}

/** Exams and exercise sheets go to the exercises list, everything else is study material. */
export function guessRole(name: string, section: string): "material" | "exercises" {
  return /מבחן|מבחנ|בוחן|בחינ|מועד|תרגיל|תרגול|שיעורי בית|פתרון|exam|midterm|quiz|moed|homework|\bhw\b|exercise|assignment|problem set|sheet|solution/i.test(`${name} ${section}`) ? "exercises" : "material";
}

export function fileName(url: string, disposition: string | undefined): string {
  const cd = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition ?? "")?.[1];
  const raw = cd ?? new URL(url).pathname.split("/").pop() ?? "file";
  let n = raw;
  try {
    n = decodeURIComponent(raw);
  } catch {
    // keep raw
  }
  return n.replace(/[\\/:*?"<>|]/g, "_");
}
