import { useCallback, useEffect, useState } from "react";
import {
  Check,
  ChevronDown,
  Circle,
  Contrast,
  Globe,
  Languages,
  Lock,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Bar, Ring, Stars, h2, panel } from "../ui";
import type { CourseData, FilesData, Stage, Go } from "../types";
import { Checklist } from "./Checklist";
import { Files } from "./Files";
import { useBuild } from "./useBuild";
import { Waiting } from "./Waiting";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown }>;

const STATUS: Record<Stage["status"], { icon: typeof Lock; label: string; chip: string }> = {
  locked: { icon: Lock, label: "locked", chip: "bg-border/60 text-muted" },
  available: { icon: Circle, label: "available", chip: "bg-border/60 text-muted" },
  in_progress: { icon: Contrast, label: "in progress", chip: "bg-primary/15 text-primary" },
  completed: { icon: Check, label: "completed", chip: "bg-success/15 text-success" },
  completed_override: { icon: Check, label: "completed", chip: "bg-warning/15 text-warning" },
};
const StatusIcon = ({ s }: { s: Stage["status"] }) => {
  const { icon: Icon, label, chip } = STATUS[s];
  return (
    <span className={`grid size-7 shrink-0 place-items-center rounded-full ${chip}`}>
      <Icon className="size-3.5" aria-label={label} />
    </span>
  );
};

