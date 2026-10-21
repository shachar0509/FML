import { FileIndexSchema, type FileIndex } from "@/core/domain/dataSchemas";
import { readJsonFile, writeJsonAtomic } from "@/core/lib/fs/atomicWrite";
import { fs } from "@/core/lib/fs/fs";
import { coursePaths } from "@/core/lib/fs/paths";
import { useSettings } from "@/stores/settings";

const paths = (course: string) => coursePaths(useSettings.getState().settings.dataRoot, course);

export const readFileIndex = (course: string, sha256: string) => readJsonFile(paths(course).indexFile(sha256), FileIndexSchema);
export const writeFileIndex = (course: string, rec: FileIndex) => writeJsonAtomic(paths(course).indexFile(rec.sha256), rec);

export async function listFileIndexes(course: string): Promise<FileIndex[]> {
  const dir = paths(course).indexFiles;
  if (!(await fs().exists(dir))) return [];
  const out = await Promise.all(
    (await fs().readDir(dir)).filter((e) => e.isFile && e.name.endsWith(".json")).map((e) => readFileIndex(course, e.name.slice(0, -5))),
  );
  return out.filter((r): r is FileIndex => !!r).sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}
