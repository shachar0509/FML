import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import type { LessonData, Go } from "../types";
import { Bar, h2, panel } from "../ui";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

export function Lesson({ data, callTool, go }: { data: LessonData; callTool: Tool; go: Go }) {
  const { t } = useTranslation();
  const [d, setD] = useState(data);
  const [confirm, setConfirm] = useState(false);
  const done = d.status === "completed" || d.status === "completed_override";
  const args = { number: d.number, stageId: d.stageId };
  const apply = (r: { structuredContent?: unknown; isError?: boolean }) =>
    !r.isError && r.structuredContent && setD(r.structuredContent as LessonData);

  // The tutor records progress in the chat; keep the card in step with it.
  useEffect(() => {
    if (done) return;
    const h = setInterval(() => void callTool("lesson_state", args).then(apply), 4000);
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, d.number, d.stageId]);

  const complete = async (by: "mastery" | "user_override") => {
    apply(await callTool("stage_complete", { ...args, by }));
    setConfirm(false);
  };
  const stage = (s: { id: string; title: string }, kind: "learn" | "relearn") =>
    void go({ kind, stageId: s.id, title: s.title });

  return (
    <section className="flex flex-col gap-4" aria-label={d.title}>
      <header className="hero flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-1.5">
          <span
            className="self-start rounded-full bg-(--board-ink)/20 text-(--board-fg) px-2.5 py-0.5 text-xs font-semibold tabular-nums"
            dir="ltr"
          >
            {d.stageId}
          </span>
          <h1 className="hand text-4xl leading-tight">{d.title}</h1>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-sm">
            <span className="text-(--board-muted)">{t("learn.mastery")}</span>
            <span className="font-semibold tabular-nums">{d.mastery}%</span>
          </div>
          <Bar pct={d.mastery} label={t("learn.mastery")} tone="bg-(--board-ink)" track="bg-(--board-muted)/30" />
        </div>
      </header>
      <div className={`${panel} p-4`}>
        <h2 className={`${h2} mb-2`}>{t("learn.objectives")}</h2>
        <ul className="flex flex-col gap-3">
          {d.objectives.map((o) => (
            <li key={o.text} className="flex items-start gap-2.5 text-[15px]">
              {o.covered ? (
                <Check className="mt-1 size-4 shrink-0 text-success" aria-label="covered" />
              ) : (
                <Circle className="mt-1 size-4 shrink-0 text-muted" aria-hidden />
              )}
              <Markdown>{o.text}</Markdown>
            </li>
          ))}
        </ul>
      </div>

      {done ? (
        <div className={`${panel} flex flex-col gap-3 border-success/50 p-4`}>
          <p className="flex items-center gap-2 font-medium">
            <span className="grid size-6 place-items-center rounded-full bg-success/15 text-success">
              <Check className="size-4" aria-hidden />
            </span>
            {t("learn.completed")}
          </p>
          <div className="flex flex-wrap gap-2">
            {d.next && (
              <Button onClick={() => stage(d.next as { id: string; title: string }, "learn")}>
                {t("learn.nextStage")}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() =>
                void callTool("stage_reopen", args).then(
                  (r) => (apply(r), stage({ id: d.stageId, title: d.title }, "relearn")),
                )
              }
            >
              {t("learn.again")}
            </Button>
          </div>
        </div>
      ) : d.criteria.met ? (
        <div className={`${panel} flex flex-col gap-3 border-success/50 p-4`}>
          <p className="font-medium">{t("stage.mastered")}</p>
          <Button className="self-start" onClick={() => void complete("mastery")}>
            {t("learn.completeStage")}
          </Button>
        </div>
      ) : confirm ? (
        <div
          className={`${panel} flex flex-col gap-2 border-warning/60 p-4`}
          role="alertdialog"
          aria-label={t("advance.title")}
        >
          <p className="font-medium">{t("advance.title")}</p>
          <p className="text-sm">{t("advance.body")}</p>
          <ul className="list-disc ps-5 text-sm">
            {d.criteria.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="text-sm text-muted">{t("advance.note")}</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void complete("user_override")}>
              {t("advance.confirm")}
            </Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              {t("advance.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setConfirm(true)}>
          {t("learn.completeAnyway")}
        </Button>
      )}
    </section>
  );
}
