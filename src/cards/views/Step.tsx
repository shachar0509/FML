import { useState } from "react";
import { ArrowLeft, HelpCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import type { Go, StepData } from "../types";
import { FigureCard } from "./FigureCard";

/** One small lesson step on a notebook page; the student moves on, asks for another explanation, or asks a question. */
export function Step({ data, go }: { data: StepData; go: Go }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const send = (label: string, req: Parameters<Go>[0]) => (setSent(label), void go(req));
  const p = data.progress;
  const side = !!(data.figure || data.sideMd);
  return (
    <section className="flex flex-col gap-4" aria-label={data.titleMd}>
      <article className={`board-surface board mb-3 grid min-w-0 gap-x-6 gap-y-4 overflow-x-auto px-6 py-6 sm:px-8 ${side ? "md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]" : ""}`}>
        <div className="min-w-0">
          <h2 className="hand text-4xl leading-tight">
            <Markdown>{data.titleMd}</Markdown>
            <span className="ink-underline" aria-hidden />
          </h2>
          <div className="mt-4">
            <Markdown>{data.bodyMd}</Markdown>
          </div>
        </div>
        {side && (
          <aside className="flex flex-col gap-5 self-start md:pt-14">
            {data.sideMd && (
              <div className="sticky-note text-[15px] leading-7">
                <Markdown>{data.sideMd}</Markdown>
              </div>
            )}
            {data.figure && (
              <div className="pinned-figure">
                <FigureCard bare data={{ ...data, view: "figure", ...data.figure }} />
              </div>
            )}
          </aside>
        )}
      </article>
      {p && (
        <div className="flex items-center gap-3 px-1">
          <span className="shrink-0 text-sm font-medium text-muted tabular-nums">
            {t("step.progress", { n: p.n, of: p.of })}
          </span>
          <ol className="flex grow gap-1.5" aria-hidden>
            {Array.from({ length: p.of }, (_, i) => (
              <li key={i} className={`h-1.5 grow rounded-full ${i < p.n ? "bg-primary" : "bg-border"}`} />
            ))}
          </ol>
        </div>
      )}
      {sent ? (
        <p className="rounded-full bg-primary/10 px-4 py-2 text-sm font-medium text-primary self-start" role="status">
          {sent}
        </p>
      ) : asking ? (
        <div className="flex flex-col gap-2">
          <textarea
            dir={q ? "auto" : undefined}
            rows={3}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("step.askPlaceholder")}
            aria-label={t("step.ask")}
            className="rounded-card border border-border bg-card p-4 text-[15px] shadow-card focus-visible:outline-2 focus-visible:outline-primary"
          />
          <div className="flex gap-2">
            <Button disabled={!q.trim()} onClick={() => send(q.trim(), { kind: "step", action: "question", text: q.trim() })}>
              {t("step.send")}
            </Button>
            <Button variant="ghost" onClick={() => setAsking(false)}>
              {t("advance.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAsking(true)}>
            <HelpCircle className="size-4" aria-hidden />
            {t("step.ask")}
          </Button>
          <Button variant="ghost" onClick={() => send(t("step.again"), { kind: "step", action: "again" })}>
            <RefreshCw className="size-4" aria-hidden />
            {t("step.again")}
          </Button>
          <Button className="ms-auto h-11 px-6 text-[15px]" onClick={() => send(t("step.next"), { kind: "step", action: "next" })}>
            {t("step.next")}
            <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
          </Button>
        </div>
      )}
    </section>
  );
}
