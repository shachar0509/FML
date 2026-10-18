import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, FolderOpen, Loader2, MoreVertical, Sparkles, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { deleteCourse, type CreateProgress } from "@/domain/courses/courses";
import { coursePaths } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];
/** "3 days ago" in the given language. */
export function relTime(iso: string, lang: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const [unit, ms] = UNITS.find(([, m]) => Math.abs(diff) >= m) ?? ["minute", 60_000];
  return rtf.format(Math.round(diff / ms), unit);
}

export function useOpenFolder(n: string) {
  const root = useSettings((s) => s.settings.dataRoot);
  return async () => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    await (await import("@tauri-apps/plugin-opener")).openPath(coursePaths(root, n).course);
  };
}

/** Kebab menu (native <details>) with Open folder + Delete (typed-number confirmation, §4.7). */
export function CourseMenu({ number, onDeleted, onImprove }: { number: string; onDeleted: () => void; onImprove?: () => void }) {
  const { t } = useTranslation();
  const openFolder = useOpenFolder(number);
  const [askDelete, setAsk] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      await deleteCourse(number);
      onDeleted();
    } catch {
      toast({ kind: "error", message: t("api.failed") });
      setBusy(false);
    }
  }

  return (
    <div onClick={(e) => e.stopPropagation()}>
      <details className="relative">
        <summary className="inline-flex size-9 cursor-pointer list-none items-center justify-center rounded-lg hover:bg-border/50" aria-label={t("home.menu")}>
          <MoreVertical className="size-4" />
        </summary>
        <div className="absolute end-0 z-10 mt-1 flex w-48 flex-col rounded-lg border border-border bg-card p-1 shadow-lg">
          <Button variant="ghost" className="justify-start" onClick={() => void openFolder()}>
            <FolderOpen className="size-4" /> {t("home.openFolder")}
          </Button>
          {onImprove && (
            <Button variant="ghost" className="justify-start" onClick={onImprove}>
              <Sparkles className="size-4" /> {t("courseHome.improve")}
            </Button>
          )}
          <Button variant="ghost" className="justify-start text-danger" onClick={() => setAsk(true)}>
            <Trash2 className="size-4" /> {t("home.delete")}
          </Button>
        </div>
      </details>
      <Dialog open={askDelete} onOpenChange={(o) => !busy && setAsk(o)}>
        <DialogContent className="flex flex-col gap-3">
          <DialogTitle className="text-lg font-bold">{t("home.deleteTitle")}</DialogTitle>
          <DialogDescription className="text-sm text-muted">{t("home.deleteBody", { number })}</DialogDescription>
          <Input value={typed} onChange={(e) => setTyped(e.target.value.trim())} placeholder={number} dir="ltr" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={busy} onClick={() => setAsk(false)}>
              {t("home.cancel")}
            </Button>
            <Button variant="danger" disabled={typed !== number || busy} onClick={() => void remove()}>
              {t("home.delete")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const STEPS = ["folders", "plan", "validate", "progress"] as const;
/** Visible creation checklist (§4.3): spinner -> check. */
export function BuildChecklist({ p }: { p: CreateProgress | null }) {
  const { t } = useTranslation();
  const cur = p ? STEPS.indexOf(p.step) : 0;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">{t("plan.building")}</p>
      <ul className="flex flex-col gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-sm">
            {i < cur ? (
              <Check className="size-4 text-success" />
            ) : i === cur ? (
              <Loader2 className="size-4 animate-spin text-primary" />
            ) : (
              <span className="size-4 rounded-full border border-border" />
            )}
            <span className={i > cur ? "text-muted" : ""}>
              {s === "plan" && i === cur && p?.unit ? t("plan.detailing", p.unit) : t(`plan.step.${s}`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useGoCourse() {
  const navigate = useNavigate();
  return (n: string) => void navigate(`/course/${n}`);
}
