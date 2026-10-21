import { normalizeCourseNumber } from "@/core/domain/catalog/catalog";

export const UNIVERSITY_IDS = ["technion", "huji", "reichman", "braude"] as const;
export type UniversityId = (typeof UNIVERSITY_IDS)[number];

/** Safe as a folder name; every university's course ids fit it (Technion's are 8 digits). */
export const COURSE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,31}$/;

export type University = {
  id: UniversityId;
  nameEn: string;
  nameHe: string;
  /** Shown as the course number placeholder. */
  example: string;
  /** Start page for the Moodle login; null = the student pastes their own address (not verified for every campus). */
  moodleUrl: string | null;
  /** Only the Technion has an online catalog source; the others use manual entry. */
  catalog: boolean;
  normalize(input: string): string | null;
};

// ponytail: formats of HUJI / Reichman / Braude are unverified, so they accept any short alphanumeric code; tighten per university once real numbers are known.
const loose = (input: string) => {
  const c = input.replace(/\s+/g, "").toUpperCase();
  return COURSE_ID_RE.test(c) ? c : null;
};

export const UNIVERSITIES: Record<UniversityId, University> = {
  technion: { id: "technion", nameEn: "Technion", nameHe: "הטכניון", example: "01040195", moodleUrl: "https://moodle.technion.ac.il/", catalog: true, normalize: normalizeCourseNumber },
  huji: { id: "huji", nameEn: "Hebrew University", nameHe: "האוניברסיטה העברית", example: "80131", moodleUrl: null, catalog: false, normalize: loose },
  reichman: { id: "reichman", nameEn: "Reichman University", nameHe: "אוניברסיטת רייכמן", example: "10101", moodleUrl: null, catalog: false, normalize: loose },
  braude: { id: "braude", nameEn: "Braude College", nameHe: "מכללת בראודה", example: "20101", moodleUrl: null, catalog: false, normalize: loose },
};

// The chosen university (stored once in shalav.json, see lib/firstRun.ts); prompts and tools read it from here.
let current: UniversityId | null = null;
export const setUniversity = (id: UniversityId | null) => void (current = id);
export const university = (): University | null => (current ? UNIVERSITIES[current] : null);
/** English name for prompts; "the university" before a choice exists. */
export const uniName = () => university()?.nameEn ?? "the university";
