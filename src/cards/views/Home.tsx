import { BookOpen, ChevronLeft, ChevronRight, Landmark, Loader2, Plus, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { UNIVERSITIES, UNIVERSITY_IDS, type UniversityId } from "@/core/universities";
import type { HomeData } from "../types";
import { Bar, panel } from "../ui";

function PickUniversity({ choose }: { choose: (id: UniversityId) => void }) {
  const { t, i18n } = useTranslation();
  const he = i18n.language.startsWith("he");
  return (
    <section className="flex flex-col gap-4" aria-label={t("university.title")}>
      <div>
        <h1 className="text-xl font-bold">{t("university.title")}</h1>
        <p className="mt-1 text-sm text-muted">{t("university.hint")}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {UNIVERSITY_IDS.map((id) => (
          <li key={id}>
            <button
              className={`${panel} flex w-full items-center gap-3 p-4 text-start font-medium transition-colors hover:border-primary/60 hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary`}
              onClick={() => choose(id)}
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
                aria-hidden
              >
                <Landmark className="size-5" />
              </span>
              {he ? UNIVERSITIES[id].nameHe : UNIVERSITIES[id].nameEn}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Home({
  data,
  add,
  open,
  settings,
  choose,
}: {
  data: HomeData;
  add: (example: string) => void;
  open: (n: string) => void;
  settings: () => void;
  choose: (id: UniversityId) => void;
}) {
  const { t, i18n } = useTranslation();
  if (!data.university) return <PickUniversity choose={choose} />;
  const addCourse = () => add(UNIVERSITIES[data.university as UniversityId].example);
  const Arrow = i18n.dir() === "rtl" ? ChevronLeft : ChevronRight;
  const empty = data.courses.length === 0;
  return (
    <section className="flex flex-col gap-4" aria-label={t("screens.home")}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("screens.home")}</h1>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={settings}
            aria-label={t("screens.settings")}
          >
            <Settings className="size-4" aria-hidden />
          </Button>
          {!empty && (
            <Button onClick={addCourse}>
              <Plus className="size-4" aria-hidden /> {t("home.add")}
            </Button>
          )}
        </div>
      </div>
      {empty && (
        <div className={`${panel} flex flex-col items-center gap-3 px-6 py-10 text-center`}>
          <span
            className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary"
            aria-hidden
          >
            <BookOpen className="size-6" />
          </span>
          <p className="text-muted">{t("home.empty")}</p>
          <Button onClick={addCourse}>
            <Plus className="size-4" aria-hidden /> {t("home.add")}
          </Button>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {data.courses.map((c) => (
          <li
            key={c.number}
            className={`${panel} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-5`}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate font-semibold">{c.name}</p>
                <span className="shrink-0 text-sm font-semibold text-primary">{c.pct}%</span>
              </div>
              <Bar pct={c.pct} />
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
                <span dir="ltr">{c.number}</span>
                <span aria-hidden>·</span>
                <span>{t("home.credits", { count: c.credits })}</span>
                {c.building && (
                  <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                    {t("home.building")}
                  </span>
                )}
                {c.stage && (
                  <span
                    className="max-w-full truncate rounded-full bg-border/70 px-2 py-0.5 text-xs text-fg"
                    dir="auto"
                  >
                    {c.stage}
                  </span>
                )}
              </p>
            </div>
            <Button className="shrink-0 sm:self-center" onClick={() => open(c.number)}>
              {t("home.continue")}
              <Arrow className="size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
