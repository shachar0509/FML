import { useEffect, useState } from "react";
import { Waiting } from "./Waiting";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import { GradeCard, readable } from "./GradeCard";
import { h2, panel } from "../ui";
import type { ExerciseData, Go } from "../types";
import { AnswerFiles, type FileRef } from "./AnswerFiles";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

export function Exercise({ data, callTool, go }: { data: ExerciseData; callTool: Tool; go: Go }) {
  const { t } = useTranslation();
  const [d, setD] = useState(data);
  const [files, setFiles] = useState<FileRef[]>([]);
  const [err, setErr] = useState(false);
  const [up, setUp] = useState(false);
  const done = readable(d.grade);
  const apply = (r: { structuredContent?: unknown; isError?: boolean }) => {
    setErr(!!r.isError || !r.structuredContent);
    if (!r.isError && r.structuredContent) setD(r.structuredContent as ExerciseData);
    return !r.isError;
  };

  // A grade/hint/solution is produced by Claude in the chat; follow it until it lands.
  useEffect(() => {
    if (!d.busy) return;
    const h = setInterval(
      () => void callTool("exercise_state", { runId: d.runId }).then(apply),
      2000,
    );
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.busy, d.runId]);

  const refs = () => files.map(({ sha256, mediaType }) => ({ sha256, mediaType }));
  async function ask(tool: string, args: Record<string, unknown>) {
    if (apply(await callTool(tool, { runId: d.runId, ...args }))) {
      setFiles([]);
      void go();
    }
  }
  const busy = !!d.busy;
  const level = Math.min(3, d.hints.length + 1);

  return (
    <section className="flex flex-col gap-4" aria-label={t("learn.exercise")}>
      <div className="board-surface board mb-3 flex flex-col gap-3 px-5 py-5 sm:px-7">
        <p className="self-start rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {t("exercise.difficulty", { n: d.difficulty })}
        </p>
        <div className="lesson-text">
          <Markdown>{d.statementMd}</Markdown>
        </div>
        {d.figures.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {d.figures.map((s, i) => (
              <img
                key={i}
                src={s}
                alt={t("exercise.figure", { n: i + 1 })}
                className="max-h-48 rounded-lg border border-border"
              />
            ))}
          </div>
        )}
      </div>
      {d.hints.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className={h2}>{t("exercise.hints")}</h2>
          {d.hints.map((h) => (
            <div
              key={h.level}
              className="rounded-card border border-border border-s-4 border-s-warning bg-card p-3 text-sm shadow-card"
            >
              <Markdown>{h.hintMd}</Markdown>
            </div>
          ))}
        </div>
      )}
      {d.grade && (
        <GradeCard grade={d.grade} hintsUsed={d.hints.length} solutionRevealed={!!d.solutionMd} />
      )}
      {d.solutionMd && (
        <div className={`${panel} flex flex-col gap-1 p-4`}>
          <h2 className={h2}>{t("exercise.solution")}</h2>
          <Markdown>{d.solutionMd}</Markdown>
        </div>
      )}
      {busy && <Waiting go={go} label={d.busy === "grade" ? t("exercise.grading") : undefined} />}
      {(err || d.error) && (
        <p role="alert" className="text-sm text-danger">
          {t("exercise.failed")}
        </p>
      )}
      {!done && (
        <AnswerFiles
          number={d.number}
          callTool={callTool}
          files={files}
          setFiles={setFiles}
          disabled={busy}
          onBusy={setUp}
          hint={t("exercise.drop")}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {!done && (
          <>
            <Button
              disabled={busy || up || files.length === 0}
              onClick={() => void ask("exercise_grade_request", { files: refs() })}
            >
              {busy && d.busy === "grade" ? t("exercise.grading") : t("exercise.submit")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || up || d.hints.length >= 3}
              onClick={() => void ask("exercise_hint_request", { files: refs() })}
            >
              {t("exercise.hintN", { n: level })}
            </Button>
          </>
        )}
        {d.canReveal && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void ask("exercise_solution_request", {})}
          >
            {t("exercise.showSolution")}
          </Button>
        )}
        {d.grade && !done && (
          <Button
            variant="outline"
            onClick={async () => void apply(await callTool("exercise_retry", { runId: d.runId }))}
          >
            {t("exercise.retry")}
          </Button>
        )}
      </div>
    </section>
  );
}
