import { useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import type { McqData, OpenData, Go } from "../types";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type Marked = {
  selectedIndex: number;
  correct: boolean;
  correctIndex: number;
  explanationMd: string;
};
const letter = (i: number) => String.fromCharCode(65 + i);

export function Mcq({ data, callTool, go }: { data: McqData; callTool: Tool; go: Go }) {
  const { t } = useTranslation();
  const [m, setM] = useState<Marked | null>(null);
  const [err, setErr] = useState(false);
  async function pick(i: number) {
    const r = await callTool("check_answer", { checkId: data.checkId, selectedIndex: i });
    if (r.isError || !r.structuredContent) return setErr(true);
    setM(r.structuredContent as Marked);
    void go({ kind: "answer", text: `${letter(i)}) ${data.options[i]}` });
  }
  return (
    <section className="flex flex-col gap-3" aria-label={t("learn.exercise")}>
      <div className="board rounded-card border border-border bg-card p-5 text-lg font-medium shadow-card">
        <Markdown>{data.questionMd}</Markdown>
      </div>
      <ul className="flex flex-col gap-2">
        {data.options.map((o, i) => {
          const good = m && i === m.correctIndex;
          const bad = m && i === m.selectedIndex && !m.correct;
          return (
            <li key={o}>
              <button
                disabled={!!m}
                onClick={() => void pick(i)}
                className={`flex w-full items-center gap-3 rounded-card border bg-card p-3 text-start text-sm shadow-card transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default ${good ? "border-success bg-success/10" : bad ? "border-danger bg-danger/10" : "border-border enabled:hover:border-primary/60 enabled:hover:bg-primary/5"}`}
              >
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {letter(i)}
                </span>
                <span className="grow">
                  <Markdown>{o}</Markdown>
                </span>
                {good && <Check className="size-4 text-success" aria-label={t("learn.correct")} />}
                {bad && <X className="size-4 text-danger" aria-label={t("learn.wrong")} />}
              </button>
            </li>
          );
        })}
      </ul>
      {err && (
        <p className="text-sm text-danger" role="alert">
          {t("learn.loadFailed")}
        </p>
      )}
      {m && (
        <div
          className={`rounded-card border border-s-4 bg-card p-4 shadow-card ${m.correct ? "border-border border-s-success" : "border-border border-s-danger"}`}
          role="status"
        >
          <p className="font-medium">{m.correct ? t("learn.correct") : t("learn.wrong")}</p>
          <Markdown>{m.explanationMd}</Markdown>
        </div>
      )}
    </section>
  );
}

export function OpenQ({ data, go }: { data: OpenData; go: Go }) {
  const { t } = useTranslation();
  const [a, setA] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <section className="flex flex-col gap-3" aria-label={t("learn.exercise")}>
      <div className="board rounded-card border border-border bg-card p-5 text-lg font-medium shadow-card">
        <Markdown>{data.questionMd}</Markdown>
      </div>
      {sent ? (
        <div
          className="rounded-card border border-border bg-card p-4 text-sm shadow-card"
          role="status"
        >
          <p className="font-medium">{t("learn.yourAnswer")}</p>
          <p dir="auto" className="whitespace-pre-wrap">
            {a}
          </p>
        </div>
      ) : (
        <>
          <textarea
            dir="auto"
            rows={5}
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder={t("learn.answerPlaceholder")}
            aria-label={t("learn.yourAnswer")}
            className="rounded-card border border-border bg-card p-3 text-sm shadow-card focus-visible:outline-2 focus-visible:outline-primary"
          />
          <Button
            className="self-start"
            disabled={!a.trim()}
            onClick={() => (setSent(true), void go({ kind: "answer", text: a.trim() }))}
          >
            {t("learn.sendAnswer")}
          </Button>
        </>
      )}
    </section>
  );
}
