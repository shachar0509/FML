import { z } from "zod";
import { fs } from "@/lib/fs/fs";
import { join } from "@/lib/fs/paths";

export type CatalogEntry = {
  courseNumber: string;
  nameHe: string;
  credits: number;
  faculty: string;
  syllabusHe: string;
  prerequisitesRaw: string;
  semester: string;
};
export interface CatalogSource {
  id: "technion";
  lookup(courseNumber: string): Promise<CatalogEntry | null>;
}

/** Spec 4.1: strip spaces/dashes/dots; 8 digits as-is; 6 digits = legacy -> "0"+d[0..3]+"0"+d[3..6]. */
export function normalizeCourseNumber(input: string): string | null {
  const d = input.replace(/[\s.-]/g, "");
  if (/^\d{8}$/.test(d)) return d;
  if (/^\d{6}$/.test(d)) return `0${d.slice(0, 3)}0${d.slice(3)}`;
  return null;
}

const BASES = [
  "https://raw.githubusercontent.com/michael-maltsev/technion-sap-info-fetcher/gh-pages/",
  "https://sap.cheesefork.cf/",
];
const DAY_MS = 86_400_000;
const CACHE_DAYS = 7;
const SemestersSchema = z.array(z.object({ year: z.number(), semester: z.number() }));
const CoursesSchema = z.array(z.object({ general: z.record(z.string(), z.unknown()) }));

export type CatalogDeps = {
  fetchText: (url: string) => Promise<{ status: number; text: string }>;
  /** appCacheDir()/catalog */
  cacheDir: string;
  now?: () => number;
};

/** Network failures throw; a missing file (404 on every host) returns null. */
async function fetchFile(name: string, d: CatalogDeps): Promise<string | null> {
  const f = fs();
  const path = join(d.cacheDir, name);
  const stamp = `${path}.at`;
  let cached: string | null = null;
  let fresh = false;
  try {
    if (await f.exists(path)) {
      cached = await f.readText(path);
      const at = Number(await f.readText(stamp).catch(() => "0"));
      fresh = (d.now?.() ?? Date.now()) - at < CACHE_DAYS * DAY_MS;
    }
  } catch {
    cached = null;
  }
  if (cached !== null && fresh) return cached;
  let missing = true;
  try {
    for (const base of BASES) {
      const r = await d.fetchText(base + name);
      if (r.status === 200) {
        await f.mkdir(d.cacheDir);
        await f.writeText(path, r.text);
        await f.writeText(stamp, String(d.now?.() ?? Date.now()));
        return r.text;
      }
      if (r.status !== 404) missing = false;
    }
  } catch (e) {
    if (cached !== null) return cached; // offline: any cached copy, regardless of age
    throw e;
  }
  if (cached !== null && !missing) return cached;
  return null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function technionSource(d: CatalogDeps): CatalogSource {
  const read = async <T>(name: string, schema: z.ZodType<T>): Promise<T | null> => {
    const text = await fetchFile(name, d);
    if (text === null) return null;
    const r = schema.safeParse(JSON.parse(text));
    return r.success ? r.data : null;
  };
  return {
    id: "technion",
    async lookup(courseNumber) {
      const recent = (await read("last_semesters.json", SemestersSchema)) ?? [];
      const seen = new Set<string>();
      const order: { year: number; semester: number }[] = [];
      const add = (y: number, s: number) => {
        if (!seen.has(`${y}_${s}`)) {
          seen.add(`${y}_${s}`);
          order.push({ year: y, semester: s });
        }
      };
      [...recent].sort((a, b) => b.year - a.year || b.semester - a.semester).forEach((s) => add(s.year, s.semester));
      const top = recent.reduce((m, s) => Math.max(m, s.year), 2023);
      for (let y = top; y >= 2023; y--) for (const s of [202, 201, 200]) add(y, s);
      for (const { year, semester } of order) {
        const list = await read(`courses_${year}_${semester}.json`, CoursesSchema);
        const hit = list?.find((c) => c.general["מספר מקצוע"] === courseNumber);
        if (!hit) continue;
        const g = hit.general;
        return {
          courseNumber,
          nameHe: str(g["שם מקצוע"]),
          credits: parseFloat(str(g["נקודות"])) || 0,
          faculty: str(g["פקולטה"]),
          syllabusHe: str(g["סילבוס"]),
          prerequisitesRaw: str(g["מקצועות קדם"]),
          semester: `${year}-${semester}`,
        };
      }
      return null;
    },
  };
}

/** App wiring (Tauri only): plugin-http fetch + appCacheDir. Outside Tauri the lookup behaves as offline. */
export async function defaultCatalog(): Promise<CatalogSource> {
  const [{ fetch }, { appCacheDir }] = await Promise.all([import("@tauri-apps/plugin-http"), import("@tauri-apps/api/path")]);
  return technionSource({
    cacheDir: join(await appCacheDir(), "catalog"),
    fetchText: async (url) => {
      const r = await fetch(url);
      return { status: r.status, text: r.status === 200 ? await r.text() : "" };
    },
  });
}
