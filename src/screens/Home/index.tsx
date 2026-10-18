import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useDataVersion } from "@/sync/runtime";
import { listCourses, type CourseSummary } from "@/domain/courses/courses";
import { AddCourseDialog } from "./AddCourseDialog";
import { CourseMenu, relTime } from "./parts";

function Ring({ pct }: { pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="size-12 shrink-0 -rotate-90" role="img" aria-label={`${pct}%`}>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-border" />
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-primary" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      <text x="24" y="24" textAnchor="middle" dominantBaseline="central" className="rotate-90 origin-center fill-fg text-[11px]">{pct}%</text>
    </svg>
  );
}

function Card({ s, reload }: { s: CourseSummary; reload: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { course, plan, progress } = s;
  const tot = progress?.totals;
  const pct = tot && tot.stagesTotal ? Math.round((100 * tot.stagesCompleted) / tot.stagesTotal) : 0;
  const cur = progress?.currentStageId ?? null;
  const stage = plan?.stages.find((x) => x.id === cur);
  const acts = Object.values(progress?.stages ?? {}).flatMap((x) => (x.lastActivityAt ? [x.lastActivityAt] : []));
  const last = acts.length ? acts.reduce((a, b) => (a > b ? a : b)) : course.createdAt;
  return (
    <div
      className="flex cursor-pointer flex-col gap-3 rounded-card border border-border bg-card p-4 hover:border-primary"
      onClick={() => void navigate(`/course/${course.courseNumber}`)}
    >
      <div className="flex items-start gap-3">
        <Ring pct={pct} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{course.nameHe}</p>
          <p className="text-sm text-muted">
            <span dir="ltr">{course.courseNumber}</span> · {t("home.credits", { count: course.credits })}
          </p>
        </div>
        <CourseMenu number={course.courseNumber} onDeleted={reload} />
      </div>
      <p className="truncate text-sm">{stage ? `${stage.id} · ${stage.title}` : plan ? "" : t("plan.failed")}</p>
      <p className="text-xs text-muted">{t("home.lastActivity", { when: relTime(last, i18n.language) })}</p>
      {plan && cur && (
        <Button
          onClick={(e) => {
            e.stopPropagation();
            void navigate(`/course/${course.courseNumber}/learn/${cur}`);
          }}
        >
          {t("home.continue")}
        </Button>
      )}
    </div>
  );
}

const Empty = () => (
  <svg viewBox="0 0 120 90" className="w-40 text-primary" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 70V20c18-8 32-8 50 2 18-10 32-10 50-2v50c-18-8-32-8-50 2-18-10-32-10-50-2zM60 22v50" />
    <path d="M24 34c8-2 16-2 24 2M24 46c8-2 16-2 24 2" opacity=".5" />
  </svg>
);

export function HomeScreen() {
  const { t } = useTranslation();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);
  const [adding, setAdding] = useState(false);
  const reload = useCallback(() => void listCourses().then(setCourses).catch(() => setCourses([])), []);
  const dataVersion = useDataVersion((d) => d.version);
  useEffect(reload, [reload, dataVersion]);
  const addBtn = (
    <Button onClick={() => setAdding(true)}>
      <Plus className="size-4" /> {t("home.add")}
    </Button>
  );
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t("screens.home")}</h1>
        {courses?.length ? addBtn : null}
      </header>
      {courses && !courses.length && (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <Empty />
          <p className="text-muted">{t("home.empty")}</p>
          {addBtn}
        </div>
      )}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {courses?.map((s) => <Card key={s.course.courseNumber} s={s} reload={reload} />)}
      </div>
      {adding && <AddCourseDialog onClose={() => { setAdding(false); reload(); }} />}
    </div>
  );
}
