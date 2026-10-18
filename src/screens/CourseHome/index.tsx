import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, ChevronDown, Circle, Contrast, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { claude } from "@/claude/runtime";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { buildPlan, loadCourse, type CourseSummary, type CreateProgress } from "@/domain/courses/courses";
import type { Stage } from "@/domain/dataSchemas";
import { refinePlan, newStageIds } from "@/domain/plan/refine";
import { listFileIndexes } from "@/domain/ingest/indexStore";
import { toast } from "@/components/ui/toaster";
import { Files } from "./Files";
import { BuildChecklist, CourseMenu, relTime } from "@/screens/Home/parts";

type Status = "locked" | "available" | "in_progress" | "completed" | "completed_override";

const StatusIcon = ({ s }: { s: Status }) =>
  s === "locked" ? <Lock className="size-4 text-muted" />
  : s === "available" ? <Circle className="size-4 text-muted" />
  : s === "in_progress" ? <Contrast className="size-4 text-primary" />
  : <Check className={`size-4 ${s === "completed" ? "text-success" : "text-warning"}`} />;

const Bar = ({ pct }: { pct: number }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-border">
    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
  </div>
);

export function CourseHome() {
  const { number = "" } = useParams();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [s, setS] = useState<CourseSummary | null | undefined>(undefined);
  const [building, setBuilding] = useState<CreateProgress | "start" | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<Stage | null>(null);
  const [canImprove, setCanImprove] = useState(false);
  const [improving, setImproving] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const reload = useCallback(() => void loadCourse(number).then(setS), [number]);
  useEffect(reload, [reload]);
  const checkImprove = useCallback(() => void listFileIndexes(number).then((r) => setCanImprove(r.some((x) => x.role === "material" && x.status === "indexed"))), [number]);
  useEffect(checkImprove, [checkImprove]);

  if (s === undefined) return null;
  if (s === null) return <p className="p-8 text-muted">{t("courseHome.missing")}</p>;
  const { course, plan, progress } = s;
  const tot = progress?.totals;
  const pct = tot && tot.stagesTotal ? Math.round((100 * tot.stagesCompleted) / tot.stagesTotal) : 0;
  const cur = progress?.currentStageId ?? null;
  const curStage = plan?.stages.find((x) => x.id === cur);
  const curMastery = cur ? Math.round((progress?.stages[cur]?.mastery ?? 0) * 100) : 0;
  const watch = (progress?.mistakes ?? []).filter((m) => !m.resolved).slice(0, 5);
  const learnTo = (id: string) => `/course/${number}/learn/${id}`;

  async function improve() {
    if (!plan || improving) return;
    setImproving(true);
    try {
      const next = await refinePlan({ gw: claude(), course, lang: i18n.language === "en" ? "en" : "he" });
      setFresh(newStageIds(plan, next));
      toast({ kind: "success", message: t("courseHome.improved") });
    } catch {
      toast({ kind: "error", message: t("courseHome.improveFailed") });
    }
    setImproving(false);
    reload();
    checkImprove();
  }

  async function retry() {
    setBuilding("start");
    await buildPlan(number, setBuilding).catch(() => null);
    setBuilding(null);
    reload();
  }

  const big = "flex h-[120px] flex-1 flex-col items-start justify-center gap-1 rounded-card border border-border bg-card p-4 text-start";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <header className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{course.nameHe}</h1>
            <p className="text-sm text-muted">
              <span dir="ltr">{course.courseNumber}</span> · {t("home.credits", { count: course.credits })}
            </p>
          </div>
          <CourseMenu number={number} onDeleted={() => void navigate("/")} onImprove={canImprove && plan && !improving ? () => void improve() : undefined} />
        </div>
        {tot && (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted">{t("courseHome.stagesOf", { k: tot.stagesCompleted, n: tot.stagesTotal })}</p>
            <Bar pct={pct} />
          </div>
        )}
      </header>

      {!plan && (
        <div className="flex flex-col gap-3 rounded-card border border-warning p-4">
          {building ? (
            <BuildChecklist p={building === "start" ? null : building} />
          ) : (
            <>
              <p>{t("plan.failed")}</p>
              <Button className="self-start" onClick={() => void retry()}>{t("courseHome.tryAgain")}</Button>
            </>
          )}
        </div>
      )}

      <div className="flex gap-4">
        {plan && cur ? (
          <Link to={learnTo(cur)} className={big + " hover:border-primary"}>
            <span className="text-lg font-bold">{t("nav.learn")}</span>
            <span className="text-sm text-muted">{curStage ? `${cur} · ${curStage.title}` : cur}</span>
            <Bar pct={curMastery} />
          </Link>
        ) : (
          <button disabled className={big + " opacity-50"}>
            <span className="text-lg font-bold">{t("nav.learn")}</span>
          </button>
        )}
        {Object.values(progress?.stages ?? {}).some((x) => x.status === "completed" || x.status === "completed_override") ? (
          <Link to={`/course/${number}/practice`} className={big + " hover:border-primary"}>
            <span className="text-lg font-bold">{t("nav.practice")}</span>
            <span className="text-sm text-muted">{t("practice.cta")}</span>
          </Link>
        ) : (
          <button disabled className={big + " opacity-50"}>
            <span className="text-lg font-bold">{t("nav.practice")}</span>
            <span className="text-sm text-muted">{t("practice.locked")}</span>
          </button>
        )}
      </div>

      <Files course={number} onIndexed={checkImprove} />

      {watch.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t("courseHome.watch")}</h2>
          {watch.map((m) => (
            <div key={m.tag} className="flex flex-col gap-1 rounded-card border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{i18n.language === "he" ? m.labelHe : m.labelEn}</span>
                <span className="text-muted">
                  {t("courseHome.watchCount", { count: m.count })} · {t("courseHome.watchLast")} {relTime(m.lastSeenAt, i18n.language)}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {m.stageIds.map((id) => <span key={id} dir="ltr" className="rounded bg-border px-1.5 text-xs">{id}</span>)}
              </div>
            </div>
          ))}
        </section>
      )}

      {plan && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t("courseHome.plan")}</h2>
          {plan.units.map((u) => {
            const expanded = open[u.id] ?? (!!cur && u.stageIds.includes(cur));
            return (
              <div key={u.id} className="rounded-card border border-border bg-card">
                <button className="flex w-full items-center gap-2 p-3 text-start font-medium" onClick={() => setOpen({ ...open, [u.id]: !expanded })} aria-expanded={expanded}>
                  <ChevronDown className={`size-4 transition-transform ${expanded ? "" : "ltr:-rotate-90 rtl:rotate-90"}`} />
                  {u.title}
                </button>
                {expanded &&
                  u.stageIds.map((id) => {
                    const st = plan.stages.find((x) => x.id === id);
                    if (!st) return null;
                    const p = progress?.stages[id];
                    return (
                      <button key={id} className="flex w-full items-center gap-3 border-t border-border px-4 py-2 text-start text-sm hover:bg-border/50" onClick={() => setSel(st)}>
                        <StatusIcon s={p?.status ?? "locked"} />
                        <span className="w-12 text-muted" dir="ltr">{id}</span>
                        <span className="flex-1">{st.title}</span>
                        {fresh.has(id) && <span className="rounded bg-primary px-1.5 text-xs text-white">{t("courseHome.new")}</span>}
                        <span className="text-muted">{Math.round((p?.mastery ?? 0) * 100)}%</span>
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </section>
      )}

      <Dialog open={!!sel} onOpenChange={(o) => !o && setSel(null)}>
        <DialogContent className="start-auto end-0 top-0 h-full max-w-sm translate-y-0 overflow-y-auto rounded-none ltr:translate-x-0 rtl:translate-x-0">
          {sel && plan && (
            <div className="flex flex-col gap-4">
              <DialogTitle className="text-lg font-bold">{sel.id} · {sel.title}</DialogTitle>
              <DialogDescription className="text-sm">{sel.summary}</DialogDescription>
              <div>
                <h3 className="font-medium">{t("courseHome.objectives")}</h3>
                <ul className="ms-5 list-disc text-sm">{sel.objectives.map((o) => <li key={o}>{o}</li>)}</ul>
              </div>
              {sel.prerequisites.length > 0 && (
                <div>
                  <h3 className="font-medium">{t("courseHome.prereqs")}</h3>
                  <ul className="ms-5 list-disc text-sm">
                    {sel.prerequisites.map((id) => <li key={id}>{id} · {plan.stages.find((x) => x.id === id)?.title}</li>)}
                  </ul>
                </div>
              )}
              <Button asChild>
                <Link to={learnTo(sel.id)}>
                  {(() => {
                    const st = progress?.stages[sel.id]?.status;
                    return t(st === "in_progress" ? "courseHome.continue" : st === "completed" || st === "completed_override" ? "courseHome.again" : "nav.learn");
                  })()}
                </Link>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
