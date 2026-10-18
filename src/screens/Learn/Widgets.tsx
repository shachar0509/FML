import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { askOpenQuestion, assignExercise, presentMcq } from "@/claude/tutorTools";
import type { ToolUseBlock } from "@/claude/types";
import type { Grade } from "@/claude/practiceTools";
import { Button } from "@/components/ui/button";
import type { Lesson } from "@/domain/learn/engine";
import type { ExerciseRun } from "@/domain/practice/run";
import { Markdown } from "@/render/Markdown";
import { ExerciseCard } from "@/screens/Exercise/ExerciseCard";
import { GradeCard } from "@/screens/Exercise/GradeCard";
import { AttachButton, Chips } from "./Attach";
import { useAttachments } from "./useAttachments";

const card = "flex flex-col gap-3 rounded-card border border-border bg-card p-4";
const parse = (s?: string): Record<string, unknown> => {
  try {
    return s ? (JSON.parse(s) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

function Mcq({ u, lesson }: { u: ToolUseBlock; lesson: Lesson }) {
  const { t } = useTranslation();
  const q = presentMcq.schema.safeParse(u.input);
  if (!q.success) return null;
  const st = lesson.stateOf(u.id);
  const r = parse(st?.content);
  const picked = typeof r.selectedIndex === "number" ? r.selectedIndex : null;
  const open = !st && lesson.pending().some((p) => p.id === u.id);
  const { questionMd, options, correctIndex, explanationMd } = q.data;
  return (
    <div className={card}>
      <Markdown>{questionMd}</Markdown>
      <div className="flex flex-col gap-2">
        {options.map((o, i) => {
          const tone =
            picked === null ? "border-border hover:border-primary"
            : i === correctIndex ? "border-success"
            : i === picked ? "border-danger" : "border-border opacity-60";
          return (
            <button key={i} type="button" disabled={!open || lesson.busy} onClick={() => void lesson.answerMcq(u.id, i)}
              className={`flex items-start gap-3 rounded-lg border p-3 text-start ${tone}`}>
              <span className="font-bold">{"ABCDEF"[i]}</span>
              <span className="min-w-0 flex-1"><Markdown>{o}</Markdown></span>
              {picked !== null && i === correctIndex && <Check className="size-4 text-success" aria-label={t("learn.correct")} />}
              {picked === i && i !== correctIndex && <X className="size-4 text-danger" aria-label={t("learn.wrong")} />}
            </button>
          );
        })}
      </div>
      {picked !== null && <div className="border-t border-border pt-3"><Markdown>{explanationMd}</Markdown></div>}
      {st && picked === null && <p className="text-sm text-muted">{t("learn.interjected")}</p>}
    </div>
  );
}

function Open({ u, lesson }: { u: ToolUseBlock; lesson: Lesson }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const atts = useAttachments(lesson.courseNumber);
  const q = askOpenQuestion.schema.safeParse(u.input);
  if (!q.success) return null;
  const st = lesson.stateOf(u.id);
  const r = parse(st?.content);
  const open = !st && lesson.pending().some((p) => p.id === u.id);
  const send = () => {
    if (!text.trim() && !atts.items.length) return;
    void lesson.answerOpen(u.id, text.trim(), atts.refs());
  };
  return (
    <div className={card}>
      <Markdown>{q.data.questionMd}</Markdown>
      {typeof r.answerText === "string" ? (
        <div className="rounded-lg bg-border/50 p-3">
          <p className="text-xs text-muted">{t("learn.yourAnswer")}</p>
          <p dir="auto" className="whitespace-pre-wrap">{r.answerText}</p>
        </div>
      ) : st ? (
        <p className="text-sm text-muted">{t("learn.interjected")}</p>
      ) : (
        open && (
          <>
            <textarea dir="auto" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("learn.answerPlaceholder")}
              className="rounded-lg border border-border bg-bg p-2 text-sm" />
            <Chips atts={atts} />
            <div className="flex items-center gap-2">
              {q.data.allowAttachment && <AttachButton atts={atts} disabled={lesson.busy} />}
              <Button className="ms-auto" disabled={lesson.busy} onClick={send}>{t("learn.sendAnswer")}</Button>
            </div>
          </>
        )
      )}
    </div>
  );
}

function Exercise({ u, lesson }: { u: ToolUseBlock; lesson: Lesson }) {
  const { t } = useTranslation();
  const [run, setRun] = useState<ExerciseRun | null>(null);
  const [done, setDone] = useState(false);
  const q = assignExercise.schema.safeParse(u.input);
  const st = lesson.stateOf(u.id);
  const open = !st && lesson.pending().some((p) => p.id === u.id);
  useEffect(() => {
    if (open) void lesson.exerciseRun(u.id).then(setRun).catch(() => null);
  }, [open, lesson, u.id]);
  if (!q.success) return null;
  const r = parse(st?.content);
  const graded = st && typeof r.verdict === "string" ? (r as unknown as Grade & { hintsUsed?: number; solutionRevealed?: boolean }) : null;
  const skip = (
    <Button variant="ghost" className="ms-auto" disabled={lesson.busy} onClick={() => void lesson.skipExercise(u.id)}>{t("learn.skip")}</Button>
  );
  if (run && (open || (graded && !done)))
    return (
      <div className="flex flex-col gap-3">
        <ExerciseCard run={run} courseNumber={lesson.courseNumber} />
        <div className="flex">
          {open && skip}
          {graded && (
            <Button className="ms-auto" disabled={lesson.busy} onClick={() => { setDone(true); void lesson.continueAfterExercise(); }}>{t("exercise.continue")}</Button>
          )}
        </div>
      </div>
    );
  return (
    <div className={card}>
      <p className="text-sm font-bold">{t("learn.exercise")}</p>
      {graded ? (
        <GradeCard grade={graded} hintsUsed={graded.hintsUsed ?? 0} solutionRevealed={!!graded.solutionRevealed} />
      ) : (
        <>
          <Markdown>{q.data.statementMd ?? `exercise ${q.data.exerciseId ?? ""}`}</Markdown>
          {st && r.skipped ? <p className="text-sm text-muted">{t("learn.skipped")}</p>
            : st ? <p className="text-sm text-muted">{t("learn.interjected")}</p>
            : open && <div className="flex">{skip}</div>}
        </>
      )}
    </div>
  );
}

/** Blocking tool_use -> widget; other tools render nothing. */
export function Widget({ u, lesson }: { u: ToolUseBlock; lesson: Lesson }) {
  if (u.name === presentMcq.def.name) return <Mcq u={u} lesson={lesson} />;
  if (u.name === askOpenQuestion.def.name) return <Open u={u} lesson={lesson} />;
  if (u.name === assignExercise.def.name) return <Exercise u={u} lesson={lesson} />;
  return null;
}
