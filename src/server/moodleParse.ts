/** Pure HTML helpers for Moodle pages (regex, no DOM); selectors live here so a real-site fix is one file. */
export type Link = { url: string; text: string; section: string };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const abs = (href: string, base: string) => new URL(decode(href), base).href;

/** The course number as it can appear in a Moodle course name: as given, and for 8-digit Technion numbers also the old 6-digit form (01040195 → 104195). */
export function numberForms(number: string): string[] {
  return /^0\d{3}0\d{3}$/.test(number) ? [number, number.slice(1, 4) + number.slice(5)] : [number];
}

/** Course links of a search result page whose name contains the course number (other courses and site links are dropped). */
export function parseSearch(html: string, base: string, number: string): { url: string; text: string }[] {
  const out: { url: string; text: string }[] = [];
  const re = new RegExp(`(?<!\\d)(?:${numberForms(number).join("|")})(?!\\d)`);
  for (const m of html.matchAll(/<a\b[^>]*href="([^"]*\/course\/view\.php\?id=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = abs(m[1] as string, base);
    const text = strip(m[2] as string);
    if (re.test(text) && !out.some((o) => new URL(o.url).searchParams.get("id") === new URL(url).searchParams.get("id"))) out.push({ url, text });
  }
  return out;
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
