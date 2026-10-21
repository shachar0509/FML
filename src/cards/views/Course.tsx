import { useState } from "react";
import { Check, ChevronDown, Circle, Contrast, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { CourseData, Stage } from "../types";
import { Checklist } from "./Checklist";
import { Files } from "./Files";
import { useBuild } from "./useBuild";

type Tool = (name: string, args?: Record<string, unknown>) => Promise<{ structuredContent?: unknown }>;

const StatusIcon = ({ s }: { s: Stage["status"] }) =>
  s === "locked" ? <Lock className="size-4 text-muted" aria-label="locked" />
  : s === "available" ? <Circle className="size-4 text-muted" aria-label="available" />
  : s === "in_progress" ? <Contrast className="size-4 text-primary" aria-label="in progress" />
  : <Check className={`size-4 ${s === "completed" ? "text-success" : "text-warning"}`} aria-label="completed" />;

const Bar = ({ pct }: { pct: number }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-label={`${pct}%`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
  </div>
);

export function Course({ data, callTool, say, reload, back, practice }: { data: CourseData; callTool: Tool; say: (t: string) => Promise<void>; reload: () => void; back: () => void; practice: () => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sel, setSel] = useState<string | null>(null);
  const running = data.build?.state === "running";
  const live = useBuild(running ? data.number : null, callTool, reload);
  const cur = data.units.flatMap((u) => u.stages).find((s) => s.id === data.current);

  async function retry() {
    await callTool("plan_retry_request", { number: data.number });
    reload();
    void say(t("mcp.buildPlan"));
  }

  return (
    <section className="flex flex-col gap-5 p-4" aria-label={data.name}>
      <button className="self-start text-sm text-primary" onClick={back}>← {t("course.back")}</button>
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">{data.name}</h1>
        <p className="text-sm text-muted"><span dir="ltr">{data.number}</span> · {t("home.credits", { count: data.credits })}</p>
        {data.hasPlan && (
          <>
            <p className="text-sm text-muted">{t("courseHome.stagesOf", { k: data.stagesDone, n: data.stagesTotal })}</p>
            <Bar pct={data.pct} />
          </>
        )}
      </header>

      {!data.hasPlan && data.build && (
        <div className="flex flex-col gap-3 rounded-card border border-warning p-4">
          {running ? (
            <Checklist b={live ?? data.build} />
          ) : (
            <>
              <p>{t("plan.failed")}</p>
              {data.build.error && <p className="text-xs text-muted" dir="auto">{data.build.error}</p>}
              <Button className="self-start" onClick={() => void retry()}>{t("courseHome.tryAgain")}</Button>
            </>
          )}
        </div>
      )}

      {data.hasPlan && (
        <div className="flex flex-wrap gap-3">
          <Button disabled={!cur} onClick={() => cur && void say(t("mcp.learn", { stage: `${cur.id} · ${cur.title}` }))}>{t("nav.learn")}{cur ? ` — ${cur.id}` : ""}</Button>
          <Button variant="outline" disabled={!data.canPractice} onClick={practice}>{t("nav.practice")}</Button>
        </div>
      )}

      {data.watch.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t("courseHome.watch")}</h2>
          {data.watch.map((m) => (
            <div key={m.label} className="flex flex-col gap-1 rounded-card border border-border bg-card p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <span className="text-muted">{t("courseHome.watchCount", { count: m.count })}</span>
              </div>
              <div className="flex flex-wrap gap-1">{m.stageIds.map((id) => <span key={id} dir="ltr" className="rounded bg-border px-1.5 text-xs">{id}</span>)}</div>
            </div>
          ))}
        </section>
      )}

      {data.hasPlan && (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-bold">{t("courseHome.plan")}</h2>
          {data.units.map((u) => {
            const expanded = open[u.id] ?? (!!data.current && u.stages.some((s) => s.id === data.current));
            return (
              <div key={u.id} className="rounded-card border border-border bg-card">
                <button className="flex w-full items-center gap-2 p-3 text-start font-medium" onClick={() => setOpen({ ...open, [u.id]: !expanded })} aria-expanded={expanded}>
                  <ChevronDown className={`size-4 transition-transform ${expanded ? "" : "ltr:-rotate-90 rtl:rotate-90"}`} aria-hidden />
                  {u.title}
                </button>
                {expanded &&
                  u.stages.map((s) => (
                    <div key={s.id} className="border-t border-border">
                      <button className="flex w-full items-center gap-3 px-4 py-2 text-start text-sm hover:bg-border/50" onClick={() => setSel(sel === s.id ? null : s.id)} aria-expanded={sel === s.id}>
                        <StatusIcon s={s.status} />
                        <span className="w-12 text-muted" dir="ltr">{s.id}</span>
                        <span className="flex-1">{s.title}</span>
                        <span className="text-muted">{s.mastery}%</span>
                      </button>
                      {sel === s.id && <p className="px-4 pb-3 text-sm text-muted">{s.summary}</p>}
                    </div>
                  ))}
              </div>
            );
          })}
        </section>
      )}
      {!running && <Files number={data.number} callTool={callTool} say={say} reload={reload} />}
    </section>
  );
}
