import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { claude } from "@/claude/runtime";
import { Button } from "@/components/ui/button";
import { Practice as Engine, type Item } from "@/domain/practice/engine";
import { loadImageB64 } from "@/lib/attachments";
import { Markdown } from "@/render/Markdown";
import { ExerciseCard } from "@/screens/Exercise/ExerciseCard";
import { readable } from "@/screens/Exercise/GradeCard";
import { PickButton, useAnswerFiles, useSub } from "@/screens/Exercise/parts";
import { Chips } from "@/screens/Learn/Attach";
import { ScopeChooser, Skeleton } from "./parts";

const card = "flex flex-col gap-3 rounded-card border border-border bg-card p-4";

function Actions({ p, can = true }: { p: Engine; can?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-2">
      {can && <Button variant="outline" disabled={p.loading} onClick={() => void p.tryAgain()}>{t("practice.tryAgain")}</Button>}
      <Button className="ms-auto" disabled={p.loading} onClick={() => void p.advance()}>{t("practice.next")}</Button>
    </div>
  );
}

function Mcq({ p, it }: { p: Engine; it: Extract<Item, { kind: "M" }> }) {
  const { t } = useTranslation();
  const { check, selected } = it;
  return (
    <div className={card}>
      <Markdown>{check.questionMd}</Markdown>
      <div className="flex flex-col gap-2">
        {(check.options ?? []).map((o, i) => {
          const tone =
            selected === null ? "border-border hover:border-primary"
            : i === check.correctIndex ? "border-success"
            : i === selected ? "border-danger" : "border-border opacity-60";
          return (
            <button key={i} type="button" disabled={selected !== null} onClick={() => void p.answerMcq(i)} className={`flex items-start gap-3 rounded-lg border p-3 text-start ${tone}`}>
              <span className="font-bold">{"ABCDEF"[i]}</span>
              <span className="min-w-0 flex-1"><Markdown>{o}</Markdown></span>
              {selected !== null && i === check.correctIndex && <Check className="size-4 text-success" aria-label={t("practice.correctAnswer")} />}
              {selected === i && i !== check.correctIndex && <X className="size-4 text-danger" aria-label={t("practice.wrongAnswer")} />}
            </button>
          );
        })}
      </div>
      {selected !== null && (
        <>
          <div className="border-t border-border pt-3"><Markdown>{check.explanationMd}</Markdown></div>
          <Actions p={p} />
        </>
      )}
    </div>
  );
}

