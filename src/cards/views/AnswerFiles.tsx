import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import type { Host } from "../types";
import { b64, CHUNK, Importing } from "./Files";

export type FileRef = { sha256: string; mediaType: string; name: string };
type Stored = { sha256: string; mediaType: string }[];

/** Phone photos are shrunk here (long edge 1568) so the upload stays small; anything the browser cannot decode goes as-is. */
async function prep(f: File): Promise<{ mime: string; blob: Blob }> {
  if (f.type.startsWith("image/"))
    try {
      const bm = await createImageBitmap(f);
      const k = Math.min(1, 1568 / Math.max(bm.width, bm.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bm.width * k);
      c.height = Math.round(bm.height * k);
      c.getContext("2d")?.drawImage(bm, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (blob) return { mime: "image/jpeg", blob };
    } catch {
      /* fall through */
    }
  return { mime: f.type, blob: f };
}
const accepted = (f: File) => f.type.startsWith("image/") || f.type === "application/pdf";
const uploadId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** One prepared file in 2 MB chunks (attachment_upload_chunk); the last chunk's reply holds the stored pages. null = failed. */
async function send(callTool: Host["callTool"], number: string, name: string, mime: string, blob: Blob, sent: (bytes: number) => void): Promise<Stored | null> {
  const id = uploadId();
  const parts = Math.max(1, Math.ceil(blob.size / CHUNK));
  for (let i = 0; i < parts; i++) {
    const data = b64(await blob.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer());
    const r = await callTool("attachment_upload_chunk", { number, id, name, mime, index: i, total: parts, data });
    if (r.isError) return null;
    sent(Math.min(CHUNK, blob.size - i * CHUNK));
    if (i === parts - 1) return (r.structuredContent as { files?: Stored } | undefined)?.files ?? null;
  }
  return null;
}

/**
 * A solution solved on paper: photos or a PDF, dropped on the zone or picked with the button, stored as course
 * attachments (attachment_upload_chunk; a PDF becomes one image per page). The chips list what will be sent.
 */
export function AnswerFiles({
  number,
  callTool,
  files,
  setFiles,
  disabled,
  onBusy,
  hint,
  button,
}: {
  number: string;
  callTool: Host["callTool"];
  files: FileRef[];
  setFiles: (f: (x: FileRef[]) => FileRef[]) => void;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
  hint: string;
  /** the upload button's text (default "Upload solution") */
  button?: string;
}) {
  const { t } = useTranslation();
  const pick = useRef<HTMLInputElement>(null);
  const [up, setUp] = useState(false);
  const [err, setErr] = useState(false);
  const [over, setOver] = useState(false);
  const [sent, setSent] = useState<{ done: number; total: number } | null>(null); // upload bytes
  const busy = (b: boolean) => (setUp(b), onBusy?.(b));

  async function add(list: File[]) {
    busy(true);
    setErr(false);
    try {
      const ok = list.filter(accepted);
      if (ok.length < list.length) setErr(true);
      const ready: { f: File; mime: string; blob: Blob }[] = [];
      for (const f of ok) ready.push({ f, ...(await prep(f)) });
      const total = ready.reduce((n, p) => n + p.blob.size, 0);
      let done = 0;
      setSent({ done, total });
      for (const { f, mime, blob } of ready) {
        const got = await send(callTool, number, f.name, mime, blob, (n) => setSent({ done: (done += n), total })).catch(() => null);
        if (!got) setErr(true);
        else
          setFiles((x) => [
            ...x,
            ...got
              .filter((g) => !x.some((y) => y.sha256 === g.sha256))
              .map((g, i) => ({ ...g, name: got.length > 1 ? `${f.name} ${i + 1}` : f.name })),
          ]);
      }
    } finally {
      setSent(null);
      busy(false);
    }
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
      {sent && sent.total > 0 && <Importing {...sent} label={t("learn.uploading")} />}
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
        {up ? t("learn.uploading") : (button ?? t("exercise.upload"))}
      </Button>
    </div>
  );
}
