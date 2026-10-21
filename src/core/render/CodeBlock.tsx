import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useDark } from "./useDark";

const LANGS = ["c", "cpp", "python", "java", "javascript", "typescript", "matlab", "verilog", "vhdl", "bash", "sql", "json"];
const ALIAS: Record<string, string> = { "c++": "cpp", py: "python", js: "javascript", ts: "typescript", sh: "bash", shell: "bash", m: "matlab", v: "verilog" };

let hl: Promise<import("shiki").Highlighter> | undefined;
const highlighter = () =>
  (hl ??= import("shiki").then((s) => s.createHighlighter({ themes: ["github-light", "github-dark"], langs: LANGS })));

/** Fenced code (11.2): Shiki, language label, Copy. Unknown languages stay plain text. */
export function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const { t } = useTranslation();
  const dark = useDark();
  const id = ALIAS[lang.toLowerCase()] ?? lang.toLowerCase();
  const [html, setHtml] = useState<string>();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!LANGS.includes(id)) return;
    let live = true;
    highlighter()
      .then((h) => live && setHtml(h.codeToHtml(code, { lang: id, theme: dark ? "github-dark" : "github-light" })))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code, id, dark]);

  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div dir="ltr" className="code-block my-3 overflow-hidden rounded-lg border border-border">
      <div className="flex items-center justify-between bg-card px-3 py-1 text-xs text-muted">
        <span>{lang}</span>
        <button type="button" onClick={copy} className="flex items-center gap-1 hover:text-fg" aria-label={t("render.copy")}>
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t("render.copied") : t("render.copy")}
        </button>
      </div>
      {html ? (
        <div className="overflow-x-auto p-3 text-sm" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="overflow-x-auto p-3 text-sm">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}
