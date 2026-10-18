import type { LoadImage } from "@/domain/learn/context";
import { fs } from "@/lib/fs/fs";
import { coursePaths } from "@/lib/fs/paths";
import { sha256Hex } from "@/lib/hash";
import { bytesToBase64, fitImageFile } from "@/lib/images";
import { useSettings } from "@/stores/settings";

const dir = (n: string) => coursePaths(useSettings.getState().settings.dataRoot, n).attachments;

/** Chat attachment: image -> JPEG (long edge 1568) stored by content hash. */
export async function saveAttachment(courseNumber: string, file: File): Promise<{ type: "image_ref"; sha256: string; mediaType: "image/jpeg" }> {
  if (!file.type.startsWith("image/")) throw new Error("pdf attachments are added in the next update");
  const bytes = await fitImageFile(new Uint8Array(await file.arrayBuffer()), file.type);
  const sha256 = await sha256Hex(bytes);
  await fs().mkdir(dir(courseNumber));
  await fs().writeBytes(`${dir(courseNumber)}/${sha256}.jpg`, bytes);
  return { type: "image_ref", sha256, mediaType: "image/jpeg" };
}

export const loadImageB64 = (courseNumber: string): LoadImage => async (sha) => {
  for (const ext of ["jpg", "png"]) {
    const p = `${dir(courseNumber)}/${sha}.${ext}`;
    if (await fs().exists(p)) return bytesToBase64(await fs().readBytes(p));
  }
  throw new Error(`attachment ${sha} not found`);
};
