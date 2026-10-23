import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Dumbbell, History as HistoryIcon, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import type { Go, Host, SavedItem, StepData } from "../types";
import { h2, panel } from "../ui";

type Tool = Host["callTool"];
const TYPES = ["homework", "single", "test", "normal"] as const;

/** The saved lessons or practice sessions of a course (M60), newest first: open one, delete some or all (of the filter). */
export function SavedList({
  number,
  kind,
  callTool,
  open,
  items: initial,
  onChange,
}: {
  number: string;
  kind: "lesson" | "practice";
  callTool: Tool;
  open: (item: SavedItem) => void;
  items?: SavedItem[];
  onChange?: (items: SavedItem[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<SavedItem[] | null>(initial ?? null);
  const [filter, setFilter] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<string[] | null>(null);
  const set = useCallback(
    (x: SavedItem[]) => (setItems(x), onChange?.(x), setPicked((p) => p.filter((id) => x.some((i) => i.id === id)))),
    [onChange],
  );
  useEffect(() => {
    if (initial) return;
    void callTool("history_list", { number, kind }).then((r) => set((r.structuredContent as { items?: SavedItem[] } | undefined)?.items ?? []));
  }, [callTool, number, kind, initial, set]);
  const del = async (ids: string[]) => {
    setConfirm(null);
    const r = await callTool("history_delete", { number, kind, ids });
    set((r.structuredContent as { items?: SavedItem[] } | undefined)?.items ?? []);
  };
  const when = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" });
  const label = (type: string) => (type === "lesson" ? t("history.lesson") : t(`practice.modes.${type}`));
  if (!items) return <p role="status" className="text-sm text-muted">{t("learn.loading")}</p>;
  const shown = filter ? items.filter((i) => i.type === filter) : items;
  const all = shown.length > 0 && shown.every((i) => picked.includes(i.id));

  return (
    <section className="flex flex-col gap-3" aria-label={t(kind === "lesson" ? "history.olderLesson" : "history.olderPractice")}>
      {kind === "practice" && (
        <div role="group" aria-label={t("history.filter")} className="flex flex-wrap gap-2">
          {[null, ...TYPES].map((k) => (
            <Button
              key={k ?? "all"}
              size="sm"
              variant={filter === k ? "default" : "outline"}
              aria-pressed={filter === k}
              onClick={() => (setFilter(k), setPicked([]))}
            >
              {k ? label(k) : t("history.all")}
            </Button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="text-sm text-muted">{t("history.empty")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-[var(--primary)]"
                checked={all}
                onChange={() => setPicked(all ? [] : shown.map((i) => i.id))}
              />
              {t("history.selectAll")}
            </label>
            <Button
              size="sm"
              variant="outline"
              className="ms-auto text-danger"
              disabled={!picked.length}
              onClick={() => setConfirm(picked)}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("history.deleteSelected", { n: picked.length })}
            </Button>
          </div>
          {confirm && (
            <div role="alertdialog" aria-label={t("history.confirm", { count: confirm.length })} className={`${panel} flex flex-wrap items-center gap-2 border-danger/50 p-3 text-sm`}>
              <span className="grow">{t("history.confirm", { count: confirm.length })}</span>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                {t("advance.cancel")}
              </Button>
              <Button size="sm" className="bg-danger text-white" onClick={() => void del(confirm)}>
                {t("history.delete")}
              </Button>
            </div>
          )}
          <ul className="flex flex-col gap-2">
            {shown.map((i) => (
              <li key={i.id} className={`${panel} flex items-center gap-3 p-3`}>
                <input
                  type="checkbox"
                  className="size-4 shrink-0 accent-[var(--primary)]"
                  aria-label={`${t("history.select")} ${i.title || label(i.type)}`}
                  checked={picked.includes(i.id)}
                  onChange={(e) => setPicked(e.target.checked ? [...picked, i.id] : picked.filter((x) => x !== i.id))}
                />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate font-medium" dir="auto">
                    {kind === "practice" && <span className="me-2 rounded-full bg-border/60 px-2 py-0.5 text-xs">{label(i.type)}</span>}
                    {i.title || label(i.type)}
                  </span>
                  <time className="text-xs text-muted" dateTime={i.updatedAt}>
                    {t("history.lastAction")}: {when.format(new Date(i.updatedAt))}
                  </time>
                </span>
                <Button size="sm" onClick={() => open(i)}>
                  {t("history.open")}
                </Button>
                <Button size="icon" variant="ghost" aria-label={`${t("history.delete")} ${i.title || label(i.type)}`} onClick={() => setConfirm([i.id])}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Start new / Load older (M60): the two choices before a lesson or a practice, when there are saved ones. */
export function NewOrOlder({
  kind,
  start,
  older,
}: {
  kind: "lesson" | "practice";
  start: () => void;
  older: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-2">
      <Button className="h-11 px-6 text-[15px]" onClick={start}>
        {t(kind === "lesson" ? "history.newLesson" : "history.newPractice")}
      </Button>
      <Button variant="outline" className="h-11 px-6 text-[15px]" onClick={older}>
        <HistoryIcon className="size-4" aria-hidden />
        {t(kind === "lesson" ? "history.olderLesson" : "history.olderPractice")}
      </Button>
    </div>
  );
}

/** A resumed lesson (M60): browse its earlier slides, then back to where the student stopped. */
export function SlideBrowser({
  history,
  callTool,
  slide,
  children,
}: {
  history: { number: string; id: string; count: number };
  callTool: Tool;
  slide: (s: StepData) => ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [slides, setSlides] = useState<StepData[] | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const browse = async () => {
    const s = slides ?? ((await callTool("history_slides", { number: history.number, id: history.id })).structuredContent as { slides?: StepData[] } | undefined)?.slides ?? [];
    setSlides(s);
    if (s.length) setAt(s.length - 1);
  };
  if (at === null || !slides?.[at])
    return (
      <>
        {history.count > 0 && (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => void browse()}>
            <HistoryIcon className="size-4" aria-hidden />
            {t("history.earlier", { n: history.count })}
          </Button>
        )}
        {children}
      </>
    );
  return (
    <section className="flex flex-col gap-3" aria-label={t("history.earlier", { n: slides.length })}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className={h2}>{t("history.slideOf", { n: at + 1, of: slides.length })}</h2>
        <Button variant="outline" size="sm" className="ms-auto" disabled={at === 0} onClick={() => setAt(at - 1)}>
          <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
          {t("history.prev")}
        </Button>
        <Button variant="outline" size="sm" disabled={at === slides.length - 1} onClick={() => setAt(at + 1)}>
          {t("history.next")}
          <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
        </Button>
      </div>
      {slide(slides[at])}
      <Button className="self-end" onClick={() => setAt(null)}>
        {t("history.backToCheckpoint")}
      </Button>
    </section>
  );
}

/** Learn and Practice for one course (on its row in My courses). Learn with saved lessons first asks: start new or load an older one (M60).
 *  U4: Continue opens the newest saved lesson at once, with the same request as Load older → Open. */
export function CourseActions({
  number,
  current,
  hasPlan,
  last,
  callTool,
  go,
  practice,
}: {
  number: string;
  current: { id: string; title: string } | null;
  hasPlan: boolean;
  /** U4: the newest saved lesson (Home's data) */
  last?: Omit<SavedItem, "type"> | null;
  callTool: Tool;
  go: Go;
  practice: () => void;
}) {
  const { t } = useTranslation();
  const [lessons, setLessons] = useState<{ items: SavedItem[]; list: boolean } | null>(null);
  // the saved lessons this row last fetched (Learn) or kept after a delete: a deleted lesson loses its Continue at once
  const [known, setKnown] = useState<SavedItem[] | null>(null);
  const resume = last && (!known || known.some((i) => i.id === last.id)) ? last : null;
  const learn = async () => {
    if (!current) return;
    if (lessons) return setLessons(null); // a second press folds the choice away
    const items = ((await callTool("history_list", { number, kind: "lesson" })).structuredContent as { items?: SavedItem[] } | undefined)?.items ?? [];
    setKnown(items);
    if (items.length) setLessons({ items, list: false });
    else void go({ kind: "learn", stageId: current.id, title: current.title });
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!current} onClick={() => void learn()} aria-expanded={lessons ? true : undefined}>
          <BookOpen className="size-4" aria-hidden />
          {t("nav.learn")}
          {current ? ` — ${current.id}` : ""}
        </Button>
        {resume && (
          <Button
            variant="outline"
            className="max-w-full min-w-0"
            title={resume.title}
            aria-label={`${t("home.continue")}: ${resume.title}`}
            onClick={() => (setLessons(null), void go({ kind: "resume", number, id: resume.id }))}
          >
            <HistoryIcon className="size-4 shrink-0" aria-hidden />
            <span className="shrink-0">{t("home.continue")}</span>
            <span className="min-w-0 truncate font-normal" dir="auto">
              {resume.title}
            </span>
          </Button>
        )}
        <Button variant="outline" disabled={!hasPlan} onClick={practice}>
          <Dumbbell className="size-4" aria-hidden />
          {t("nav.practice")}
        </Button>
      </div>
      {lessons && current && (
        <div className="flex flex-col gap-3">
          <NewOrOlder
            kind="lesson"
            start={() => (setLessons(null), void go({ kind: "learn", stageId: current.id, title: current.title }))}
            older={() => setLessons({ ...lessons, list: true })}
          />
          {lessons.list && (
            <SavedList
              number={number}
              kind="lesson"
              callTool={callTool}
              items={lessons.items}
              onChange={(items) => (setKnown(items), items.length ? setLessons({ items, list: true }) : setLessons(null))}
              open={(i) => (setLessons(null), void go({ kind: "resume", number, id: i.id }))}
            />
          )}
        </div>
      )}
    </>
  );
}
