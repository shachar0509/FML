import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import type { Host } from "../types";

export type FileRef = { sha256: string; mediaType: string; name: string };

const b64 = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });
/** Phone photos are shrunk here (long edge 1568) so the upload stays small; anything the browser cannot decode goes as-is. */
async function prep(f: File): Promise<{ mime: string; base64: string }> {
  if (f.type.startsWith("image/"))
    try {
      const bm = await createImageBitmap(f);
      const k = Math.min(1, 1568 / Math.max(bm.width, bm.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bm.width * k);
      c.height = Math.round(bm.height * k);
      c.getContext("2d")?.drawImage(bm, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (blob) return { mime: "image/jpeg", base64: await b64(blob) };
    } catch {
      /* fall through */
    }
  return { mime: f.type, base64: await b64(f) };
}
const accepted = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";

/**
 * A solution solved on paper: photos or a PDF, dropped on the zone or picked with the button, stored as course
 * attachments (attachment_upload; a PDF becomes one image per page). The chips list what will be sent.
 */
export function AnswerFiles({
  number,
  callTool,
  files,
  setFiles,
  disabled,
  onBusy,
  hint,
}: {
  number: string;
  callTool: Host["callTool"];
  files: FileRef[];
  setFiles: (f: (x: FileRef[]) => FileRef[]) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
  hint: string;
}) {
  const { t } = useTranslation();
  const pick = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false);
  const [err, setErr] = useState(false);
  const [over, setOver] = useState(false);
  const busy = (b: boolean) => (setUp(b), onBusy?.(b));

  async function add(list: File[]) {
    busy(true);
    setErr(false);
    for (const f of list) {
      if (!accepted(f)) {
        setErr(true);
        continue;
      }
      const p = await prep(f);
      const r = await callTool("attachment_upload", { number, name: f.name, mime: p.mime, base64: p.base64 });
      const got = (r.structuredContent as { files?: { sha256: string; mediaType: string }[] } | undefined)?.files;
      if (r.isError || !got) setErr(true);
      else
        setFiles((x) => [
          ...x,
          ...got
            .filter((g) => !x.some((y) => y.sha256 === g.sha256))
            .map((g, i) => ({ ...g, name: got.length > 1 ? `${f.name} ${i + 1}` : f.name })),
        ]);
    }
    busy(false);
  }

  return (
    <div
      className={`flex flex-col gap-2 rounded-card border-2 border-dashed bg-card/60 p-4 transition-colors ${over ? "border-primary bg-primary/5" : "border-border"}`}
      onDragOver={(e) => {
        if (disabled || up) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && !up) void add(Array.from(e.dataTransfer.files));
      }}
    >
      <p className="flex items-center gap-2 text-sm text-muted">
        <ImagePlus className="size-4 shrink-0" aria-hidden />
        {hint}
      </p>
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => (
            <li key={f.sha256} className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs">
              {f.name}
              <button
                className="rounded-full text-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-primary"
                aria-label={`${t("files.remove")} ${f.name}`}
                onClick={() => setFiles((x) => x.filter((y) => y.sha256 !== f.sha256))}
              >
                <X className="size-3" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {t("exercise.failed")}
        </p>
      )}
      <input
        ref={pick}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <Button variant="outline" className="self-start" disabled={disabled || up} onClick={() => pick.current?.click()}>
        <ImagePlus className="size-4" aria-hidden />
        {up ? t("learn.uploading") : t("exercise.upload")}
      </Button>
    </div>
  );
}
