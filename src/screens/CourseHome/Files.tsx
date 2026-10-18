import { useCallback, useEffect, useRef, useState } from "react";
import { FilePlus, MoreVertical } from "lucide-react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toaster";
import type { FileIndex } from "@/domain/dataSchemas";
import { PICKER_EXTENSIONS, reindex, removeFile, type ImportOutcome, type Role } from "@/domain/ingest/import";
import { listFileIndexes } from "@/domain/ingest/indexStore";
import { importInto, native, queue, rescan } from "@/domain/ingest/runtime";
import { coursePaths, join } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";

const inTauri = () => "__TAURI_INTERNALS__" in window;
const FAIL_KEY: Record<string, string> = { unsupported: "file.unsupported", tooLarge: "file.tooLarge", heicWindows: "file.heicWindows", duplicate: "file.duplicate" };

/** Duplicates / rejections are toasted; accepted files show up in the list. */
export function reportImport(t: TFunction, res: ImportOutcome[]) {
  for (const r of res) {
    if (r.status === "added") continue;
    toast({ kind: r.status === "duplicate" ? "info" : "error", message: FAIL_KEY[r.status] ? t(FAIL_KEY[r.status] as string) : t("files.rejected", { name: r.path.split("/").pop(), error: ("error" in r && r.error) || r.status }) });
  }
}

function Chip({ rec, prog }: { rec: FileIndex; prog?: { done: number; total: number } }) {
  const { t } = useTranslation();
  if (rec.status === "failed") return <span className="text-danger" title={rec.error ?? ""}>{t("files.failed")}</span>;
  if (rec.status === "indexed") return <span className="text-success">{t("files.ready")}</span>;
  if (rec.status === "indexing") return <span className="text-primary">{prog ? t("files.indexingN", prog) : t("files.indexing")}</span>;
  return <span className="text-muted">{t("files.waiting")}</span>;
}

