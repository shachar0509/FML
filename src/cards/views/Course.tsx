import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  Contrast,
  Dumbbell,
  Languages,
  Lock,
  Sparkles,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Bar, Ring, h2, panel } from "../ui";
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
  practice,
}: {
  data: CourseData;
  callTool: Tool;
  go: Go;
  reload: () => void;
  practice: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  // a translation is running: show the texts as they arrive
  const translating = data.translate.running;
  useEffect(() => {
    if (!translating) return;
    const h = setInterval(reload, 3000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translating]);
  const [sel, setSel] = useState<string | null>(null);
  const running = data.build?.state === "running";
  const [unread, setUnread] = useState<number | null>(null); // files the next build would read
  const onFiles = useCallback(
    (d: FilesData) =>
      setUnread([...d.materials, ...d.exercises].filter((f) => f.status !== "indexed").length),
    [],
  );
  const upToDate = data.hasPlan && unread === 0;
  const live = useBuild(running ? data.number : null, callTool, reload);
  const cur = data.units.flatMap((u) => u.stages).find((s) => s.id === data.current);

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
        </div>
      </header>

      {data.translate.missing > 0 && !running && (
        <div className={`${panel} flex flex-wrap items-center justify-between gap-3 p-4`}>
          {translating ? (
            <Waiting go={go} label={t("translate.running")} />
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
          <Checklist go={go} b={live ?? data.build} />
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

      {data.hasPlan && (
        <div className="flex flex-wrap gap-2">
          <Button
            className="h-11 px-6 text-[15px]"
            disabled={!cur}
            onClick={() => cur && void go({ kind: "learn", stageId: cur.id, title: cur.title })}
          >
            <BookOpen className="size-4" aria-hidden />
            {t("nav.learn")}
            {cur ? ` — ${cur.id}` : ""}
          </Button>
          <Button variant="outline" disabled={!data.canPractice} onClick={practice}>
            <Dumbbell className="size-4" aria-hidden />
            {t("nav.practice")}
          </Button>
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
              open[u.id] ?? (!!data.current && u.stages.some((s) => s.id === data.current));
            const done = u.stages.filter(
              (s) => s.status === "completed" || s.status === "completed_override",
            ).length;
            return (
              <div key={u.id} className={`${panel} overflow-hidden`}>
                <button
                  className="flex w-full items-center gap-2 px-4 py-3 text-start font-medium hover:bg-border/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
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
                {expanded && (
                  <div className="fade-in">
                    {u.stages.map((s) => (
                      <div
                        key={s.id}
                        className={`border-t border-border ${s.id === data.current ? "bg-primary/5" : ""}`}
                      >
                        <button
                          className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-border/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
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
