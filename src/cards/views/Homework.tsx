import { useEffect, useState } from "react";
import { Check, Download, GraduationCap, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import type { Go, HomeworkData, PracticeData } from "../types";
import { ErrorNote, errorKey } from "../errors";
import { Board, chalkChoice } from "../ui";
import { AnswerFiles, type FileRef } from "./AnswerFiles";
import { Exercise } from "./Exercise";
import { Waiting } from "./Waiting";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

/**
 * M57: the student's own homework (or one question) in Practice: upload, the host model reads the questions, then each
 * one is solved with the solving loop; perfect solutions make up the downloadable solution file.
 */
export function Homework({
  number,
  kind,
  hw,
  callTool,
  go,
  set,
  back,
}: {
  number: string;
  kind: HomeworkData["kind"];
  hw: HomeworkData | null;
  callTool: Tool;
  go: Go;
  set: (d: PracticeData) => void;
  back: () => void;
}) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<FileRef[]>([]);
  const [up, setUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await callTool(name, { courseNumber: number, ...args });
    setBusy(false);
    if (r.structuredContent) set(r.structuredContent as PracticeData);
    return r;
  };
  const refresh = () => void call("practice_state");
  const stop = () => void callTool("shalav_cancel", { key: `hw:${number}` });

  // The questions are read (and, M58, solved) by Claude in the chat; follow it until they land.
  const waiting = !!hw?.splitting || !!hw?.solving;
  useEffect(() => {
    if (!waiting) return;
    const h = setInterval(
      () =>
        void callTool("practice_state", { courseNumber: number }).then(
          (r) => r.structuredContent && set(r.structuredContent as PracticeData),
        ),
      2500,
    );
    return () => clearInterval(h);
  }, [waiting, number, callTool, set]);

  const k = hw?.kind ?? kind;
  const title = t(`homework.title.${k}`);

  if (!hw)
    return (
      <section className="flex flex-col gap-4" aria-label={title}>
        <Board title={title}>
          <p className="text-[15px]">{t(`homework.intro.${k}`)}</p>
        </Board>
        <AnswerFiles
          number={number}
          callTool={callTool}
          files={files}
          setFiles={setFiles}
          disabled={busy}
          onBusy={setUp}
          hint={t(`homework.drop.${k}`)}
          button={t(`homework.upload.${k}`)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={back}>
            {t("homework.back")}
          </Button>
          <Button
            className="ms-auto h-11 px-6 text-[15px]"
            disabled={busy || up || files.length === 0}
            onClick={async () => {
              const r = await call("homework_start", {
                kind: k,
                files: files.map(({ sha256, mediaType }) => ({ sha256, mediaType })),
              });
              if (!r.isError) void go();
            }}
          >
            {t("homework.read")}
          </Button>
        </div>
      </section>
    );

  const end = async () => (await call("homework_end"), back());
  const solvedAll = hw.questions.length > 0 && hw.questions.every((q) => q.accepted);
  const accepted = hw.questions.filter((q) => q.accepted).length;
  const cur = hw.questions[hw.current];
  const next = [...hw.questions.keys()]
    .map((i) => (hw.current + 1 + i) % hw.questions.length)
    .find((i) => !hw.questions[i]?.accepted);

  if (hw.splitting || hw.error || !hw.questions.length)
    return (
      <section className="flex flex-col gap-4" aria-label={title}>
        <Board title={title}>
          {hw.error || !hw.splitting ? (
            <ErrorNote raw={hw.error} fallback="homework.failed" className="" />
          ) : (
            <Waiting go={go} label={t("homework.reading")} cancel={stop} />
          )}
        </Board>
        {(hw.error || !hw.splitting) && (
          <Button className="self-end" onClick={() => void end()}>
            {t("homework.again")}
          </Button>
        )}
      </section>
    );

  if (!hw.how)
    return (
      <section className="flex flex-col gap-4" aria-label={title}>
        <Board title={t("homework.how")}>
          <p className="board-note">
            {hw.name} · {t("homework.found", { count: hw.questions.length })}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className={`${chalkChoice} flex flex-col items-start gap-1.5 p-4 text-start disabled:opacity-60`}
              disabled={busy}
              onClick={() => void call("homework_how", { how: "tutor" })}
            >
              <span className="flex items-center gap-2 text-[17px] font-semibold">
                <GraduationCap className="size-5" aria-hidden />
                {t("homework.tutor")}
              </span>
              <span className="text-sm text-(--board-muted)">{t("homework.tutorText")}</span>
            </button>
            <button
              className={`${chalkChoice} flex flex-col items-start gap-1.5 p-4 text-start disabled:opacity-60`}
              disabled={busy}
              onClick={async () =>
                !(await call("homework_how", { how: "ai" })).isError && void go()
              }
            >
              <span className="flex items-center gap-2 text-[17px] font-semibold">
                <Sparkles className="size-5" aria-hidden />
                {t("homework.ai")}
              </span>
              <span className="text-sm text-(--board-muted)">{t("homework.aiText")}</span>
            </button>
          </div>
        </Board>
        <Button variant="ghost" className="self-start" onClick={() => void end()}>
          {t("homework.end")}
        </Button>
      </section>
    );

  // M58: the AI solves every question, then the solutions are printed as a PDF to download
  if (hw.how === "ai") {
    const s = hw.solving;
    return (
      <section className="flex flex-col gap-4" aria-label={hw.name || title}>
        <Board
          title={hw.name || title}
          badge={t("homework.solvedOf", { done: s?.done ?? accepted, total: hw.questions.length })}
        >
          <ul className="flex flex-col gap-1.5">
            {hw.questions.map((q, i) => (
              <li key={i} className="flex items-center gap-2 text-[15px]">
                {q.accepted ? (
                  <Check
                    className="size-4 shrink-0 text-(--board-ink)"
                    aria-label={t("homework.written")}
                  />
                ) : (
                  <span
                    className="size-4 shrink-0 rounded-full border-2 border-(--board-fg)/30"
                    aria-hidden
                  />
                )}
                {q.label}
              </li>
            ))}
          </ul>
          {s && (
            <Waiting
              go={go}
              cancel={stop}
              label={
                s.step === "solve"
                  ? t("homework.solving", { n: Math.min(s.done + 1, s.total), of: s.total })
                  : s.install !== null && s.install < 100
                    ? t("homework.installing", { pct: s.install })
                    : t("homework.printing")
              }
            />
          )}
          {/* not solving and no PDF: it failed, was stopped, or Shalav restarted — it can go on from the first unsolved question */}
          {!s &&
            !hw.ready &&
            (hw.error && errorKey(hw.error) !== "job.stopped" ? (
              <ErrorNote raw={hw.error} fallback="homework.solveFailed" className="" />
            ) : (
              <p role="status">{t("homework.paused")}</p>
            ))}
        </Board>
        <div className="flex flex-wrap items-center gap-2">
          {!s && !hw.ready && (
            <Button
              variant="outline"
              onClick={async () =>
                !(await call("homework_how", { how: "ai" })).isError && void go()
              }
            >
              {t("homework.resume")}
            </Button>
          )}
          <Button variant="ghost" onClick={() => void end()}>
            {t("homework.end")}
          </Button>
          <Button
            className="ms-auto h-11 px-6 text-[15px]"
            disabled={busy || !hw.ready}
            onClick={() => void call("homework_download")}
          >
            <Download className="size-4" aria-hidden />
            {t("homework.downloadAi")}
          </Button>
        </div>
        {hw.saved && (
          <p className="text-sm text-muted" role="status" dir="auto">
            {t("homework.saved", { path: hw.saved })}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4" aria-label={hw.name || title}>
      {hw.kind === "homework" && (
        <nav aria-label={t("homework.questions")} className="flex flex-wrap items-center gap-2">
          {hw.questions.map((q, i) => (
            <button
              key={i}
              aria-current={i === hw.current ? "step" : undefined}
              disabled={busy}
              onClick={() => void call("homework_open", { index: i })}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ${i === hw.current ? "border-primary bg-primary text-primary-fg" : "border-border bg-card hover:border-primary/60"}`}
            >
              {q.accepted && <Check className="size-3.5" aria-label={t("homework.accepted")} />}
              {q.label}
            </button>
          ))}
        </nav>
      )}
      {hw.exercise && (
        <Exercise
          key={hw.exercise.runId}
          data={hw.exercise}
          callTool={callTool}
          go={go}
          title={hw.kind === "homework" ? cur?.label : t("homework.title.single")}
          onData={(e) => e.perfect && refresh()}
        />
      )}
      {cur?.accepted && (
        <div className="flex flex-wrap items-center gap-2" role="status">
          <p className="flex grow items-center gap-2 text-[15px] font-medium">
            <Check className="size-5 shrink-0 text-success" aria-hidden />
            {hw.kind === "single"
              ? t("homework.solved")
              : solvedAll
                ? t("homework.allDone")
                : t("homework.added")}
          </p>
          {hw.kind === "homework" && next !== undefined && (
            <Button
              className="h-11 px-6 text-[15px]"
              onClick={() => void call("homework_open", { index: next })}
            >
              {t("homework.next")}
            </Button>
          )}
          {hw.kind === "single" && (
            <Button className="h-11 px-6 text-[15px]" onClick={() => void call("homework_end")}>
              {t("homework.newQuestion")}
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {hw.kind === "homework" && (
          <Button
            variant="outline"
            disabled={busy || accepted === 0}
            onClick={() => void call("homework_download")}
          >
            <Download className="size-4" aria-hidden />
            {t("homework.download", { n: accepted })}
          </Button>
        )}
        <Button variant="ghost" className="ms-auto" onClick={() => void end()}>
          {t("homework.end")}
        </Button>
      </div>
      {hw.saved && (
        <p className="text-sm text-muted" role="status" dir="auto">
          {t("homework.saved", { path: hw.saved })}
        </p>
      )}
    </section>
  );
}
