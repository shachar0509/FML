import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolUseBlock } from "@/claude/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isControl, type Lesson } from "@/domain/learn/engine";
import { Markdown } from "@/render/Markdown";
import { Composer } from "./Composer";
import { Widget } from "./Widgets";

function useLesson(l: Lesson) {
  const v = useRef(0);
  useSyncExternalStore(
    useCallback((cb: () => void) => l.subscribe(() => { v.current++; cb(); }), [l]),
    () => v.current,
  );
}

const Bar = ({ pct }: { pct: number }) => (
  <div className="h-2 w-28 overflow-hidden rounded-full bg-border"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
);

export function LessonView({ lesson }: { lesson: Lesson }) {
  useLesson(lesson);
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const nLines = lesson.lines.length;
  useEffect(() => end.current?.scrollIntoView?.({ block: "end" }), [nLines, lesson.streaming, lesson.busy, lesson.consulting]);
  if (!lesson.plan || !lesson.stage) return null;

  const { courseNumber: n, stageId: id, stage, criteria } = lesson;
  const sp = lesson.progress.stages[id];
  const idx = lesson.plan.stages.findIndex((s) => s.id === id);
  const next = lesson.plan.stages[idx + 1]?.id;
  const nextTo = next ? `/course/${n}/learn/${next}` : `/course/${n}`;
  const mastered = !!criteria?.met && !lesson.readOnly;

  const advance = async () => {
    if (criteria?.met) await lesson.complete("mastery");
    else setConfirm(true);
  };
  const goNext = async () => {
    if (!lesson.readOnly) await lesson.complete("mastery");
    void navigate(nextTo);
  };

  const parts = lesson.lines.flatMap((l) => {
    if (l.kind !== "message") return [];
    return l.content.flatMap((b, i) => {
      const key = `${l.id}:${i}`;
      if (l.role === "user") {
        if (b.type === "text" && !isControl(b)) return [<div key={key} dir="auto" className="max-w-[80%] self-end whitespace-pre-wrap rounded-card bg-primary/10 px-3 py-2">{b.text}</div>];
        if (b.type === "image_ref") return [<div key={key} className="self-end text-xs text-muted">[image]</div>];
        return [];
      }
      if (b.type === "text") return [<div key={key} className="rounded-card border border-border bg-card p-4"><Markdown>{b.text}</Markdown></div>];
      if (b.type === "tool_use") return [<Widget key={key} u={b as ToolUseBlock} lesson={lesson} />];
      return [];
    });
  });

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-3">
        <Link to={`/course/${n}`} className="text-sm text-muted hover:text-fg">{t("learn.back")}</Link>
        <h1 className="font-bold"><span dir="ltr">{id}</span> · {stage.title}</h1>
        <div className="ms-auto flex items-center gap-3">
          <details className="relative">
            <summary className="cursor-pointer text-sm">{t("learn.objectives")}</summary>
            <ul className="absolute end-0 z-10 mt-1 flex w-72 flex-col gap-1 rounded-card border border-border bg-card p-3 text-sm shadow">
              {stage.objectives.map((o, i) => (
                <li key={i} className="flex gap-2">
                  <Check className={`mt-0.5 size-4 shrink-0 ${sp?.coveredObjectives.includes(i) ? "text-success" : "text-transparent"}`} />
                  <span dir="auto">{o}</span>
                </li>
              ))}
            </ul>
          </details>
          <span className="flex items-center gap-2 text-xs text-muted">{t("learn.mastery")}<Bar pct={Math.round((sp?.mastery ?? 0) * 100)} /></span>
          {!lesson.readOnly && <Button variant="outline" onClick={() => void advance()}>{t("learn.advance")}</Button>}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {parts}
        {lesson.streaming && <div className="rounded-card border border-border bg-card p-4"><Markdown>{lesson.streaming}</Markdown></div>}
        {lesson.consulting && <p className="text-sm text-muted">{t("learn.checking")}</p>}
        {(lesson.error || lesson.needsRetry) && !lesson.busy && (
          <div className="flex items-center gap-3 rounded-card border border-danger p-3 text-sm">
            <div className="flex-1"><p>{t("api.failed")}</p>{lesson.error && <p dir="ltr" className="text-xs text-muted">{lesson.error}</p>}</div>
            <Button variant="outline" onClick={() => void lesson.retry()}>{t("learn.retry")}</Button>
          </div>
        )}
        <div ref={end} />
      </div>

      {mastered && !dismissed && (
        <div className="flex flex-wrap items-center gap-3 border-t border-success bg-card p-3">
          <p className="flex-1 font-bold">{t("stage.mastered")}</p>
          <Button onClick={() => void goNext()}>{t("learn.nextStage")}</Button>
          <Button variant="ghost" onClick={() => setDismissed(true)}>{t("learn.keep")}</Button>
        </div>
      )}
      {lesson.readOnly ? (
        <div className="flex flex-wrap items-center gap-3 border-t border-border bg-card p-3">
          <p className="flex-1 font-bold">{t("learn.completed")}</p>
          <Button onClick={() => void navigate(nextTo)}>{t("learn.nextStage")}</Button>
          <Button variant="outline" onClick={() => void lesson.reopen()}>{t("learn.again")}</Button>
        </div>
      ) : (
        <Composer lesson={lesson} />
      )}

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle className="mb-2 text-lg font-bold">{t("advance.title")}</DialogTitle>
          <DialogDescription className="mb-2 text-sm">{t("advance.body")}</DialogDescription>
          {criteria?.missing.length ? <ul className="mb-2 list-disc ps-5 text-sm">{criteria.missing.map((m) => <li key={m}>{m}</li>)}</ul> : null}
          <p className="mb-4 text-sm text-muted">{t("advance.note")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("advance.cancel")}</Button>
            <Button onClick={() => { setConfirm(false); void lesson.complete("user_override").then(() => navigate(nextTo)); }}>{t("advance.confirm")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
