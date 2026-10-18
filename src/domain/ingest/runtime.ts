import { claude } from "@/claude/runtime";
import { loadCourse } from "@/domain/courses/courses";
import i18n from "@/i18n";
import { coursePaths, join } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { importFiles, scanCourse, type Deps, type Native, type Role } from "./import";
import { listFileIndexes } from "./indexStore";
import { openSource } from "./pageSource";
import { createIndexQueue } from "./queue";

const inv = async <T>(cmd: string, args: Record<string, unknown>) => (await import("@tauri-apps/api/core")).invoke<T>(cmd, args);
const root = () => useSettings.getState().settings.dataRoot;
const lang = () => (i18n.language === "en" ? "en" : "he");

export const native: Native = {
  sha256: (path) => inv("file_sha256", { path }),
  size: async (p) => (await (await import("@tauri-apps/plugin-fs")).stat(p)).size,
  copy: (src, destDir) => inv("import_copy", { src, destDir }),
  heicToJpeg: (src) => inv("heic_to_jpeg", { src }),
  trash: async (path) => {
    await inv("trash_path", { path });
  },
};

export const queue = createIndexQueue({
  gw: () => claude(),
  open: openSource,
  getPlan: async (c) => (await loadCourse(c))?.plan ?? null,
  course: async (c) => (await loadCourse(c))?.course ?? null,
  lang,
  resolve: (c, rec) => join(coursePaths(root(), c).course, rec.relPath),
  confirmLarge: async (rec, tokens) =>
    (await import("@tauri-apps/plugin-dialog")).ask(i18n.t("files.largeConfirm", { name: rec.fileName, pages: rec.pageCount, tokens: tokens.toLocaleString() }), { kind: "warning" }),
});

export const deps = async (): Promise<Deps> => ({
  native,
  open: openSource,
  enqueue: queue.enqueue,
  platform: (await import("@tauri-apps/plugin-os")).platform() === "windows" ? "windows" : "macos",
});

export const importInto = async (course: string, role: Role, files: string[]) => importFiles(course, role, files, await deps());
export const rescan = async (course: string) => scanCourse(course, await deps());

/** App start: pick up files added while closed, then resume pending/indexing records (5.3). */
export async function resumeAll(courses: string[]) {
  for (const c of courses) await rescan(c).catch(() => undefined);
  await queue.resume(courses);
}
export { listFileIndexes };
