import { useEffect, useState } from "react";
import { Waiting } from "./Waiting";
import { Lightbulb } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import { GradeCard, readable } from "./GradeCard";
import { Board, h2, inkBox, panel } from "../ui";
import type { ExerciseData, Go } from "../types";
import { AnswerFiles, type FileRef } from "./AnswerFiles";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

export function Exercise({
  data,
  callTool,
  go,
  title,
  onData,
}: {
  data: ExerciseData;
  callTool: Tool;
  go: Go;
  title?: string;
  /** every new state of the card (the homework list follows a perfect answer) */
  onData?: (d: ExerciseData) => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(data);
  const [files, setFiles] = useState<FileRef[]>([]);
  const [err, setErr] = useState(false);
  const [up, setUp] = useState(false);
  const done = readable(d.grade);
  const apply = (r: { structuredContent?: unknown; isError?: boolean }) => {
    setErr(!!r.isError || !r.structuredContent);
    if (!r.isError && r.structuredContent) {
      setD(r.structuredContent as ExerciseData);
      onData?.(r.structuredContent as ExerciseData);
    }
    return !r.isError;
  };

  // The host renders the card from its stored result (e.g. back in this chat later): show the live state.
  useEffect(() => {
    void callTool("exercise_state", { runId: d.runId })
      .then((r) => !r.isError && r.structuredContent && apply(r))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  const loop = !!d.loop;
  const clues = d.clues ?? [];
  const open = loop && !!d.clueOpen; // a clue is on the board: understood it, or explain again
  const solved = loop ? !!d.perfect : done;

  return (
    <section className="flex flex-col gap-4" aria-label={t("learn.exercise")}>
      <Board
        title={title ?? t("learn.exercise")}
        badge={d.difficulty > 0 && t("exercise.difficulty", { n: d.difficulty })}
      >
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
        {clues.map((c, i) => (
          <div
            key={i}
            className={`${inkBox} flex flex-col gap-2`}
            role={i === clues.length - 1 ? "status" : undefined}
          >
            <p className="board-note">
              {c.onTrack ? t("loop.clueN", { n: i + 1 }) : t("loop.mistake")}
            </p>
            <div className="board-note">
              <Markdown>{c.clueMd}</Markdown>
            </div>
            {c.more.map((m, j) => (
              <div
                key={j}
                className="board-note border-t border-dashed border-(--board-ink)/40 pt-2"
              >
                <Markdown>{m}</Markdown>
              </div>
            ))}
          </div>
        ))}
        {d.perfect && (
          <p className="board-note text-xl" role="status">
            {t("loop.perfect")}
          </p>
        )}
      </Board>
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
      {busy && (
        <Waiting
          go={go}
          label={d.busy === "grade" ? t("exercise.grading") : undefined}
          cancel={() => void callTool("shalav_cancel", { key: `exercise:${d.runId}` })}
        />
      )}
      {open && !busy && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void ask("exercise_clarify_request", {})}>
            {t("loop.notUnderstood")}
          </Button>
          <Button
            className="ms-auto h-11 px-6 text-[15px]"
            onClick={async () =>
              void apply(await callTool("exercise_clue_done", { runId: d.runId }))
            }
          >
            {t("loop.thanks")}
          </Button>
        </div>
      )}
      {(err || d.error) && (
        <p role="alert" className="text-sm text-danger">
          {t("exercise.failed")}
        </p>
      )}
      {!solved && !open && (
        <AnswerFiles
          number={d.number}
          callTool={callTool}
          files={files}
          setFiles={setFiles}
          disabled={busy}
          onBusy={setUp}
          hint={loop ? t("loop.drop") : t("exercise.drop")}
        />
      )}
      {loop && !solved && !open && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={busy || up}
            onClick={() => void ask("exercise_clue_request", { files: refs() })}
          >
            <Lightbulb className="size-4" aria-hidden />
            {t("loop.clue")}
          </Button>
          <Button
            className="ms-auto h-11 px-6 text-[15px]"
            disabled={busy || up || files.length === 0}
            onClick={() => void ask("exercise_grade_request", { files: refs() })}
          >
            {busy && d.busy === "grade" ? t("exercise.grading") : t("loop.submit")}
          </Button>
        </div>
      )}
      {!loop && (
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
      )}
    </section>
  );
}
