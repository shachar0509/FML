import { useState } from "react";
import { Check, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/render/Markdown";
import type { McqData, OpenData } from "../types";

type Tool = (name: string, args?: Record<string, unknown>) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type Marked = { selectedIndex: number; correct: boolean; correctIndex: number; explanationMd: string };
const letter = (i: number) => String.fromCharCode(65 + i);

export function Mcq({ data, callTool, say }: { data: McqData; callTool: Tool; say: (t: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [m, setM] = useState<Marked | null>(null);
  const [err, setErr] = useState(false);
  async function pick(i: number) {
    const r = await callTool("check_answer", { checkId: data.checkId, selectedIndex: i });
    if (r.isError || !r.structuredContent) return setErr(true);
    setM(r.structuredContent as Marked);
    void say(t("mcp.answer", { a: `${letter(i)}) ${data.options[i]}` }));
  }
  return (
    <section className="flex flex-col gap-3 p-4" aria-label={t("learn.exercise")}>
      <Markdown>{data.questionMd}</Markdown>
      <ul className="flex flex-col gap-2">
        {data.options.map((o, i) => {
          const good = m && i === m.correctIndex;
          const bad = m && i === m.selectedIndex && !m.correct;
          return (
            <li key={o}>
              <button
                disabled={!!m}
                onClick={() => void pick(i)}
                className={`flex w-full items-start gap-2 rounded-lg border p-3 text-start text-sm ${good ? "border-success" : bad ? "border-danger" : "border-border hover:bg-border/50"}`}
              >
                <span className="font-medium">{letter(i)}</span>
                <span className="grow"><Markdown>{o}</Markdown></span>
                {good && <Check className="size-4 text-success" aria-label={t("learn.correct")} />}
                {bad && <X className="size-4 text-danger" aria-label={t("learn.wrong")} />}
              </button>
            </li>
          );
        })}
      </ul>
      {err && <p className="text-sm text-danger" role="alert">{t("learn.loadFailed")}</p>}
      {m && (
        <div className="rounded-lg bg-border/40 p-3" role="status">
          <p className="font-medium">{m.correct ? t("learn.correct") : t("learn.wrong")}</p>
          <Markdown>{m.explanationMd}</Markdown>
        </div>
      )}
    </section>
  );
}

export function OpenQ({ data, say }: { data: OpenData; say: (t: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [a, setA] = useState("");
  const [sent, setSent] = useState(false);
  return (
    <section className="flex flex-col gap-3 p-4" aria-label={t("learn.exercise")}>
      <Markdown>{data.questionMd}</Markdown>
      {sent ? (
        <div className="rounded-lg bg-border/40 p-3 text-sm" role="status"><p className="font-medium">{t("learn.yourAnswer")}</p><p dir="auto" className="whitespace-pre-wrap">{a}</p></div>
      ) : (
        <>
          <textarea
            dir="auto" rows={5} value={a} onChange={(e) => setA(e.target.value)} placeholder={t("learn.answerPlaceholder")} aria-label={t("learn.yourAnswer")}
            className="rounded-lg border border-border bg-card p-3 text-sm"
          />
          <Button className="self-start" disabled={!a.trim()} onClick={() => (setSent(true), void say(t("mcp.answerOpen", { a: a.trim() })))}>{t("learn.sendAnswer")}</Button>
        </>
      )}
    </section>
  );
}