export function Course({
  data,
  callTool,
  go,
  reload,
}: {
  data: CourseData;
  callTool: Tool;
  go: Go;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // a translation or a web search is running: show the texts as they arrive, and when it ends
  const translating = data.translate.running;
  const searching = !!data.web?.running;
  const [webCount, setWebCount] = useState(3); // M55: how many new files to find
  const stop = (kind: string) => () => void callTool("shalav_cancel", { key: `${kind}:${data.number}` });
  useEffect(() => {
    if (!translating && !searching) return;
    const h = setInterval(reload, 3000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translating, searching]);
  const [sel, setSel] = useState<string | null>(null);
  const [del, setDel] = useState<{ unitId?: string; stageId?: string; name: string; count: number } | null>(null); // M53: asking before a delete
  const remove = (d: NonNullable<typeof del>) => {
    setDel(null);
    void callTool("plan_remove", { number: data.number, unitId: d.unitId, stageId: d.stageId }).then(reload);
  };
  const ask = (d: NonNullable<typeof del>) => (
    <div
      className="flex flex-col gap-2 border-t border-danger/50 bg-danger/5 px-4 py-3"
      role="alertdialog"
      aria-label={t("plan.del.title", { name: d.name })}
    >
      <p className="text-sm font-medium">{t("plan.del.title", { name: d.name })}</p>
      {d.unitId && <p className="text-sm">{t("plan.del.unit", { count: d.count })}</p>}
      {!data.custom && <p className="text-sm">{t("plan.del.academic")}</p>}
      <p className="text-sm text-muted">{t("plan.del.back")}</p>
      <div className="flex gap-2">
        <Button variant="danger" onClick={() => remove(d)}>
          <Trash2 className="size-4" aria-hidden />
          {t("plan.del.confirm")}
        </Button>
        <Button variant="outline" onClick={() => setDel(null)}>
          {t("plan.del.keep")}
        </Button>
      </div>
    </div>
  );
  const stageCount = data.units.reduce((n, u) => n + u.stages.length, 0);
  // muted until the row is hovered or focused; always shown on touch screens
  const trash = (label: string, on: () => void) =>
    !running && (
      <button
        className="me-2 grid size-8 shrink-0 place-items-center rounded-full text-muted opacity-0 transition hover:bg-danger/10 hover:text-danger group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-primary motion-reduce:transition-none [@media(hover:none)]:opacity-100"
        aria-label={label}
        title={label}
        onClick={on}
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    );
  const running = data.build?.state === "running";
  const [unread, setUnread] = useState<number | null>(null); // files the next build would read
  const onFiles = useCallback(
    (d: FilesData) =>
      setUnread([...d.materials, ...d.exercises].filter((f) => f.status !== "indexed").length),
    [],
  );
  const upToDate = data.hasPlan && unread === 0;
  const live = useBuild(running ? data.number : null, callTool, reload);

  const [joined, setJoined] = useState(false); // another chat is building: it continues with this course
  async function build() {
    const r = await callTool("plan_build_request", { number: data.number });
    const j = !!(r.structuredContent as { joined?: boolean } | undefined)?.joined;
    setJoined(j);
    reload();
    if (!j) void go({ kind: "build" });
  }
  const buildButton = (
    <Button
      className="self-start"
      variant={data.hasPlan ? "outline" : "default"}
      disabled={running || upToDate}
      onClick={() => void build()}
    >
      <Sparkles className="size-4" aria-hidden />
      {t(data.hasPlan ? "plan.update" : "plan.build")}
    </Button>
  );

  return (
    <section className="flex flex-col gap-5" aria-label={data.name}>
      <header className="hero flex items-center gap-4 p-5">
        {data.hasPlan && <Ring pct={data.pct} hero />}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h1 className="hand text-4xl leading-tight">{data.name}</h1>
          <p className="text-sm text-(--board-muted)">
            {data.custom ? (
              t("home.customCourse")
            ) : (
              <>
                <span dir="ltr">{data.number}</span> · {t("home.credits", { count: data.credits })}
              </>
            )}
          </p>
          {data.hasPlan && (
            <div className="mt-1 flex flex-col gap-1.5">
              <p className="text-xs text-(--board-muted)">
                {t("courseHome.stagesOf", { k: data.stagesDone, n: data.stagesTotal })}
              </p>
              <Bar pct={data.pct} tone="bg-(--board-ink)" track="bg-(--board-muted)/30" />
            </div>
          )}
          {data.knowledge && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-(--board-muted)">
              {t("stars.yourLevel")}
              <Stars value={data.knowledge.stars} label={t("stars.student", { n: data.knowledge.stars })} />
              {data.knowledge.examReady !== null && <span>· {t("stars.examReady", { n: data.knowledge.examReady })}</span>}
            </p>
          )}
        </div>
      </header>

      {data.translate.missing > 0 && !running && (
        <div className={`${panel} flex flex-wrap items-center justify-between gap-3 p-4`}>
          {translating ? (
            <Waiting go={go} label={t("translate.running")} cancel={stop("translate")} />
          ) : (
            <>
              <p className="text-sm text-muted">{t("translate.note", { count: data.translate.missing })}</p>
              <Button
                variant="outline"
                onClick={() =>
                  void callTool("course_translate_request", { number: data.number }).then(() => {
                    reload();
                    return go();
                  })
                }
              >
                <Languages className="size-4" aria-hidden />
                {t("translate.button")}
              </Button>
            </>
          )}
        </div>
      )}
      {running && data.build && (
        <div className={`${panel} p-4`}>
          <Checklist go={go} b={live ?? data.build} cancel={stop("build")} />
          <p className="mt-3 text-sm text-muted">{t(joined ? "plan.joined" : "plan.studyMeanwhile")}</p>
        </div>
      )}
      {!running && data.build?.state === "failed" && (
        <div className={`${panel} flex flex-col gap-2 border-danger/50 p-4`} role="alert">
          <p className="font-medium" title={data.build.error ?? undefined}>
            {t("plan.failed")}
          </p>
        </div>
      )}
      {!data.hasPlan && !running && (
        <div className={`${panel} flex flex-col gap-3 p-4`}>
          <p className="font-medium">{t("plan.firstTitle")}</p>
          <p className="text-sm text-muted">{t("plan.firstBody")}</p>
        </div>
      )}

      {data.watch.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={h2}>{t("courseHome.watch")}</h2>
          {data.watch.map((m) => (
            <div
              key={m.label}
              className={`${panel} flex flex-col gap-2 border-s-4 border-s-warning p-3 text-sm`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{m.label}</span>
                <span className="shrink-0 text-xs text-muted">
                  {t("courseHome.watchCount", { count: m.count })}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {m.stageIds.map((id) => (
                  <span
                    key={id}
                    dir="ltr"
                    className="rounded-full bg-border/70 px-2 py-0.5 text-xs"
                  >
                    {id}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}

      {data.hasPlan && (
        <section className="flex flex-col gap-2">
          <h2 className={h2}>{t("courseHome.plan")}</h2>
          {data.units.map((u) => {
            const expanded =
              open[u.id] ?? false; // all collapsed until opened
            const done = u.stages.filter(
              (s) => s.status === "completed" || s.status === "completed_override",
            ).length;
            return (
              <div key={u.id} className={`${panel} overflow-hidden`}>
                <div className="group flex items-center">
                <button
                  className="flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-start font-medium hover:bg-border/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                  onClick={() => setOpen({ ...open, [u.id]: !expanded })}
                  aria-expanded={expanded}
                >
                  <ChevronDown
                    className={`size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none ${expanded ? "" : "ltr:-rotate-90 rtl:rotate-90"}`}
                    aria-hidden
                  />
                  <span className="grow">{u.title}</span>
                  <span className="text-xs font-normal text-muted" dir="ltr">
                    {done}/{u.stages.length}
                  </span>
                </button>
                {data.units.length > 1 &&
                  trash(t("plan.del.unitLabel", { name: u.title }), () =>
                    setDel({ unitId: u.id, name: u.title, count: u.stages.length }),
                  )}
                </div>
                {del?.unitId === u.id && ask(del)}
                {expanded && (
                  <div className="fade-in">
                    {u.stages.map((s) => (
                      <div
                        key={s.id}
                        className={`border-t border-border ${s.id === data.current ? "bg-primary/5" : ""}`}
                      >
                        <div className="group flex items-center">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-border/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
                          onClick={() => setSel(sel === s.id ? null : s.id)}
                          aria-expanded={sel === s.id}
                        >
                          <StatusIcon s={s.status} />
                          <span className="w-12 shrink-0 font-mono text-xs text-muted" dir="ltr">
                            {s.id}
                          </span>
                          <span className={`flex-1 ${s.status === "locked" ? "text-muted" : ""}`}>
                            {s.title}
                          </span>
                          <span className="text-xs text-muted tabular-nums">{s.mastery}%</span>
                        </button>
                        {stageCount > 1 &&
                          trash(t("plan.del.stageLabel", { name: s.title }), () =>
                            setDel({ stageId: s.id, name: s.title, count: 1 }),
                          )}
                        </div>
                        {del?.stageId === s.id && ask(del)}
                        {sel === s.id && (
                          <p className="fade-in px-4 ps-14 pb-3 text-sm text-muted">{s.summary}</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
      {data.web && !running && (
        <div className={`${panel} flex flex-col gap-3 p-4`}>
          {searching ? (
            <Waiting go={go} label={t("web.running")} cancel={stop("web")} />
          ) : (
            <>
              <div className="flex items-start gap-3">
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
                  aria-hidden
                >
                  <Globe className="size-5" />
                </span>
                <div className="flex flex-col gap-1">
                  <p className="font-medium">{t("web.title")}</p>
                  <p className="text-sm text-muted">
                    {t("web.body", { level: data.web.level, plan: t(data.hasPlan ? "plan.update" : "plan.build") })}
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 text-sm font-medium">
                <span className="flex items-baseline justify-between gap-2">
                  {t("web.count")}
                  <output className="text-primary tabular-nums">{t("web.files", { count: webCount })}</output>
                </span>
                <input
                  type="range"
                  min={1}
                  max={10}
                  value={webCount}
                  onChange={(e) => setWebCount(Number(e.target.value))}
                  aria-label={t("web.count")}
                  aria-valuetext={t("web.files", { count: webCount })}
                  className="w-full accent-[var(--primary)]"
                />
                <span className="text-xs font-normal text-muted">{t(data.hasPlan ? "web.countPlan" : "web.countNew")}</span>
              </div>
              <Button
                className="self-start"
                variant="outline"
                onClick={() =>
                  void callTool("course_web_request", { number: data.number, count: webCount }).then(() => {
                    reload();
                    return go();
                  })
                }
              >
                <Globe className="size-4" aria-hidden />
                {t("web.button")}
              </Button>
            </>
          )}
        </div>
      )}
      <Files
        number={data.number}
        callTool={callTool}
        reload={reload}
        live={running}
        hasPlan={data.hasPlan}
        onFiles={onFiles}
      />
      {!running && (
        <div className={`${panel} flex flex-col gap-2 p-4`}>
          <p className="text-sm text-muted">
            {t(upToDate ? "plan.upToDate" : data.hasPlan ? "plan.updateHint" : "plan.buildHint")}
          </p>
          {buildButton}
        </div>
      )}
    </section>
  );
}
