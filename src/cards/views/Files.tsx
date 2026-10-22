import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, FileText, FolderOpen, Loader2, MoreHorizontal, ScanLine, Trash2, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import type { FileRow, FilesData } from "../types";
import { Bar, h2, panel } from "../ui";

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

function Chip({ f, hasPlan }: { f: FileRow; hasPlan: boolean }) {
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
  return (
    <span className={`${pill} bg-border/60 text-muted`}>
      {t("files.waiting", { button: t(hasPlan ? "plan.update" : "plan.build") })}
    </span>
  );
}

/** "Importing…" (or another label) with the percentage above a bar. */
function Importing({ done, total, label }: { done: number; total: number; label?: string }) {
  const { t } = useTranslation();
  const pct = total ? Math.round((100 * done) / total) : 0;
  const text = label ?? t("files.importing");
  return (
    <div className="flex flex-col gap-1" role="status">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{text}</span>
        <span className="font-medium tabular-nums">{pct}%</span>
      </div>
      <Bar pct={pct} label={text} />
    </div>
  );
}

/** A section's files by scan state: scanned, scanning, not scanned (waiting or failed). */
const STATES = [
  { key: "scanned", has: (f: FileRow) => f.status === "indexed", stroke: "stroke-success", dot: "bg-success" },
  { key: "scanning", has: (f: FileRow) => f.status === "indexing", stroke: "stroke-warning", dot: "bg-warning" },
  { key: "notScanned", has: (f: FileRow) => f.status === "pending" || f.status === "failed", stroke: "stroke-danger", dot: "bg-danger" },
];
const groups = (rows: FileRow[]) => STATES.map((s) => ({ ...s, n: rows.filter(s.has).length }));
const PAGE = 10;

/** Alphabetical, names in the settings language first (Hebrew names first in Hebrew, the rest first in English). */
const sortNames = (rows: FileRow[], lang: string) => {
  const rank = (f: FileRow) => (/^[^\p{L}]*\p{Script=Hebrew}/u.test(f.name) === lang.startsWith("he") ? 0 : 1);
  const c = new Intl.Collator(lang, { numeric: true, sensitivity: "base" });
  return [...rows].sort((a, b) => rank(a) - rank(b) || c.compare(a.name, b.name));
};

/** The section's files as a ring split by scan state (exact shares via pathLength), the scanned percentage inside. */
function Ring({ rows }: { rows: FileRow[] }) {
  const { t } = useTranslation();
  const g = groups(rows);
  const pct = Math.round((100 * (g[0]?.n ?? 0)) / rows.length);
  const len = g.map(({ n }) => (100 * n) / rows.length);
  const at = len.map((_, i) => len.slice(0, i).reduce((a, b) => a + b, 0));
  return (
    <span
      className="relative inline-flex size-10 shrink-0 items-center justify-center"
      role="img"
      aria-label={t("files.indexedPct", { pct })}
    >
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="3" className="stroke-border" />
        {g.map(({ key, n, stroke }, i) =>
          n ? (
            <circle
              key={key}
              cx="18"
              cy="18"
              r="15"
              fill="none"
              strokeWidth="3"
              pathLength={100}
              strokeDasharray={`${len[i]} 100`}
              strokeDashoffset={-(at[i] ?? 0)}
              className={stroke}
            />
          ) : null,
        )}
      </svg>
      <span className="text-[10px] font-semibold tabular-nums" aria-hidden>
        {pct}%
      </span>
    </span>
  );
}

