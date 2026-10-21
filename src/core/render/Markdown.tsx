import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { useTranslation } from "react-i18next";
import { CodeBlock } from "./CodeBlock";
import { Figure, isFigureTag } from "./Figure";
import { Rows } from "./Rows";

export const KATEX = {
  throwOnError: false,
  strict: "ignore",
  // Only \htmlClass is trusted: the colour macros below set a class (themeable), never raw HTML or styles.
  trust: (c: { command: string }) => c.command === "\\htmlClass",
  macros: {
    "\\R": "\\mathbb{R}", "\\N": "\\mathbb{N}", "\\Z": "\\mathbb{Z}", "\\Q": "\\mathbb{Q}", "\\C": "\\mathbb{C}",
    "\\blue": "\\htmlClass{m-blue}{#1}", "\\green": "\\htmlClass{m-green}{#1}", "\\pink": "\\htmlClass{m-pink}{#1}", "\\orange": "\\htmlClass{m-orange}{#1}",
  },
} as const;

const bare = <P extends { node?: unknown }>(p: P): Omit<P, "node"> => {
  const { node, ...rest } = p;
  void node;
  return rest;
};

const auto = <T extends keyof React.JSX.IntrinsicElements>(tag: T) =>
  function Auto(props: ComponentProps<T> & { node?: unknown }) {
    const Tag = tag as "p";
    return <Tag dir="auto" {...(bare(props) as object)} />;
  };

/** Board boxes: a blockquote that starts with "[!definition] Title" (GitHub-alert style). */
export const BOXES = ["definition", "theorem", "lemma", "proof", "example", "note", "warning"] as const;
type El = { type: string; tagName?: string; value?: string; children?: El[]; properties?: Record<string, unknown> };
/** rehype: marks such blockquotes (data-box, data-title) and removes the marker line. */
const rehypeBoxes = () => (tree: El) => {
  const walk = (n: El) => {
    if (n.type === "element" && n.tagName === "blockquote") {
      const p = n.children?.find((c) => c.type === "element");
      const t = p?.tagName === "p" ? p.children?.[0] : undefined;
      const m = t?.type === "text" ? /^\[!(\w+)\][ \t]*([^\n]*)\n?/.exec(t.value ?? "") : null;
      if (p && t && m && (BOXES as readonly string[]).includes((m[1] as string).toLowerCase())) {
        n.properties = { ...n.properties, dataBox: (m[1] as string).toLowerCase(), dataTitle: m[2] };
        t.value = (t.value ?? "").slice(m[0].length);
        if (!t.value && p.children?.length === 1) n.children = n.children?.filter((c) => c !== p);
      }
    }
    n.children?.forEach(walk);
  };
  walk(tree);
};

function Blockquote(p: ComponentProps<"blockquote"> & { node?: unknown; "data-box"?: string; "data-title"?: string }) {
  const { t } = useTranslation();
  const { "data-box": box, "data-title": title, children, ...rest } = bare(p);
  if (!box) return <blockquote dir="auto" {...rest}>{children}</blockquote>;
  return (
    <section className={`board-box board-box-${box}`} dir="auto" aria-label={t(`board.${box}`)}>
      <span className="board-box-tab">
        {t(`board.${box}`)}
        {title ? <span className="board-box-title"> {title}</span> : null}
      </span>
      {children}
    </section>
  );
}

const text = (n: ReactNode): string => (typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : "");

const components: Components = {
  p: auto("p"), li: auto("li"), blockquote: Blockquote as Components["blockquote"], h1: auto("h1"), h2: auto("h2"), h3: auto("h3"),
  h4: auto("h4"), h5: auto("h5"), h6: auto("h6"), th: auto("th"), td: auto("td"),
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table {...bare(p)} />
    </div>
  ),
  // A fenced block is <pre><code class="language-x">; inline code never sits in a <pre>.
  pre: ({ children }) => {
    const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: ReactNode }>) : null;
    const lang = /language-(\S+)/.exec(code?.props.className ?? "")?.[1] ?? "text";
    const src = text(code?.props.children).replace(/\n$/, "");
    if (lang === "rows") return <Rows source={src} />;
    return isFigureTag(lang) ? <Figure tag={lang} source={src} /> : <CodeBlock code={src} lang={lang} />;
  },
  code: (p) => <code dir="ltr" className="inline-code" {...bare(p)} />,
};

/** The one renderer for all Claude text (11.1). Raw HTML is ignored by react-markdown. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={`md ${className ?? ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[[rehypeKatex, KATEX], rehypeBoxes]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
