import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, HelpCircle, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import type { Go, Host, StepData } from "../types";
import { FigureCard } from "./FigureCard";

/** No answer_question this long after Send: say the answer may be in the chat (U2). Between Waiting's 20 s Nudge and the 90 s press-Enter banner. */
const ANSWER_LATE_MS = 60_000;

/** One small lesson step on a notebook page; the student moves on, asks for another explanation, or asks a question. */
/** `readOnly`: an earlier slide of a saved lesson (M60), without the buttons. */
export function Step({ data, go, callTool, readOnly }: { data: StepData; go: Go; callTool: Host["callTool"]; readOnly?: boolean }) {
  const { t } = useTranslation();
  const [asking, setAsking] = useState(false);
  const [q, setQ] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  // A question is answered in a pop-up over this step (answer_question); the card polls for it until it comes, another
  // question replaces it, Continue / Explain differently drops it, or the card goes away. Back only hides the pill.
  // ponytail: no cap on the poll (bounded by the card's life); add one if it ever shows in load
  const [pending, setPending] = useState<{ q: string; since: number } | null>(null);
  const [late, setLate] = useState(false);
  const [answer, setAnswer] = useState<{ q: string; md: string } | null>(null);
  const send = (label: string, req: Parameters<Go>[0]) => (setPending(null), setSent(label), void go(req));
  useEffect(() => {
    if (!pending) return;
    let live = true;
    const h = setInterval(() => {
      if (Date.now() - pending.since >= ANSWER_LATE_MS) setLate(true);
      if (document.visibilityState === "hidden") return;
      void callTool("step_answer", { since: pending.since })
        .then((r) => {
          const md = (r.structuredContent as { answerMd?: string | null } | undefined)?.answerMd;
          if (!md || !live) return;
          setAnswer({ q: pending.q, md });
          setPending(null);
          setSent(null);
        })
        .catch(() => undefined);
    }, 2000);
    return () => ((live = false), clearInterval(h));
  }, [callTool, pending]);
  const close = () => setAnswer(null);
  const p = data.progress;
  // M78: a slide with beats plays in the card: Next reveals the next beat (text and figure parts) without calling Claude.
  const beats = data.beats ?? [];
  const of = beats.length;
  const [beat, setBeat] = useState(readOnly ? of : 1);
  const [shownData, setShownData] = useState(data);
  if (shownData !== data) {
    setShownData(data);
    setBeat(readOnly ? of : 1);
  }
  const more = beat < of;
  const step = (d: number) => setBeat((b) => Math.min(Math.max(b + d, 1), of));
  useEffect(() => {
    if (!of) return;
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      const fwd = document.documentElement.dir === "rtl" ? "ArrowLeft" : "ArrowRight";
      const bwd = fwd === "ArrowLeft" ? "ArrowRight" : "ArrowLeft";
      if (e.key === fwd) step(1);
      else if (e.key === bwd) step(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [of]);
  // The question says which beat was on screen (M78); Back keeps the beat, so a later question says it too.
  const ask = () => {
    const text = q.trim();
    setPending({ q: text, since: Date.now() });
    setLate(false);
    setAsking(false);
    setQ("");
    setSent(text);
    void go({ kind: "step", action: "question", text, ...(of ? { beat: { n: beat, of } } : {}) });
  };
  const beatSide = beats[beat - 1]?.sideMd;
  const side = !!(data.figure || data.sideMd || beats.some((b) => b.sideMd));
  // A figure gets the larger column when the card is wide (full screen), and sits above the text when it is narrow (inline).
  const cols = data.figure ? "@4xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]" : "md:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]";
  return (
    <section className="@container flex flex-col gap-4" aria-label={data.titleMd}>
      <article className={`board-surface board mb-3 grid min-w-0 gap-x-6 gap-y-4 overflow-x-auto px-6 py-6 sm:px-8 ${side ? cols : ""}`}>
        <div className="min-w-0">
          <h2 className="hand text-4xl leading-tight">
            <Markdown>{data.titleMd}</Markdown>
            <span className="ink-underline" aria-hidden />
          </h2>
          {data.bodyMd.trim() && (
            <div className="mt-4">
              <Markdown>{data.bodyMd}</Markdown>
            </div>
          )}
          {/* Every beat is laid out from the start (the card's height never jumps); the ones not reached yet are invisible. */}
          {beats.map((b, i) => (
            <div key={i} data-beat-text={i + 1} className={`mt-4 ${i + 1 < beat ? "beat-done" : i + 1 > beat ? "beat-later" : ""}`}>
              <Markdown>{b.md}</Markdown>
            </div>
          ))}
          {of > 0 && (
            <div className="mt-5 flex items-center gap-3">
              <button
                className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-border/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
                aria-label={t("step.beatPrev")}
                title={t("step.beatPrev")}
                disabled={beat <= 1}
                onClick={() => step(-1)}
              >
                <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
              </button>
              <ol className="flex gap-1.5" aria-hidden>
                {beats.map((_, i) => (
                  <li key={i} className={`size-2 rounded-full ${i < beat ? "bg-primary" : "bg-border"}`} />
                ))}
              </ol>
              <span className="text-sm text-muted tabular-nums" role="status">
                {t("step.beat", { n: beat, of })}
              </span>
              {readOnly && (
                <button
                  className="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-border/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-30"
                  aria-label={t("step.beatNext")}
                  title={t("step.beatNext")}
                  disabled={!more}
                  onClick={() => step(1)}
                >
                  <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
                </button>
              )}
            </div>
          )}
        </div>
        {side && (
          <aside className={`flex flex-col gap-5 self-start ${data.figure ? "order-first @4xl:order-none @4xl:sticky @4xl:top-14" : "md:pt-14"}`}>
            {data.sideMd && (
              <div className="sticky-note text-[15px] leading-7">
                <Markdown>{data.sideMd}</Markdown>
              </div>
            )}
            {beatSide && (
              <div key={beat} className="sticky-note text-[15px] leading-7">
                <Markdown>{beatSide}</Markdown>
              </div>
            )}
            {data.figure && (
              <div className="pinned-figure">
                <FigureCard bare beat={of ? beat : undefined} data={{ ...data, view: "figure", ...data.figure }} />
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
      {readOnly ? null : answer ? (
        <div role="dialog" aria-label={t("step.answer")} className="flex flex-col gap-3 rounded-card border border-primary/40 bg-card p-5 shadow-card">
          <div className="flex items-start gap-3">
            <p className="grow text-sm text-muted" dir="auto">
              {answer.q}
            </p>
            <Button variant="ghost" size="icon" onClick={close} aria-label={t("step.close")}>
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          <Markdown>{answer.md}</Markdown>
          <Button className="self-start" onClick={close}>
            {t("step.close")}
          </Button>
        </div>
      ) : sent ? (
        <div className="flex flex-col items-start gap-2">
          <p className="rounded-full bg-primary/5 px-4 py-2 text-sm font-medium text-primary self-start" role="status">
            {sent}
          </p>
          {pending && (
            <div className="flex flex-wrap items-center gap-2">
              {late && (
                <p className="text-sm text-muted" role="status">
                  {t("step.late")}
                </p>
              )}
              {/* U2: no request (no go, no clear): the queued question stays, Enter still sends it, the poll goes on. */}
              <Button variant="ghost" size="sm" onClick={() => setSent(null)}>
                <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
                {t("step.back")}
              </Button>
            </div>
          )}
        </div>
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
            <Button disabled={!q.trim()} onClick={ask}>
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
          <Button className="ms-auto h-11 px-6 text-[15px]" onClick={() => (more ? step(1) : send(t("step.next"), { kind: "step", action: "next" }))}>
            {t(more ? "step.beatNext" : "step.next")}
            <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden />
          </Button>
        </div>
      )}
    </section>
  );
}