/** Counts per scan state under a section's title, matching the ring's colors. A state filters the list; again or Total clears it. */
function Legend({ rows, filter, onFilter }: { rows: FileRow[]; filter?: string; onFilter: (key?: string) => void }) {
  const { t } = useTranslation();
  const items = [...groups(rows), { key: "total", n: rows.length, dot: "bg-muted" }];
  return (
    <ul className="flex flex-wrap gap-1 text-xs text-muted">
      {items.map(({ key, n, dot }) => {
        const on = key === "total" ? !filter : filter === key;
        return (
          <li key={key}>
            <button
              className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 hover:bg-border/50 focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent ${on ? "bg-border/60 text-fg" : ""}`}
              aria-pressed={on}
              disabled={!n && !on}
              onClick={() => onFilter(key === "total" || on ? undefined : key)}
            >
              <span className={`size-2 shrink-0 rounded-full ${dot}`} aria-hidden />
              {t(`files.state.${key}`)}
              <span className="font-medium text-fg tabular-nums">{t("files.count", { count: n })}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The ⋯ menu of one file: Open, Re-scan, Delete. Arrow keys move, Esc or an outside click closes. */
function FileMenu({ f, onOpen, onRescan, onDelete }: { f: FileRow; onOpen: () => void; onRescan: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = () => [...(box.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    const all = items();
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") close();
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    }
  };
  const item = "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-start text-sm outline-none transition-colors motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-45";
  return (
    <span ref={box} className="relative">
      <button
        ref={trigger}
        className={`grid size-7 place-items-center rounded-md text-muted transition-colors hover:bg-border/50 hover:text-fg focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none ${open ? "bg-border/50 text-fg" : ""}`}
        aria-label={t("files.menu", { name: f.name })}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={t("files.menu", { name: f.name })}
          onKeyDown={keys}
          className="fade-in absolute end-0 top-full z-20 mt-1 flex min-w-44 flex-col rounded-lg border border-border bg-card p-1 shadow-lg"
        >
          <button role="menuitem" className={`${item} hover:bg-border/50 focus-visible:bg-border/50`} onClick={() => (close(), onOpen())}>
            <ExternalLink className="size-4 shrink-0 text-muted" aria-hidden />
            {t("files.open")}
          </button>
          <button
            role="menuitem"
            className={`${item} hover:bg-border/50 focus-visible:bg-border/50`}
            disabled={f.status === "pending" || f.status === "indexing"} // nothing to redo yet
            onClick={() => (close(), onRescan())}
          >
            <ScanLine className="size-4 shrink-0 text-muted" aria-hidden />
            {t("files.reindex")}
          </button>
          <div className="mx-1 my-1 h-px bg-border" role="separator" />
          <button role="menuitem" className={`${item} text-danger hover:bg-danger/10 focus-visible:bg-danger/10`} onClick={() => (close(), onDelete())}>
            <Trash2 className="size-4 shrink-0" aria-hidden />
            {t("files.delete")}
          </button>
        </div>
      )}
    </span>
  );
}

export function Files({
  number,
  callTool,
  reload,
  live = false,
  hasPlan = false,
  onFiles,
}: {
  number: string;
  callTool: Tool;
  reload: () => void;
  /** a plan build is running: follow the indexing statuses */
  live?: boolean;
  hasPlan?: boolean;
  /** called with every fresh file list (the course card enables Update plan only when something is left to read) */
  onFiles?: (d: FilesData) => void;
}) {
  const { t, i18n } = useTranslation();
  const [d, setD] = useState<FilesData | null>(null);
  const [filter, setFilter] = useState<Partial<Record<Role, string>>>({}); // a scan state picked in the legend
  const [page, setPage] = useState<Partial<Record<Role, number>>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null); // a plain notice (not an error)
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ done: number; total: number } | null>(null); // upload bytes
  const [del, setDel] = useState<string | null>(null); // sha awaiting "are you sure"
  const [url, setUrl] = useState("");
  const [open, setOpen] = useState<Partial<Record<Role, boolean>>>({}); // collapsed by default, like the plan units
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
  useEffect(() => {
    if (d) onFiles?.(d);
  }, [d, onFiles]);
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
    const total = files.reduce((n, f) => n + f.size, 0);
    let done = 0;
    setSent({ done, total });
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
          done += Math.min(CHUNK, file.size - i * CHUNK);
          setSent({ done, total });
          const s = r.structuredContent as
            { done?: boolean; status?: string; error?: string } | undefined;
          if (r.isError || (s?.done && s.status !== "added" && s.status !== "duplicate")) {
            setMsg(
              t("files.rejected", {
                name: file.name,
                error: t(`file.${s?.status ?? "failed"}`, { defaultValue: t("file.failed") }),
              }),
            );
            break;
          }
        }
      }
    } finally {
      setBusy(false);
      setSent(null);
      await refresh();
    }
  }

  async function importMoodle() {
    setMsg(null);
    const r = await callTool("moodle_import", {
      number,
      ...(url.trim() ? { url: url.trim() } : {}),
    });
    if (r.isError) setMsg(t("moodle.err.url"));
    await refresh();
  }

  if (!d) return null;
  const zone = (role: Role, title: string, add: string, rows: FileRow[]) => {
    const state = STATES.find((s) => s.key === filter[role]);
    const shown = sortNames(state ? rows.filter(state.has) : rows, i18n.language);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    const p = Math.min(page[role] ?? 0, pages - 1); // a page left empty by a delete or a filter shows the last one
    const [Prev, Next] = i18n.dir() === "rtl" ? [ChevronRight, ChevronLeft] : [ChevronLeft, ChevronRight];
    const go = (n: number) => setPage((x) => ({ ...x, [role]: n }));
    return (
    <div
      className={`${panel} flex flex-col gap-2 p-4`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void upload(role, [...e.dataTransfer.files]);
      }}
    >
      {rows.length === 0 ? (
        <h3 className="font-medium">{title}</h3>
      ) : (
        <h3>
          <button
            className="flex w-full items-center gap-2 rounded text-start font-medium focus-visible:outline-2 focus-visible:outline-primary"
            aria-expanded={!!open[role]}
            onClick={() => setOpen((x) => ({ ...x, [role]: !x[role] }))}
          >
            <ChevronDown
              className={`size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${open[role] ? "" : "rtl:rotate-90 ltr:-rotate-90"}`}
              aria-hidden
            />
            <span className="flex-1">{title}</span>
            <Ring rows={rows} />
          </button>
        </h3>
      )}
      {rows.length > 0 && (
        <Legend
          rows={rows}
          filter={filter[role]}
          onFilter={(key) => {
            setFilter((x) => ({ ...x, [role]: key }));
            go(0);
            if (key) setOpen((x) => ({ ...x, [role]: true })); // show what the filter picked
          }}
        />
      )}
      {rows.length === 0 && (
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-sm text-muted">
          {t("files.dropHint")}
        </p>
      )}
      {open[role] &&
        shown.slice(p * PAGE, (p + 1) * PAGE).map((f) => (
          <div
            key={f.sha}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border pt-2 text-sm first-of-type:border-t-0 first-of-type:pt-0"
          >
            <FileText className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-center" dir="auto">
              {f.name}
            </span>
            {role === "exercises" && f.status === "indexed" && (
              <span className="text-xs text-muted">
                {t("files.exercisesFound", { count: f.exercises })}
                {f.exercises > 0 &&
                  ` · ${t("files.solved", { count: f.solved })} · ${t("files.unsolved", { count: f.exercises - f.solved })}`}
              </span>
            )}
            <span className="text-xs text-muted">{t("files.pages", { count: f.pages })}</span>
            <Chip f={f} hasPlan={hasPlan} />
            <FileMenu
              f={f}
              onOpen={() => void callTool("file_open", { number, sha: f.sha })}
              onRescan={() =>
                void callTool("file_reindex", { number, sha: f.sha }).then((r) => {
                  if (!r.isError) setNote(t("files.rescanned", { name: f.name }));
                  return refresh();
                })
              }
              onDelete={() => setDel(f.sha)}
            />
            {del === f.sha && (
              <div
                className="flex w-full flex-col gap-2 rounded-lg border border-danger/50 p-3"
                role="alertdialog"
                aria-label={t("files.removeTitle")}
              >
                <p className="text-sm">{t("files.removeAsk", { name: f.name, folder: title })}</p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    onClick={() => {
                      setDel(null);
                      void callTool("file_remove", { number, sha: f.sha }).then(refresh);
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {t("files.delete")}
                  </Button>
                  <Button variant="outline" onClick={() => setDel(null)}>
                    {t("files.keep")}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      {open[role] && pages > 1 && (
        <nav className="flex items-center justify-center gap-2 border-t border-border pt-2 text-xs text-muted" aria-label={t("files.pager", { title })}>
          <Button variant="outline" size="sm" aria-label={t("files.prev")} disabled={p === 0} onClick={() => go(p - 1)}>
            <Prev className="size-4" aria-hidden />
          </Button>
          <span className="tabular-nums" aria-live="polite">
            {t("files.range", { from: p * PAGE + 1, to: Math.min((p + 1) * PAGE, shown.length), total: shown.length })}
          </span>
          <Button variant="outline" size="sm" aria-label={t("files.next")} disabled={p === pages - 1} onClick={() => go(p + 1)}>
            <Next className="size-4" aria-hidden />
          </Button>
        </nav>
      )}
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
  };
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
          {(d.moodle.busy === "sync" || d.moodle.busy === "install") && d.moodle.progress ? (
            <Importing {...d.moodle.progress} label={d.moodle.busy === "install" ? t("moodle.installing") : undefined} />
          ) : (
            d.moodle.busy && (
              <p className="text-sm text-muted" role="status">
                <Loader2 className="me-1 inline size-4 animate-spin" aria-hidden />
                {t(d.moodle.busy === "login" ? "moodle.login" : "moodle.syncing")}
              </p>
            )
          )}
          {!d.moodle.busy && d.moodle.last?.error && (
            <p className="text-sm text-danger" role="alert">
              {t(`moodle.err.${d.moodle.last.code ?? "failed"}`, { number })}
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
      {sent && <Importing {...sent} />}
      {note && (
        <p className="text-sm text-muted" role="status">
          {note}
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
