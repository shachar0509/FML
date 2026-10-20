import { useEffect, useState } from "react";
import { Check, Circle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/render/Markdown";
import type { LessonData } from "../types";

type Tool = (name: string, args?: Record<string, unknown>) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

export function Lesson({ data, callTool, say }: { data: LessonData; callTool: Tool; say: (t: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [d, setD] = useState(data);
  const [confirm, setConfirm] = useState(false);
  const done = d.status === "completed" || d.status === "completed_override";
  const args = { number: d.number, stageId: d.stageId };
  const apply = (r: { structuredContent?: unknown; isError?: boolean }) => !r.isError && r.structuredContent && setD(r.structuredContent as LessonData);

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
  const stage = (s: { id: string; title: string }, key: "mcp.learn" | "mcp.relearn") => void say(t(key, { stage: `${s.id} · ${s.title}` }));

  return (
    <section className="flex flex-col gap-4 p-4" aria-label={d.title}>
      <header>
        <p className="text-sm text-muted">{d.stageId}</p>
        <h1 className="text-xl font-semibold">{d.title}</h1>
      </header>
      <div>
        <div className="mb-1 flex justify-between text-sm"><span>{t("learn.mastery")}</span><span>{d.mastery}%</span></div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-label={t("learn.mastery")} aria-valuenow={d.mastery} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-primary" style={{ width: `${d.mastery}%` }} />
        </div>
      </div>
      <div>
        <h2 className="mb-1 text-sm font-medium">{t("learn.objectives")}</h2>
        <ul className="flex flex-col gap-1">
          {d.objectives.map((o) => (
            <li key={o.text} className="flex items-start gap-2 text-sm">
              {o.covered ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="covered" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />}
              <Markdown>{o.text}</Markdown>
            </li>
          ))}
        </ul>
      </div>

      {done ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 font-medium"><Check className="size-4 text-success" aria-hidden />{t("learn.completed")}</p>
          <div className="flex flex-wrap gap-2">
            {d.next && <Button onClick={() => stage(d.next as { id: string; title: string }, "mcp.learn")}>{t("learn.nextStage")}</Button>}
            <Button variant="outline" onClick={() => void callTool("stage_reopen", args).then((r) => (apply(r), stage({ id: d.stageId, title: d.title }, "mcp.relearn")))}>{t("learn.again")}</Button>
          </div>
        </div>
      ) : d.criteria.met ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <p className="font-medium">{t("stage.mastered")}</p>
          <Button className="self-start" onClick={() => void complete("mastery")}>{t("learn.completeStage")}</Button>
        </div>
      ) : confirm ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3" role="alertdialog" aria-label={t("advance.title")}>
          <p className="font-medium">{t("advance.title")}</p>
          <p className="text-sm">{t("advance.body")}</p>
          <ul className="list-disc ps-5 text-sm">{d.criteria.missing.map((m) => <li key={m}>{m}</li>)}</ul>
          <p className="text-sm text-muted">{t("advance.note")}</p>
          <div className="flex gap-2">
            <Button variant="danger" onClick={() => void complete("user_override")}>{t("advance.confirm")}</Button>
            <Button variant="outline" onClick={() => setConfirm(false)}>{t("advance.cancel")}</Button>
          </div>
        </div>
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setConfirm(true)}>{t("learn.completeAnyway")}</Button>
      )}
    </section>
  );
}
