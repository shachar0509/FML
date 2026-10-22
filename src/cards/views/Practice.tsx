import { useEffect, useState } from "react";
import { Check, ClipboardList, FileQuestion, Repeat, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import type { PracticeData, Go } from "../types";
import { Exercise } from "./Exercise";
import { Homework } from "./Homework";
import { Board, Skeleton, chalkChoice, inkBox } from "../ui";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type Scope =
  { kind: "all" | "weak" } | { kind: "unit"; unitId: string } | { kind: "stage"; stageId: string };
const letter = (i: number) => String.fromCharCode(65 + i);

export function Practice({
  data,
  callTool,
  go,
}: {
  data: PracticeData;
  callTool: Tool;
  go: Go;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState(data);
  const [again, setAgain] = useState(false); // chooser after a summary
  const [scope, setScope] = useState<"all" | "unit" | "weak" | "stage">("all");
  const [pick, setPick] = useState("");
  const [text, setText] = useState("");
  // M57: which practice: own homework, one question, or normal practice (a session already running picks it)
  const [kind, setKind] = useState<"homework" | "single" | "normal" | null>(
    data.hw ? data.hw.kind : data.mode === "item" || data.mode === "summary" ? "normal" : null,
  );
  const n = d.number;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await callTool(name, { courseNumber: n, ...args });
    if (r.structuredContent) {
      const x = r.structuredContent as PracticeData;
      setD(x);
      if (x.loading) void go(); // Claude has the work; ask the chat to fetch the job
    }
    return r;
  };

  // Claude's answer lands in the engine; follow it (also keeps the counters of an exercise item fresh).
  useEffect(() => {
    if (!d.loading && d.item?.kind !== "E") return;
    const h = setInterval(
      () =>
        void callTool("practice_state", { courseNumber: n }).then(
          (r) => r.structuredContent && setD(r.structuredContent as PracticeData),
        ),
      2500,
    );
    return () => clearInterval(h);
  }, [d.loading, d.item?.kind, n, callTool]);

  const start = () => {
    const s: Scope =
      scope === "unit"
        ? { kind: "unit", unitId: pick }
        : scope === "stage"
          ? { kind: "stage", stageId: pick }
          : { kind: scope };
    setAgain(false);
    void call("practice_start_request", { scope: s });
  };
  const list = scope === "unit" ? d.units : scope === "stage" ? d.stages : [];
  const mode = d.mode === "summary" && again ? "choose" : d.mode;

  if (d.hw || kind === "homework" || kind === "single")
    return (
      <Homework
        number={n}
        kind={d.hw?.kind ?? (kind === "single" ? "single" : "homework")}
        hw={d.hw}
        callTool={callTool}
        go={go}
        set={setD}
        back={() => setKind(null)}
      />
    );
  if (!kind)
    return (
      <section className="flex flex-col gap-4" aria-label={t("nav.practice")}>
        <Board title={t("practice.modes.title")}>
          <div className="grid gap-3">
            {([["homework", ClipboardList], ["single", FileQuestion], ["normal", Repeat]] as const).map(([k, Icon]) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={`${chalkChoice} flex items-start gap-3 p-4 text-start`}
              >
                <Icon className="mt-1 size-5 shrink-0 text-(--board-ink)" aria-hidden />
                <span className="flex flex-col gap-1">
                  <span className="text-[17px] font-semibold">{t(`practice.modes.${k}`)}</span>
                  <span className="text-sm text-(--board-muted)">{t(`practice.modes.${k}Text`)}</span>
                </span>
              </button>
            ))}
          </div>
        </Board>
      </section>
    );

  return (
    <section className="flex flex-col gap-4" aria-label={t("nav.practice")}>
      {d.error && (
        <p className="text-sm text-danger" role="alert">
          {t(d.error, { defaultValue: d.error })}{" "}
          <Button variant="outline" onClick={() => void call("practice_next_request")}>
            {t("practice.retry")}
          </Button>
        </p>
      )}

      {mode === "locked" && (
        <Board title={t("practice.modes.normal")}>
          <p>{t("practice.locked")}</p>
        </Board>
      )}
      {(mode === "locked" || mode === "choose") && (
        <Button variant="ghost" className="self-start" onClick={() => setKind(null)}>
          {t("homework.back")}
        </Button>
      )}

      {mode === "choose" && (
        <>
        <Board title={t("practice.chooseTitle")}>
          <div
            role="radiogroup"
            aria-label={t("practice.chooseTitle")}
            className="grid gap-2 sm:grid-cols-2"
          >
            {(["all", "unit", "weak", "stage"] as const).map((k) => (
              <label
                key={k}
                className={`${chalkChoice} flex cursor-pointer items-center gap-3 p-3 text-[15px]`}
              >
                <input
                  type="radio"
                  name="scope"
                  className="size-4 accent-[var(--primary)]"
                  checked={scope === k}
                  onChange={() => (setScope(k), setPick(""))}
                />{" "}
                {t(`practice.scope.${k}`)}
              </label>
            ))}
          </div>
          {list.length > 0 && (
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label={t(scope === "unit" ? "practice.pickUnit" : "practice.pickStage")}
              className="h-10 rounded-lg border-2 border-(--board-fg)/30 bg-(--board) px-2 text-sm text-(--board-fg) focus-visible:outline-2 focus-visible:outline-primary"
            >
              <option value="">
                {t(scope === "unit" ? "practice.pickUnit" : "practice.pickStage")}
              </option>
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.id} · {x.title}
                </option>
              ))}
            </select>
          )}
        </Board>
          <Button
            className="h-11 self-end px-6 text-[15px]"
            disabled={d.loading || ((scope === "unit" || scope === "stage") && !pick)}
            onClick={start}
          >
            {t("practice.start")}
          </Button>
        </>
      )}

      {mode === "item" && (
        <>
          <p
            className="self-start rounded-full bg-border/60 px-3 py-1 text-xs text-muted"
            role="status"
          >
            {t("practice.answered")}: {d.counters.answered} · {t("practice.correct")}:{" "}
            {d.counters.correct} · {t("practice.avg")}: {d.counters.avg}
          </p>
          {d.loading && !d.item && (
            <p role="status" className="text-muted">
              {t("practice.preparing")}
            </p>
          )}
          {d.loading && !d.item && <Skeleton />}
          {d.item?.kind === "E" && (
            <Exercise
              key={d.item.exercise.runId}
              data={d.item.exercise}
              callTool={callTool}
              go={go}
            />
          )}
          {d.item?.kind === "M" && (
            <Board title={t("practice.question")}>
              <div className="text-lg">
                <Markdown>{d.item.questionMd}</Markdown>
              </div>
              <ul className="flex flex-col gap-2">
                {d.item.options.map((o, i) => {
                  const it = d.item as Extract<PracticeData["item"], { kind: "M" }>;
                  const good = it.correctIndex === i;
                  const bad = it.selected === i && it.correctIndex !== i;
                  return (
                    <li key={o}>
                      <button
                        disabled={it.selected !== null}
                        onClick={() => void call("practice_answer_mcq", { selected: i })}
                        className={`${chalkChoice} flex w-full items-center gap-3 p-3 text-start text-[15px] disabled:cursor-default ${good ? "border-success! bg-success/15" : bad ? "border-danger! bg-danger/15" : ""}`}
                      >
                        <span className="hand grid size-7 shrink-0 place-items-center rounded-full border-2 border-(--board-fg)/40 text-base">
                          {letter(i)}
                        </span>
                        <span className="grow">
                          <Markdown>{o}</Markdown>
                        </span>
                        {good && (
                          <Check
                            className="size-4 text-success"
                            aria-label={t("practice.correctAnswer")}
                          />
                        )}
                        {bad && (
                          <X
                            className="size-4 text-danger"
                            aria-label={t("practice.wrongAnswer")}
                          />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {d.item.explanationMd && (
                <div className={`${inkBox} board-note`} role="status">
                  <Markdown>{d.item.explanationMd}</Markdown>
                </div>
              )}
            </Board>
          )}
          {d.item?.kind === "O" && (
            <div className="flex flex-col gap-2">
              <Board title={t("practice.question")}>
                <div className="text-lg">
                  <Markdown>{d.item.questionMd}</Markdown>
                </div>
                {d.item.result && (
                <div
                  className={`${inkBox} board-note ${d.item.result.correct ? "border-success!" : "border-danger!"}`}
                  role="status"
                >
                  <p>
                    {d.item.result.correct
                      ? t("practice.correctAnswer")
                      : t("practice.wrongAnswer")}{" "}
                    · {t("practice.score", { n: d.item.result.score })}
                  </p>
                  <Markdown>{d.item.result.feedbackMd}</Markdown>
                </div>
                )}
              </Board>
              {!d.item.result && (
                <>
                  <textarea
                    dir={text ? "auto" : undefined}
                    rows={5}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder={t("practice.answerPlaceholder")}
                    aria-label={t("practice.answerPlaceholder")}
                    className="rounded-card border border-border bg-card p-3 text-sm shadow-card focus-visible:outline-2 focus-visible:outline-primary"
                  />
                  <Button
                    className="self-start"
                    disabled={!text.trim() || d.loading}
                    onClick={() => void call("practice_answer_open_request", { text: text.trim() })}
                  >
                    {t("practice.submit")}
                  </Button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {d.item &&
              d.item.kind !== "E" &&
              (d.item.kind === "M" ? d.item.selected !== null : !!d.item.result) && (
                <Button variant="outline" onClick={() => void call("practice_retry")}>
                  {t("practice.tryAgain")}
                </Button>
              )}
            <Button
              disabled={d.loading}
              onClick={() => (setText(""), void call("practice_next_request"))}
            >
              {t("practice.next")}
            </Button>
            <Button
              variant="outline"
              disabled={d.loading}
              onClick={() => void call("practice_end")}
            >
              {t("practice.end")}
            </Button>
          </div>
        </>
      )}

      {mode === "summary" && d.summary && (
        <>
        <Board title={t("practice.summary.title")}>
          <p>
            {t("practice.summary.items")}: {d.summary.items} · {t("practice.summary.avg")}:{" "}
            {d.summary.avgScore}
          </p>
          <p>
            {t("practice.summary.newMistakes")}:{" "}
            {d.summary.newMistakes.join(", ") || t("practice.summary.none")}
          </p>
          <div>
            <p className="board-label">{t("practice.summary.weak")}</p>
            {d.summary.weakStages.length === 0 && (
              <p className="text-(--board-muted)">{t("practice.summary.none")}</p>
            )}
            <ul className="flex flex-col gap-1">
              {d.summary.weakStages.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-sm">
                  <span className="grow">
                    <span dir="ltr" className="font-mono text-xs text-(--board-muted)">
                      {s.id}
                    </span>{" "}
                    · {s.title}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-fg"
                    onClick={() =>
                      void call("practice_learn_again", { stageId: s.id }).then(() =>
                        go({ kind: "relearn", stageId: s.id, title: s.title }),
                      )
                    }
                  >
                    {t("practice.summary.learnAgain")}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Board>
          <Button className="h-11 self-end px-6 text-[15px]" onClick={() => setAgain(true)}>
            {t("practice.again")}
          </Button>
        </>
      )}
    </section>
  );
}