function Card({ role, recs, prog, over, refEl, onAdd, onChanged, course }: {
  role: Role; recs: FileIndex[]; prog: Record<string, { done: number; total: number }>; over: boolean;
  refEl: (el: HTMLDivElement | null) => void; onAdd: () => void; onChanged: () => void; course: string;
}) {
  const { t } = useTranslation();
  const root = useSettings((s) => s.settings.dataRoot);
  const abs = (r: FileIndex) => join(coursePaths(root, course).course, r.relPath);
  const count = recs.reduce((n, r) => n + r.exercises.length, 0);
  return (
    <div ref={refEl} className={`flex flex-1 flex-col gap-3 rounded-card border-2 border-dashed bg-card p-4 ${over ? "border-primary" : "border-border"}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">{t(role === "material" ? "files.materials" : "files.exercises")}</h3>
        <Button variant="outline" onClick={onAdd}><FilePlus className="size-4" /> {t(role === "material" ? "files.addMaterials" : "files.addExercises")}</Button>
      </div>
      {role === "exercises" && count > 0 && <p className="text-sm text-muted">{t("files.exercisesFound", { count })}</p>}
      {recs.length === 0 && <p className="text-sm text-muted">{t("files.dropHint")}</p>}
      {recs.map((r) => (
        <div key={r.sha256} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate" title={r.fileName}>{r.fileName}</span>
          <span className="text-muted">{t("files.pages", { count: r.pageCount })}</span>
          <Chip rec={r} prog={prog[r.sha256]} />
          <details className="relative">
            <summary className="inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-border/50"><MoreVertical className="size-4" /></summary>
            <div className="absolute end-0 z-10 mt-1 flex w-40 flex-col rounded-lg border border-border bg-card p-1 shadow-lg">
              <Button variant="ghost" className="justify-start" onClick={() => void import("@tauri-apps/plugin-opener").then((m) => m.openPath(abs(r)))}>{t("files.open")}</Button>
              <Button variant="ghost" className="justify-start" onClick={() => void reindex(course, r, { enqueue: queue.enqueue }).then(onChanged)}>{t(r.status === "failed" ? "files.retry" : "files.reindex")}</Button>
              <Button variant="ghost" className="justify-start text-danger" onClick={() => void removeFile(course, r, { native }).then(onChanged)}>{t("files.remove")}</Button>
            </div>
          </details>
        </div>
      ))}
    </div>
  );
}

/** Two drop-zone cards (5.1) + indexing status. `onIndexed` lets the page re-check "Improve plan" availability. */
export function Files({ course, onIndexed }: { course: string; onIndexed?: () => void }) {
  const { t } = useTranslation();
  const [recs, setRecs] = useState<FileIndex[]>([]);
  const [prog, setProg] = useState<Record<string, { done: number; total: number }>>({});
  const [over, setOver] = useState<Role | null>(null);
  const [chooser, setChooser] = useState<string[] | null>(null);
  const els = useRef<Record<Role, HTMLDivElement | null>>({ material: null, exercises: null });
  const refresh = useCallback(() => void listFileIndexes(course).then(setRecs), [course]);

  const add = useCallback(async (role: Role, files: string[]) => {
    if (files.length) reportImport(t, await importInto(course, role, files));
    refresh();
  }, [course, refresh, t]);

  useEffect(() => {
    refresh();
    if (!inTauri()) return;
    void rescan(course).then(refresh);
    const off = queue.subscribe((e) => {
      if (e.course !== course) return;
      setProg((p) => (e.done != null && e.total != null ? { ...p, [e.sha256]: { done: e.done, total: e.total } } : p));
      refresh();
      if (e.status === "indexed") onIndexed?.();
    });
    let unlistenDrop: (() => void) | undefined;
    let unlistenFs: (() => void) | undefined;
    const roleAt = (x: number, y: number): Role | null => {
      const px = x / devicePixelRatio, py = y / devicePixelRatio;
      for (const r of ["material", "exercises"] as const) {
        const b = els.current[r]?.getBoundingClientRect();
        if (b && px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return r;
      }
      return null;
    };
    void import("@tauri-apps/api/webview").then(async (m) => {
      unlistenDrop = await m.getCurrentWebview().onDragDropEvent((ev) => {
        const p = ev.payload;
        if (p.type === "over") setOver(roleAt(p.position.x, p.position.y));
        else if (p.type === "drop") {
          setOver(null);
          const role = roleAt(p.position.x, p.position.y);
          if (role) void add(role, p.paths);
          else setChooser(p.paths);
        } else setOver(null);
      });
    });
    // Watcher (5.2): files placed through Finder/Explorer or arriving via sync.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dirs = [coursePaths(useSettings.getState().settings.dataRoot, course)].flatMap((p) => [p.materials, p.exercises]);
    void import("@tauri-apps/plugin-fs").then(async (m) => {
      const stops = await Promise.all(dirs.map((d) => m.watch(d, () => { clearTimeout(timer); timer = setTimeout(() => void rescan(course).then(refresh), 1000); }, { delayMs: 500 }).catch(() => () => undefined)));
      unlistenFs = () => stops.forEach((s) => s());
    });
    return () => { off(); unlistenDrop?.(); unlistenFs?.(); clearTimeout(timer); };
  }, [course, refresh, add, onIndexed]);

  async function pick(role: Role) {
    if (!inTauri()) return;
    const sel = await (await import("@tauri-apps/plugin-dialog")).open({ multiple: true, filters: [{ name: t("files.filter"), extensions: PICKER_EXTENSIONS }] });
    if (sel) await add(role, Array.isArray(sel) ? sel : [sel]);
  }

  const card = (role: Role) => (
    <Card role={role} course={course} recs={recs.filter((r) => r.role === role)} prog={prog} over={over === role}
      refEl={(el) => { els.current[role] = el; }} onAdd={() => void pick(role)} onChanged={refresh} />
  );
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-4 md:flex-row">{card("material")}{card("exercises")}</div>
      <Dialog open={!!chooser} onOpenChange={(o) => !o && setChooser(null)}>
        <DialogContent className="flex flex-col gap-3">
          <DialogTitle className="text-lg font-bold">{t("files.chooser")}</DialogTitle>
          <div className="flex gap-2">
            <Button onClick={() => { void add("material", chooser ?? []); setChooser(null); }}>{t("files.materials")}</Button>
            <Button onClick={() => { void add("exercises", chooser ?? []); setChooser(null); }}>{t("files.exercises")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