function Open({ p, it, n }: { p: Engine; it: Extract<Item, { kind: "O" }>; n: string }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const files = useAnswerFiles(n);
  const { check, result } = it;
  return (
    <div className={card}>
      <Markdown>{check.questionMd}</Markdown>
      {result ? (
        <>
          <div className="rounded-lg bg-border/50 p-3">
            <p dir="auto" className="whitespace-pre-wrap">{it.answer}</p>
          </div>
          <p className="text-lg font-bold">{t("practice.score", { n: Math.round(result.score) })}</p>
          <Markdown>{result.feedbackMd}</Markdown>
          <Actions p={p} />
        </>
      ) : (
        <>
          <textarea dir="auto" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("practice.answerPlaceholder")}
            className="rounded-lg border border-border bg-bg p-2 text-sm" />
          <Chips atts={files} />
          <div className="flex items-center gap-2">
            <PickButton files={files} label={t("exercise.upload")} disabled={p.loading} variant="ghost" />
            <Button className="ms-auto" disabled={p.loading || (!text.trim() && !files.items.length)} onClick={() => void p.answerOpen(text.trim(), files.refs())}>
              {t("practice.submit")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function Current({ p, it, n }: { p: Engine; it: Item; n: string }) {
  if (it.kind === "M") return <Mcq key={it.check.id} p={p} it={it} />;
  if (it.kind === "O") return <Open key={it.check.id} p={p} it={it} n={n} />;
  if (!p.run) return <Skeleton />;
  const g = p.run.state.grade;
  return (
    <div className="flex flex-col gap-3">
      <ExerciseCard key={it.ref.id} run={p.run} courseNumber={n} />
      {readable(g) && <Actions p={p} />}
    </div>
  );
}

function Summary({ p, n, onAgain }: { p: Engine; n: string; onAgain: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const s = p.summary;
  if (!s) return null;
  return (
    <div className={card}>
      <h2 className="text-lg font-bold">{t("practice.summary.title")}</h2>
      <p>{t("practice.summary.items")}: {s.items} · {t("practice.summary.avg")}: {s.avgScore}</p>
      <p>{t("practice.summary.newMistakes")}: {s.newMistakes.length ? s.newMistakes.join(", ") : t("practice.summary.none")}</p>
      {s.weakStages.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t("practice.summary.weak")}</h3>
          {s.weakStages.map((w) => (
            <div key={w.id} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
              <span dir="ltr" className="text-muted">{w.id}</span>
              <span className="flex-1">{w.title}</span>
              <Button variant="outline" onClick={() => void p.relearn(w.id).then(() => navigate(`/course/${n}/learn/${w.id}`))}>
                {t("practice.summary.learnAgain")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onAgain}>{t("practice.again")}</Button>
        <Button asChild className="ms-auto"><Link to={`/course/${n}`}>{t("practice.back")}</Link></Button>
      </div>
    </div>
  );
}

export function PracticeView({ p, n }: { p: Engine; n: string }) {
  useSub(p);
  const { t } = useTranslation();
  const [showSummary, setShowSummary] = useState(true);
  const st = p.state;
  const c = p.counters;
  const cur = st?.current ?? null;
  const scopeLabel = st && (st.scope.kind === "unit"
    ? `${t("practice.scope.unit")}: ${p.ctx.plan.units.find((u) => u.id === (st.scope as { unitId: string }).unitId)?.title ?? ""}`
    : st.scope.kind === "stage" ? `${t("practice.scope.stage")}: ${st.scope.stageId}` : t(`practice.scope.${st.scope.kind}`));
  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-4 p-8">
      <header className="flex flex-wrap items-center gap-3">
        <Link to={`/course/${n}`} className="text-sm text-primary underline">{t("practice.back")}</Link>
        {scopeLabel && <span className="font-medium">{scopeLabel}</span>}
        {st && (
          <>
            <span className="text-sm text-muted">
              {t("practice.answered")} {c.answered} · {t("practice.correct")} {c.correct} · {t("practice.avg")} {c.avg}
            </span>
            <Button className="ms-auto" variant="outline" onClick={() => { setShowSummary(true); void p.end(); }}>{t("practice.end")}</Button>
          </>
        )}
      </header>
      {!st ? (
        p.summary && showSummary ? <Summary p={p} n={n} onAgain={() => setShowSummary(false)} />
        : <ScopeChooser plan={p.ctx.plan} completed={p.completed} onStart={(s) => void p.start(s)} />
      ) : (p.loading && !(cur?.kind === "O" && !cur.result)) || !cur ? (
        p.error ? (
          <div className={card}>
            <p role="alert" className="text-danger">{t(p.error, { defaultValue: p.error })}</p>
            <Button className="self-start" onClick={() => void p.advance()}>{t("practice.retry")}</Button>
          </div>
        ) : <Skeleton />
      ) : (
        <>
          <Current p={p} it={cur} n={n} />
          {p.error && <p role="alert" className="text-sm text-danger">{t(p.error, { defaultValue: p.error })}</p>}
        </>
      )}
    </div>
  );
}

export function Practice() {
  const { number = "" } = useParams();
  const { t } = useTranslation();
  const [p, setP] = useState<Engine | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let e: Engine | null = null;
    let live = true;
    void (async () => {
      try {
        e = new Engine(number, { gw: claude(), loadImage: loadImageB64(number) });
        await e.open();
        if (live) setP(e);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      e?.close();
    };
  }, [number]);
  if (failed)
    return (
      <div className="flex flex-col items-start gap-3 p-8">
        <p className="text-danger">{t("learn.loadFailed")}</p>
        <Link to={`/course/${number}`} className="text-primary underline">{t("learn.back")}</Link>
      </div>
    );
  return p ? <PracticeView p={p} n={number} /> : null;
}
