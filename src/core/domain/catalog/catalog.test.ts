import { beforeEach, describe, expect, it } from "vitest";
import { setFs } from "@/core/lib/fs/fs";
import { memFs } from "@/test/memfs";
import { normalizeCourseNumber, technionSource } from "./catalog";

describe("normalizeCourseNumber", () => {
  it("accepts 8 digits, strips separators, converts legacy 6 digits", () => {
    expect(normalizeCourseNumber("01040195")).toBe("01040195");
    expect(normalizeCourseNumber("0104-01.95")).toBe("01040195");
    expect(normalizeCourseNumber("104195")).toBe("01040195");
    expect(normalizeCourseNumber("12345")).toBeNull();
    expect(normalizeCourseNumber("abcdefgh")).toBeNull();
  });
});

const course = { general: { "מספר מקצוע": "01040195", "שם מקצוע": "חדוא 1", "נקודות": "5.5", "פקולטה": "מתמטיקה", "סילבוס": "s" } };
const files: Record<string, unknown> = {
  "last_semesters.json": [{ year: 2026, semester: 200 }],
  "courses_2026_200.json": [{ general: { "מספר מקצוע": "00000001" } }],
  "courses_2026_202.json": [],
  "courses_2026_201.json": [course],
};

describe("technionSource", () => {
  beforeEach(() => setFs(memFs()));
  const mk = (online: boolean, log: string[] = []) =>
    technionSource({
      cacheDir: "/cache/catalog",
      fetchText: async (url) => {
        log.push(url);
        if (!online) throw new Error("offline");
        const name = url.slice(url.lastIndexOf("/") + 1);
        return name in files ? { status: 200, text: JSON.stringify(files[name]) } : { status: 404, text: "" };
      },
    });

  it("walks semesters newest first and maps fields", async () => {
    const e = await mk(true).lookup("01040195");
    expect(e).toMatchObject({ nameHe: "חדוא 1", credits: 5.5, faculty: "מתמטיקה", prerequisitesRaw: "", semester: "2026-201" });
  });
  it("returns null when not found", async () => {
    expect(await mk(true).lookup("09999999")).toBeNull();
  });
  it("uses the cache when offline, throws when there is none", async () => {
    await mk(true).lookup("01040195");
    expect((await mk(false).lookup("01040195"))?.nameHe).toBe("חדוא 1");
    setFs(memFs());
    await expect(mk(false).lookup("01040195")).rejects.toThrow();
  });
});
