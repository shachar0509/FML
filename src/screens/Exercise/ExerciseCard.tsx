import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { canReveal, type ExerciseRun } from "@/domain/practice/run";
import { Markdown } from "@/render/Markdown";
import { Thumb } from "@/render/Lightbox";
import { Chips } from "@/screens/Learn/Attach";
import { GradeCard, readable } from "./GradeCard";
import { PickButton, useAnswerFiles, useCropUrl, useSub } from "./parts";

function Figure({ course, file, n }: { course: string; file: string; n: number }) {
  const { t } = useTranslation();
  const url = useCropUrl(course, file);
  return url ? <Thumb src={url} alt={t("exercise.figure", { n })} /> : null;
}

/** Statement, hints, upload/submit, solution reveal and the grade of one ExerciseRun (Learn and Practice). */
export function ExerciseCard({ run, courseNumber, onGraded }: { run: ExerciseRun; courseNumber: string; onGraded?: () => void }) {
  useSub(run);
  const { t } = useTranslation();
  const files = useAnswerFiles(courseNumber);
  const hintFiles = useAnswerFiles(courseNumber);
  const [hintOpen, setHintOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const { ex, state: s } = run;
  const done = readable(s.grade);
  const attempts = useRef(s.attempts);
  useEffect(() => {
    if (s.attempts > attempts.current && s.grade) onGraded?.();
    attempts.current = s.attempts;
  }, [s.attempts, s.grade, onGraded]);

  async function submit() {
    if ((await run.submit(files.refs())) !== null) files.clear();
  }
  async function hint() {
    await run.hint(hintFiles.refs());
    hintFiles.clear();
    setHintOpen(false);
  }
  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-4">
      <p className="text-xs text-muted">{t("exercise.difficulty", { n: ex.difficulty })}</p>
      <Markdown>{ex.statementMd}</Markdown>
      {ex.figures.length > 0 && (
        <div className="flex flex-wrap gap-2">{ex.figures.map((f, i) => <Figure key={f.file} course={courseNumber} file={f.file} n={i + 1} />)}</div>
      )}
      {s.hints.length > 0 && (
        <div className="flex flex-col gap-2">
          <h4 className="font-medium">{t("exercise.hints")}</h4>
          {s.hints.map((h) => (
            <div key={h.level} className="rounded-lg bg-border/50 p-3 text-sm"><Markdown>{h.hintMd}</Markdown></div>
          ))}
        </div>
      )}
      {s.grade && <GradeCard grade={s.grade} hintsUsed={s.hints.length} solutionRevealed={!!s.solutionMd} />}
      {s.solutionMd && (
        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <h4 className="font-medium">{t("exercise.solution")}</h4>
          <Markdown>{s.solutionMd}</Markdown>
        </div>
      )}
      {run.error && <p role="alert" className="text-sm text-danger">{t(run.error, { defaultValue: run.error })}</p>}
      {!done && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void files.add(e.dataTransfer.files); }}
          className={`flex flex-col gap-2 rounded-lg border border-dashed p-3 ${drag ? "border-primary bg-primary/5" : "border-border"}`}
        >
          <p className="text-sm text-muted">{t("exercise.drop")}</p>
          <Chips atts={files} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!done && (
          <>
            <PickButton files={files} label={t("exercise.upload")} disabled={run.busy} />
            <Button disabled={run.busy || files.items.length === 0} onClick={() => void submit()}>
              {run.busy ? t("exercise.grading") : t("exercise.submit")}
            </Button>
            <Button variant="outline" disabled={run.busy || s.hints.length >= 3} onClick={() => setHintOpen(true)}>
              {t("exercise.hintN", { n: run.level })}
            </Button>
          </>
        )}
        {canReveal(s) && <Button variant="ghost" disabled={run.busy} onClick={() => void run.reveal()}>{t("exercise.showSolution")}</Button>}
      </div>
      <Dialog open={hintOpen} onOpenChange={setHintOpen}>
        <DialogContent>
          <div className="flex flex-col gap-3">
            <DialogTitle className="font-bold">{t("exercise.hintN", { n: run.level })}</DialogTitle>
            <DialogDescription className="text-sm">{t("exercise.hintBody")}</DialogDescription>
            <Chips atts={hintFiles} />
            <div className="flex gap-2">
              <PickButton files={hintFiles} label={t("exercise.upload")} disabled={run.busy} />
              <Button className="ms-auto" disabled={run.busy} onClick={() => void hint()}>{t("exercise.getHint")}</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
