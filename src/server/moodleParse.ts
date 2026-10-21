/** Pure HTML helpers for Moodle pages (regex, no DOM); selectors live here so a real-site fix is one file. */
export type Link = { url: string; text: string; section: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const abs = (href: string, base: string) => new URL(decode(href), base).href;

/** Course links of a search result page: [{url,text}] with the number-matching ones first. */
export function parseSearch(html: string, base: string, number: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*\/course\/view\.php\?id=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = abs(m[1] as string, base);
    if (!out.some((o) => o.url === url)) out.push({ url, text: strip(m[2] as string) });
  }
  return out.sort((a, b) => Number(b.text.includes(number)) - Number(a.text.includes(number)));
}

/** File-ish links of a course page with their section title: resource / folder views and direct pluginfile links. */
export function parseCourse(html: string, base: string): Link[] {
  const out: Link[] = [];
  const parts = html.split(/(?=<li\b[^>]*\bid="section-\d+")/i);
  for (const part of parts) {
    const section = strip(/data-sectionname="([^"]*)"/i.exec(part)?.[1] ?? /<h[1-6][^>]*class="[^"]*sectionname[^"]*"[^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(part)?.[1] ?? "");
    for (const m of part.matchAll(/<a\b[^>]*href="([^"]*(?:\/mod\/(?:resource|folder)\/view\.php\?id=\d+|pluginfile\.php\/)[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
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
