import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { defaultCatalog, normalizeCourseNumber, type CatalogEntry } from "@/domain/catalog/catalog";
import { createCourse, loadCourse, type CreateProgress, type ManualEntry } from "@/domain/courses/courses";
import { BuildChecklist, useGoCourse } from "./parts";

type Phase = "input" | "looking" | "preview" | "manual" | "building";

export function AddCourseDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const go = useGoCourse();
  const [phase, setPhase] = useState<Phase>("input");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [entry, setEntry] = useState<CatalogEntry | null>(null);
  const [more, setMore] = useState(false);
  const [prog, setProg] = useState<CreateProgress | null>(null);
  const [man, setMan] = useState({ nameHe: "", credits: "", syllabusHe: "" });
  const number = normalizeCourseNumber(raw);

  async function lookup() {
    if (!number) return setError(t("course.invalidNumber"));
    setError(null);
    setPhase("looking");
    if (await loadCourse(number)) return go(number);
    try {
      const e = await (await defaultCatalog()).lookup(number);
      setEntry(e);
      setPhase(e ? "preview" : "manual");
    } catch {
      setOffline(true);
      setPhase("manual");
    }
  }

  async function create(e: CatalogEntry | ManualEntry) {
    setPhase("building");
    try {
      await createCourse(e, setProg);
      go(e.courseNumber);
    } catch {
      setError(t("api.failed"));
      setPhase("input");
    }
  }

  const credits = Number(man.credits);
  const manOk = man.nameHe.trim() && credits > 0 && man.syllabusHe.trim().length >= 100;
  const lbl = "flex flex-col gap-1 text-sm";

  return (
    <Dialog open onOpenChange={(o) => !o && phase !== "building" && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-4 overflow-y-auto">
        <DialogTitle className="text-lg font-bold">{t("home.add")}</DialogTitle>
        <DialogDescription className="sr-only">{t("home.addDesc")}</DialogDescription>

        {(phase === "input" || phase === "looking") && (
          <form className="flex flex-col gap-3" onSubmit={(e) => (e.preventDefault(), void lookup())}>
            <Input autoFocus dir="ltr" placeholder="01040195" value={raw} onChange={(e) => setRaw(e.target.value)} />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{t("home.cancel")}</Button>
              <Button type="submit" disabled={phase === "looking" || !raw.trim()}>
                {phase === "looking" ? t("home.searching") : t("home.search")}
              </Button>
            </div>
          </form>
        )}

        {phase === "preview" && entry && (
          <div className="flex flex-col gap-3">
            <div className="rounded-card border border-border p-4">
              <p className="font-bold">{entry.nameHe}</p>
              <p className="text-sm text-muted">
                <span dir="ltr">{entry.courseNumber}</span> · {t("home.credits", { count: entry.credits })} · {entry.faculty}
              </p>
              <p className="mt-2 whitespace-pre-line text-sm">
                {more ? entry.syllabusHe : entry.syllabusHe.slice(0, 400)}
                {!more && entry.syllabusHe.length > 400 && "…"}
              </p>
              {entry.syllabusHe.length > 400 && (
                <button className="mt-1 text-sm text-primary" onClick={() => setMore(!more)}>
                  {more ? t("home.less") : t("home.more")}
                </button>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>{t("home.cancel")}</Button>
              <Button onClick={() => void create(entry)}>{t("home.add")}</Button>
            </div>
          </div>
        )}

        {phase === "manual" && number && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void create({ courseNumber: number, nameHe: man.nameHe.trim(), credits, faculty: "", syllabusHe: man.syllabusHe.trim(), prerequisitesRaw: "" });
            }}
          >
            <p className="text-sm text-muted">{t("course.notFound")}</p>
            {offline && <p className="text-sm text-warning">{t("net.offline")}</p>}
            <label className={lbl}>
              {t("home.name")}
              <Input value={man.nameHe} onChange={(e) => setMan({ ...man, nameHe: e.target.value })} />
            </label>
            <label className={lbl}>
              {t("home.creditsLabel")}
              <Input type="number" min={0} step={0.5} dir="ltr" value={man.credits} onChange={(e) => setMan({ ...man, credits: e.target.value })} />
            </label>
            <label className={lbl}>
              {t("home.syllabus")}
              <textarea
                className="min-h-28 rounded-lg border border-border bg-card p-3 text-sm"
                value={man.syllabusHe}
                onChange={(e) => setMan({ ...man, syllabusHe: e.target.value })}
              />
              <span className="text-xs text-muted">{t("home.syllabusHint", { n: man.syllabusHe.trim().length })}</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{t("home.cancel")}</Button>
              <Button type="submit" disabled={!manOk}>{t("home.add")}</Button>
            </div>
          </form>
        )}

        {phase === "building" && <BuildChecklist p={prog} />}
      </DialogContent>
    </Dialog>
  );
}
