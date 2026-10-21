import { useCallback, useEffect, useRef, useState } from "react";
import { Waiting } from "./Waiting";
import { Check, FileText, FolderOpen, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import type { FileRow, FilesData } from "../types";

type Tool = (name: string, args?: Record<string, unknown>) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
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
  if (f.status === "indexed") return <span className="flex items-center gap-1"><Check className="size-3 text-success" aria-hidden />{t("files.ready")}</span>;
  if (f.status === "failed") return <span className="text-danger" title={f.error ?? ""}>{t("files.failed")}</span>;
  if (f.status === "indexing") return <span className="flex items-center gap-1 text-primary"><Loader2 className="size-3 animate-spin" aria-hidden />{f.total ? t("files.indexingN", { done: f.done ?? 0, total: f.total }) : t("files.indexing")}</span>;
  return <span className="text-muted">{t("files.waiting")}</span>;
}

export function Files({ number, callTool, say, reload }: { number: string; callTool: Tool; say: (t: string) => Promise<void>; reload: () => void }) {
  const { t } = useTranslation();
  const [d, setD] = useState<FilesData | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const r = await callTool("files_list", { number });
    if (!r.isError) setD(r.structuredContent as FilesData);
  }, [callTool, number]);
  useEffect(() => {
    let on = true;
    void callTool("files_list", { number }).then((r) => on && !r.isError && setD(r.structuredContent as FilesData));
    return () => void (on = false);
  }, [callTool, number]);
  const active = !!d && (d.improving?.state === "running" || [...d.materials, ...d.exercises].some((f) => f.status === "indexing"));
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => void refresh(), 2500);
    return () => clearInterval(id);
  }, [active, refresh]);
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
          const r = await callTool("file_upload_chunk", { number, role, name: file.name, index: i, total, data: b64(await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()) });
          const s = r.structuredContent as { done?: boolean; status?: string; error?: string } | undefined;
          if (r.isError || (s?.done && s.status !== "added" && s.status !== "duplicate")) {
            setMsg(t("files.rejected", { name: file.name, error: s?.status ?? s?.error ?? "error" }));
            break;
          }
        }
      }
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  async function start() {
    const r = await callTool("files_start_indexing", { number });
    await refresh();
    if (!r.isError) void say(t("mcp.index"));
  }
  async function improve() {
    await callTool("plan_improve_request", { number });
    await refresh();
    void say(t("mcp.improve"));
  }

  if (!d) return null;
  const zone = (role: Role, title: string, add: string, rows: FileRow[]) => (
    <div className="flex flex-col gap-2 rounded-card border border-dashed border-border bg-card p-3" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void upload(role, [...e.dataTransfer.files]); }}>
      <h3 className="font-medium">{title}</h3>
      {rows.length === 0 && <p className="text-sm text-muted">{t("files.dropHint")}</p>}
      {rows.map((f) => (
        <div key={f.sha} className="flex items-center gap-2 text-sm">
          <FileText className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="flex-1 truncate" dir="auto">{f.name}</span>
          {role === "exercises" && f.status === "indexed" && <span className="text-muted">{t("files.exercisesFound", { count: f.exercises })}</span>}
          <span className="text-muted">{t("files.pages", { count: f.pages })}</span>
          <Chip f={f} />
          <button className="text-muted hover:text-danger" aria-label={`${t("files.remove")} ${f.name}`} onClick={() => void callTool("file_remove", { number, sha: f.sha }).then(refresh)}><Trash2 className="size-4" /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-card border border-border px-3 py-1.5 text-sm hover:bg-border/50">
          {add}
          <input type="file" multiple hidden accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" disabled={busy} onChange={(e) => { void upload(role, [...(e.target.files ?? [])]); e.target.value = ""; }} />
        </label>
        <button className="inline-flex items-center gap-1 text-sm text-primary" onClick={() => void callTool("files_open_folder", { number, role })}><FolderOpen className="size-4" aria-hidden />{t("files.openFolder")}</button>
      </div>
    </div>
  );
  return (
    <section className="flex flex-col gap-3" aria-label={t("files.filter")}>
      <h2 className="text-lg font-bold">{t("files.filter")}</h2>
      {zone("material", t("files.materials"), t("files.addMaterials"), d.materials)}
      {zone("exercises", t("files.exercises"), t("files.addExercises"), d.exercises)}
      {busy && <p className="text-sm text-muted" role="status"><Loader2 className="me-1 inline size-4 animate-spin" aria-hidden />{t("files.uploading")}</p>}
      {msg && <p className="text-sm text-danger" role="alert">{msg}</p>}
      {d.improving?.state === "failed" && <p className="text-sm text-danger" role="alert">{t("courseHome.improveFailed")}</p>}
      {active && <Waiting say={say} />}
      {!d.hasPlan && (d.materials.length > 0 || d.exercises.length > 0) && <p className="text-sm text-muted">{t("files.needPlan")}</p>}
      <div className="flex flex-wrap gap-3">
        <Button disabled={!d.canIndex || active} onClick={() => void start()}>{t("files.start")}</Button>
        <Button variant="outline" disabled={!d.canImprove || active} onClick={() => void improve()}>{t("courseHome.improve")}</Button>
      </div>
    </section>
  );
}
