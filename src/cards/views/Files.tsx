import { useCallback, useEffect, useRef, useState } from "react";
import { Check, FileText, FolderOpen, Loader2, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import type { FileRow, FilesData } from "../types";
import { h2, panel } from "../ui";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type Role = "material" | "exercises";
const CHUNK = 2 * 1024 * 1024; // raw bytes; base64 stays under the 4 MB tool limit

const b64 = (buf: ArrayBuffer) => {
  let s = "";
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  return btoa(s);
};

function Chip({ f }: { f: FileRow }) {
  const { t } = useTranslation();
  const pill = "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
  if (f.status === "indexed")
    return (
      <span className={`${pill} bg-success/10 text-success`}>
        <Check className="size-3" aria-hidden />
        {t("files.ready")}
      </span>
    );
  if (f.status === "failed")
    return (
      <span className={`${pill} bg-danger/10 text-danger`} title={f.error ?? ""}>
        {t("files.failed")}
      </span>
    );
  if (f.status === "indexing")
    return (
      <span className={`${pill} bg-primary/10 text-primary`}>
        <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
        {f.total
          ? t("files.indexingN", { done: f.done ?? 0, total: f.total })
          : t("files.indexing")}
      </span>
    );
  return <span className={`${pill} bg-border/60 text-muted`}>{t("files.waiting")}</span>;
}

export function Files({
  number,
  callTool,
  reload,
  live = false,
}: {
  number: string;
  callTool: Tool;
  reload: () => void;
  /** a plan build is running: follow the indexing statuses */
  live?: boolean;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<FilesData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const refresh = useCallback(async () => {
    const r = await callTool("files_list", { number });
    if (!r.isError) setD(r.structuredContent as FilesData);
  }, [callTool, number]);
  useEffect(() => {
    let on = true;
    void callTool("files_list", { number }).then(
      (r) => on && !r.isError && setD(r.structuredContent as FilesData),
    );
    return () => void (on = false);
  }, [callTool, number]);
  const active = !!d && [...d.materials, ...d.exercises].some((f) => f.status === "indexing");
  const moodleBusy = !!d?.moodle?.busy;
  useEffect(() => {
    if (!active && !moodleBusy && !live) return;
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [active, moodleBusy, live, refresh]);
  const wasActive = useRef(false);
  useEffect(() => {
    if (wasActive.current && !active) reload(); // plan may have changed
    wasActive.current = active;
  }, [active, reload]);

  async function upload(role: Role, files: File[]) {
    setBusy(true);
    setMsg(null);
    try {
      for (const file of files) {
        const total = Math.max(1, Math.ceil(file.size / CHUNK));
        for (let i = 0; i < total; i++) {
          const r = await callTool("file_upload_chunk", {
            number,
            role,
            name: file.name,
            index: i,
            total,
            data: b64(await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()),
          });
          const s = r.structuredContent as
            { done?: boolean; status?: string; error?: string } | undefined;
          if (r.isError || (s?.done && s.status !== "added" && s.status !== "duplicate")) {
            setMsg(
              t("files.rejected", { name: file.name, error: s?.status ?? s?.error ?? "error" }),
            );
            break;
          }
        }
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function importMoodle() {
    setMsg(null);
    const r = await callTool("moodle_import", {
      number,
      ...(url.trim() ? { url: url.trim() } : {}),
    });
    if (r.isError)
      setMsg((r.structuredContent as { error?: string } | undefined)?.error ?? t("moodle.failed"));
    await refresh();
  }

  if (!d) return null;
  const zone = (role: Role, title: string, add: string, rows: FileRow[]) => (
    <div
      className={`${panel} flex flex-col gap-2 p-4`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(role, [...e.dataTransfer.files]);
      }}
    >
      <h3 className="font-medium">{title}</h3>
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted">
          {t("files.dropHint")}
        </p>
      )}
      {rows.map((f) => (
        <div
          key={f.sha}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-sm first-of-type:border-t-0 first-of-type:pt-0"
        >
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {f.name}
          </span>
          {role === "exercises" && f.status === "indexed" && (
            <span className="text-xs text-muted">
              {t("files.exercisesFound", { count: f.exercises })}
            </span>
          )}
          <span className="text-xs text-muted">{t("files.pages", { count: f.pages })}</span>
          <Chip f={f} />
          <button
            className="rounded text-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={`${t("files.remove")} ${f.name}`}
            onClick={() => void callTool("file_remove", { number, sha: f.sha }).then(refresh)}
          >
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium shadow-sm hover:bg-border/50 has-focus-visible:outline-2 has-focus-visible:outline-primary">
          <Upload className="size-4" aria-hidden />
          {add}
          <input
            type="file"
            multiple
            hidden
            accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
            disabled={busy}
            onChange={(e) => {
              void upload(role, [...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="inline-flex items-center gap-1 rounded text-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary"
          onClick={() => void callTool("files_open_folder", { number, role })}
        >
          <FolderOpen className="size-4" aria-hidden />
          {t("files.openFolder")}
        </button>
      </div>
    </div>
  );
  return (
    <section className="flex flex-col gap-3" aria-label={t("files.filter")}>
      <h2 className={h2}>{t("files.filter")}</h2>
      {zone("material", t("files.materials"), t("files.addMaterials"), d.materials)}
      {zone("exercises", t("files.exercises"), t("files.addExercises"), d.exercises)}
      {d.moodle && (
        <div className={`${panel} flex flex-col gap-2 p-4`}>
          <h3 className="font-medium">{t("moodle.title")}</h3>
          <p className="text-sm text-muted">{t("moodle.hint")}</p>
          {!d.moodle.url && (
            <Input
              dir="ltr"
              type="url"
              placeholder="https://moodle.example.ac.il/"
              aria-label={t("moodle.url")}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}
          {d.moodle.busy && (
            <p className="text-sm text-muted" role="status">
              <Loader2 className="me-1 inline size-4 animate-spin" aria-hidden />
              {t(d.moodle.busy === "login" ? "moodle.login" : "moodle.syncing")}
            </p>
          )}
          {!d.moodle.busy && d.moodle.last?.error && (
            <p className="text-sm text-danger" role="alert">
              {d.moodle.last.error}
            </p>
          )}
          {!d.moodle.busy && d.moodle.last && !d.moodle.last.error && (
            <p className="text-sm" role="status">
              {t("moodle.done", d.moodle.last)}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              disabled={busy || !!d.moodle.busy || (!d.moodle.url && !url.trim())}
              onClick={() => void importMoodle()}
            >
              {t("moodle.import")}
            </Button>
            {d.moodle.connected && !d.moodle.busy && (
              <button
                className="text-sm text-muted hover:text-danger"
                onClick={() => void callTool("moodle_disconnect").then(refresh)}
              >
                {t("moodle.forget")}
              </button>
            )}
          </div>
        </div>
      )}
      {busy && (
        <p className="text-sm text-muted" role="status">
          <Loader2 className="me-1 inline size-4 animate-spin" aria-hidden />
          {t("files.uploading")}
        </p>
      )}
      {msg && (
        <p className="text-sm text-danger" role="alert">
          {msg}
        </p>
      )}
    </section>
  );
}
