import { useState } from "react";
import { ArrowLeft, HelpCircle, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import type { Go, StepData } from "../types";
import { FigureCard } from "./FigureCard";
import { panel } from "../ui";

/** One small lesson step; the student moves on, asks for another explanation, or asks a question. */
export function Step({ data, go }: { data: StepData; go: Go }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const send = (label: string, req: Parameters<Go>[0]) => (setSent(label), void go(req));
  return (
    <section className="flex flex-col gap-3" aria-label={data.titleMd}>
      <article className={`${panel} board flex min-w-0 flex-col gap-3 overflow-x-auto px-5 py-5 sm:px-7`}>
        <h2 className="border-b border-border pb-2 text-xl font-bold">
          <Markdown>{data.titleMd}</Markdown>
        </h2>
        <Markdown>{data.bodyMd}</Markdown>
      </article>
      {data.figure && <FigureCard data={{ ...data, view: "figure", ...data.figure }} />}
      {sent ? (
        <p className="text-sm text-muted" role="status">
          {sent}
        </p>
      ) : asking ? (
        <div className="flex flex-col gap-2">
          <textarea
            dir="auto"
            rows={3}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("step.askPlaceholder")}
            aria-label={t("step.ask")}
            className="rounded-card border border-border bg-card p-3 text-sm shadow-card focus-visible:outline-2 focus-visible:outline-primary"
          />
          <div className="flex gap-2">
            <Button disabled={!q.trim()} onClick={() => send(q.trim(), { kind: "step", action: "question", text: q.trim() })}>
              {t("step.send")}
            </Button>
            <Button variant="outline" onClick={() => setAsking(false)}>
              {t("advance.cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => send(t("step.next"), { kind: "step", action: "next" })}>
            {t("step.next")}
            <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
          </Button>
          <Button variant="outline" onClick={() => send(t("step.again"), { kind: "step", action: "again" })}>
            <RefreshCw className="size-4" aria-hidden />
            {t("step.again")}
          </Button>
          <Button variant="outline" onClick={() => setAsking(true)}>
            <HelpCircle className="size-4" aria-hidden />
            {t("step.ask")}
          </Button>
        </div>
      )}
    </section>
  );
}
