import {
  isValidElement,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import "katex/contrib/mhchem"; // \ce{…} chemical equations (chemistry and biology steps)
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
    "\\R": "\\mathbb{R}",
    "\\N": "\\mathbb{N}",
    "\\Z": "\\mathbb{Z}",
    "\\Q": "\\mathbb{Q}",
    "\\C": "\\mathbb{C}",
    "\\blue": "\\htmlClass{m-blue}{#1}",
    "\\green": "\\htmlClass{m-green}{#1}",
    "\\pink": "\\htmlClass{m-pink}{#1}",
    "\\orange": "\\htmlClass{m-orange}{#1}",
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
    return <Tag {...(bare(props) as object)} />;
  };

/** Board boxes: a blockquote that starts with "[!definition] Title" (GitHub-alert style). */
export const BOXES = [
  "definition",
  "theorem",
  "lemma",
  "proof",
  "example",
  "note",
  "warning",
] as const;
type El = {
  type: string;
  tagName?: string;
  value?: string;
  children?: El[];
  properties?: Record<string, unknown>;
};
/** rehype: marks such blockquotes (data-box, data-title) and removes the marker line. */
const rehypeBoxes = () => (tree: El) => {
  const walk = (n: El, rtl: boolean) => {
    if (n.type === "element" && n.tagName === "blockquote") {
      const p = n.children?.find((c) => c.type === "element");
      const t = p?.tagName === "p" ? p.children?.[0] : undefined;
      const m = t?.type === "text" ? /^\[!(\w+)\][ \t]*([^\n]*)\n?/.exec(t.value ?? "") : null;
      if (p && t && m && (BOXES as readonly string[]).includes((m[1] as string).toLowerCase())) {
        n.properties = {
          ...n.properties,
          dataBox: (m[1] as string).toLowerCase(),
          dataTitle: m[2],
        };
        t.value = (t.value ?? "").slice(m[0].length);
        if (!t.value && p.children?.length === 1) n.children = n.children?.filter((c) => c !== p);
      }
    }
    // A block's direction comes from its words, never from its formulas: Hebrew words → rtl, other words → ltr,
    // formulas only → the card's direction. ("$a<b$ גוררים …" is a Hebrew sentence; dir="auto" would call it ltr.)
    const cls = n.properties?.className as string[] | undefined;
    if (cls?.includes("katex") || cls?.includes("katex-display")) {
      n.properties = { ...n.properties, dir: "ltr" };
      return; // a formula is KaTeX's: nothing below may touch it
    } else if (n.type === "element" && BLOCKS.has(n.tagName ?? "")) {
      const words = wordsOf(n);
      const dir = /[\u0590-\u05FF]/.test(words)
        ? "rtl"
        : /[A-Za-z]/.test(words)
          ? "ltr"
          : undefined;
      n.properties = { ...n.properties, dir };
      if (dir) rtl = dir === "rtl";
    }
    if (n.tagName === "code" || n.tagName === "pre" || n.tagName === "annotation") return;
    // "גלוקוז → פירובט" in a right-to-left line: the arrow is written for left-to-right reading; turn it around
    if (rtl)
      for (const c of n.children ?? [])
        if (c.type === "text" && ARROW_RE.test(c.value ?? ""))
          c.value = rtlTextArrows(c.value ?? "");
    // "−1,000", "NAD⁺", "~26", "25°C" in a right-to-left line: a sign at the edge of a number or a Latin word is
    // neutral and the line's direction would carry it to the wrong side; such a token becomes a left-to-right island
    // (also where the direction is not known here: a table cell with only "−1,000" inherits the card's; in a
    // left-to-right line the island changes nothing)
    if (!cls?.includes("ltr-token"))
      n.children = n.children?.flatMap((c): El[] => {
        if (c.type !== "text" || !EDGE_TOKEN.test(c.value ?? "")) return [c];
        return (c.value ?? "").split(EDGE_SPLIT).map((part, i): El =>
          i % 2 ? { type: "element", tagName: "span", properties: { dir: "ltr", className: ["ltr-token"] }, children: [{ type: "text", value: part }] } : { type: "text", value: part },
        );
      });
    // A colour macro written outside $…$ (e.g. "\\blue{מעבד}") would show as raw text: colour the words instead.
    n.children = n.children?.flatMap((c) => {
      if (c.type !== "text" || !COLOR_RE.test(c.value ?? "")) return [c];
      return (c.value ?? "")
        .split(COLOR_SPLIT)
        .map((part, i, all): El =>
          i % 3 === 1
            ? {
                type: "element",
                tagName: "span",
                properties: { className: [`m-${part}`] },
                children: [{ type: "text", value: all[i + 1] ?? "" }],
              }
            : { type: "text", value: i % 3 === 2 ? "" : part },
        );
    });
    // "…: $a$, $b$" lists symbols: they start on a new line, apart from the words that introduce them.
    if (n.type === "element" && BLOCKS.has(n.tagName ?? ""))
      n.children = n.children?.flatMap((c, i, all): El[] => {
        const next = all[i + 1];
        const math =
          next?.type === "element" &&
          (next.properties?.className as string[] | undefined)?.includes("katex");
        return c.type === "text" && math && /:\s*$/.test(c.value ?? "")
          ? [
              { ...c, value: (c.value ?? "").trimEnd() },
              { type: "element", tagName: "br", properties: {}, children: [] },
            ]
          : [c];
      });
    // Punctuation right after a formula (": ", ", ", ".") never starts the next line on its own.
    if (!cls?.includes("nobr"))
      n.children = n.children?.flatMap((c, i, all): El[] => {
        const next = all[i + 1];
        const isMath =
          c.type === "element" &&
          (c.properties?.className as string[] | undefined)?.includes("katex");
        const p =
          isMath && next?.type === "text"
            ? /^[.,:;!?)\]״"׳']+/.exec(next.value ?? "")?.[0]
            : undefined;
        if (!p || !next) return [c];
        next.value = (next.value ?? "").slice(p.length);
        return [
          {
            type: "element",
            tagName: "span",
            properties: { className: ["nobr"] },
            children: [c, { type: "text", value: p }],
          },
        ];
      });
    // A short word right before inline math ("אם $a<b$", "של $x$") stays on the math's line.
    n.children?.forEach((c, i) => {
      const next = n.children?.[i + 1];
      const isMath =
        next?.type === "element" &&
        (next.properties?.className as string[] | undefined)?.includes("katex");
      if (c.type === "text" && isMath)
        c.value = (c.value ?? "").replace(/(^|\s)(\S{1,4}) $/u, "$1$2\u00a0");
    });
    n.children?.forEach((c) => walk(c, rtl));
  };
  walk(tree, false);
};
const BLOCKS = new Set(["p", "li", "h1", "h2", "h3", "h4", "h5", "h6", "td", "th"]);
/** The text of a node outside formulas (and code). */
const wordsOf = (n: El): string =>
  n.type === "text"
    ? (n.value ?? "")
    : (n.properties?.className as string[] | undefined)?.some((c) => c.startsWith("katex")) ||
        n.tagName === "code"
      ? ""
      : (n.children ?? []).map(wordsOf).join("");
const COLOR_RE = /\\(blue|green|pink|orange)\{[^{}]*\}/;
const COLOR_SPLIT = /\\(blue|green|pink|orange)\{([^{}]*)\}/;

function Blockquote(
  p: ComponentProps<"blockquote"> & { node?: unknown; "data-box"?: string; "data-title"?: string },
) {
  const { t } = useTranslation();
  const { "data-box": box, "data-title": raw, children, ...rest } = bare(p);
  // "> [!theorem] משפט" repeats the label: keep only a real title (the theorem's name)
  const title =
    raw &&
    ![t(`board.${box}`), box ?? ""].some(
      (l) => l.toLowerCase() === raw.replace(/[.:]$/, "").trim().toLowerCase(),
    )
      ? raw
      : "";
  if (!box)
    return (
      <blockquote dir="auto" {...rest}>
        {children}
      </blockquote>
    );
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

const text = (n: ReactNode): string =>
  typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : "";

const components: Components = {
  p: auto("p"),
  li: auto("li"),
  blockquote: Blockquote as Components["blockquote"],
  h1: auto("h1"),
  h2: auto("h2"),
  h3: auto("h3"),
  h4: auto("h4"),
  h5: auto("h5"),
  h6: auto("h6"),
  th: auto("th"),
  td: auto("td"),
  table: (p) => (
    <div className="my-3 overflow-x-auto">
      <table {...bare(p)} />
    </div>
  ),
  // A fenced block is <pre><code class="language-x">; inline code never sits in a <pre>.
  pre: ({ children }) => {
    const code = isValidElement(children)
      ? (children as ReactElement<{ className?: string; children?: ReactNode }>)
      : null;
    const lang = /language-(\S+)/.exec(code?.props.className ?? "")?.[1] ?? "text";
    const src = text(code?.props.children).replace(/\n$/, "");
    if (lang === "rows") return <Rows source={src} />;
    return isFigureTag(lang) ? (
      <Figure tag={lang} source={src} />
    ) : (
      <CodeBlock code={src} lang={lang} />
    );
  },
  code: (p) => <code dir="ltr" className="inline-code" {...bare(p)} />,
};

/** "$\\varepsilon$-$N$" is two formulas around a hyphen; in a right-to-left line they swap places ("N-ε"). One formula keeps the order. */
const HEB = /[\u0590-\u05FF]/;
export type Piece = { words: boolean; s: string };
/** How many {…} are open at the end of tex (escaped \\{ \\} are set braces, not groups). */
const braceDepth = (tex: string) => {
  let d = 0;
  for (let i = 0; i < tex.length; i++) {
    if (tex[i] === "\\") i++;
    else if (tex[i] === "{") d++;
    else if (tex[i] === "}") d--;
  }
  return d;
};
/** A formula cut into its words (\\text{…} with letters, or bare Hebrew) and its math pieces, in order; punctuation alone counts as words. */
export function mathPieces(tex: string): Piece[] {
  const out: Piece[] = [];
  const math = (m: string) => {
    const t = m
      .trim()
      .replace(/^(?:\\[,;:! ]|~)+|(?:\\[,;:! ]|~)+$/g, "")
      .trim();
    if (t) out.push(/^[\s,.:;]*$/.test(t) ? { words: true, s: t } : { words: false, s: t });
  };
  let at = 0;
  for (const m of tex.matchAll(
    /\\text\{([^{}]*[\u0590-\u05FFA-Za-z][^{}]*)\}|[\u0590-\u05FF][\u0590-\u05FF\s"'׳״,.:;!?-]*/g,
  )) {
    if (braceDepth(tex.slice(0, m.index))) continue; // words inside a structure (|H|_{\\text{dB}}) belong to the formula
    // Latin \\text{…} counts as words only as a phrase ("exactly one of:"); a unit ("\\text{ dB}", "m/s") is the formula's
    if (!HEB.test(m[0]) && !/\S\s+\S|:$/.test((m[1] ?? "").trim())) continue;
    math(tex.slice(at, m.index));
    out.push({ words: true, s: (m[1] ?? m[0]).trim() });
    at = m.index + m[0].length;
  }
  math(tex.slice(at));
  return out;
}
/** Hebrew inside a formula renders reversed (KaTeX lays text left to right): pull it out as text, keeping the math pieces as formulas. */
export const hebrewOutOfMath = (tex: string): string => joinPieces(mathPieces(tex), HEB.test(tex));
/** Pieces back to Markdown: words as text, math as $…$ (in a right-to-left sentence split at its arrows, see rtlArrows). */
export const joinPieces = (ps: Piece[], rtl = false): string =>
  ps.reduce((acc, p) => {
    const s = p.words ? p.s : rtl ? rtlArrows(p.s) : `$${p.s}$`;
    // "מ-" + "$x$" is one word ("מ-x"); a punctuation mark sticks to what came before
    return !acc
      ? s
      : acc.endsWith("-") || (p.words && /^[,.:;]/.test(p.s))
        ? acc + s
        : `${acc} ${s}`;
  }, "");
/** A number or Latin word with a neutral sign at its edge: a leading sign (−5, ~26, $5, ×2) or a trailing mark (NAD⁺, 25°C). */
const EDGE = String.raw`(?:(?<=^|[\s(\[]|[\u0590-\u05FF]-)[−\-+±~≈×$€£](?=\d)[\d.,:/–\-]*\d[%°'’⁺⁻²³]*|(?<![\p{L}\d])[A-Za-z\d][A-Za-z\d.,/\-–]*[⁺⁻°'’²³][A-Za-z\d⁺⁻°'’²³]*)`;
const EDGE_TOKEN = new RegExp(EDGE, "u");
const EDGE_SPLIT = new RegExp(`(${EDGE})`, "gu");
/** Arrows typed as characters in text ("A → B"), each with its mirror image. */
const TEXT_ARROWS: Record<string, string> = {
  "→": "←",
  "←": "→",
  "⇒": "⇐",
  "⇐": "⇒",
  "⟶": "⟵",
  "⟵": "⟶",
  "⟹": "⟸",
  "⟸": "⟹",
  "↦": "↤",
};
const ARROW_RE = /[→←⇒⇐⟶⟵⟹⟸↦]/;
/**
 * In a right-to-left line an arrow character next to Hebrew is read right to left, so it must point left
 * ("גלוקוז ← פירובט"). Between Latin words ("ATP → ADP") the browser keeps that run left to right: left alone.
 */
export function rtlTextArrows(t: string): string {
  const strong = (s: string) => /[\u0590-\u05FFA-Za-z]/.exec(s)?.[0] ?? "";
  return t.replace(/[→←⇒⇐⟶⟵⟹⟸↦]/g, (a, at: number) => {
    const before = strong([...t.slice(0, at)].reverse().join(""));
    const after = strong(t.slice(at + 1));
    return HEB.test(before) || HEB.test(after) ? (TEXT_ARROWS[a] ?? a) : a;
  });
}
/** Logical arrows between statements, and their mirror image for a right-to-left sentence. */
export const MIRROR: Record<string, string> = {
  Rightarrow: "Leftarrow",
  Leftarrow: "Rightarrow",
  implies: "impliedby",
  impliedby: "implies",
  Longrightarrow: "Longleftarrow",
  Longleftarrow: "Longrightarrow",
  iff: "iff",
  Leftrightarrow: "Leftrightarrow",
  Longleftrightarrow: "Longleftrightarrow",
};
/**
 * A formula inside a right-to-left sentence is read right to left as a whole: "$b<c \\Rightarrow a<c$" would be
 * read "a<c" first. So it is cut at its top-level logical arrows into one formula per statement, and each arrow is
 * mirrored to point the way the sentence reads (b<c ⇐ a<c, read from the right: b<c, then a<c). Arrows inside
 * {…} or \\left…\\right, and \\to (limits, mappings), stay as they are.
 */
export function rtlArrows(tex: string): string {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\\") {
      const name = /^[a-zA-Z]+/.exec(tex.slice(i + 1))?.[0] ?? "";
      if (name === "left") depth++;
      else if (name === "right") depth--;
      else if (depth === 0 && MIRROR[name]) {
        out.push(tex.slice(at, i).trim(), `\\mathrel{\\${MIRROR[name]}}`); // \\mathrel{…}: already turned, a second pass leaves it
        at = i + 1 + name.length;
      }
      i += name.length || 1;
    }
  }
  out.push(tex.slice(at).trim());
  return out
    .filter(Boolean)
    .map((t) => `$${t}$`)
    .join(" ");
}
/** Hebrew nested in a structure (\\underbrace{…}_{\\text{…}}, \\frac{…}{…}) belongs to that structure, not to the line. */
const deepHebrew = (tex: string) => {
  let depth = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "\\") {
      if (tex.startsWith("text{", i + 1) && depth === 0) {
        const end = tex.indexOf("}", i);
        if (end < 0) return true;
        i = end;
        continue;
      }
      i++;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth > 0 && HEB.test(c as string)) return true;
  }
  return false;
};
/** Lines of a display formula: split at top-level "\\\\" (not inside {…}, like \\substack{a \\\\ b}). */
const texLines = (tex: string) => {
  const out: string[] = [];
  let depth = 0;
  let at = 0;
  for (let i = 0; i < tex.length; i++) {
    const c = tex[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "\\") {
      if (tex[i + 1] === "\\" && depth === 0) {
        out.push(tex.slice(at, i));
        i++;
        if (tex[i + 1] === "[") i = tex.indexOf("]", i) < 0 ? i : tex.indexOf("]", i); // \\\\[4pt]
        at = i + 1;
      } else i++;
    }
  }
  out.push(tex.slice(at));
  return out.map((l) => l.trim()).filter(Boolean);
};
/** A reason written after a derivation line: "&& \\text{…}", "\\quad (\\text{…})". */
export const REASON = /(?:&&|\\q?quad)\s*\(?\s*\\text\{/;
/**
 * Display math with Hebrew in it (an aligned derivation with a reason per line) becomes a rows block: KaTeX lays a
 * formula out left to right, so Hebrew reasons inside it read in the wrong order; in a rows block the formulas stay
 * lined up and the reasons are right-to-left text beside them. Other environments (cases, matrices) stay KaTeX.
 */
export function displayToRows(tex: string): string | null {
  const t = tex.trim();
  const env =
    /^\\begin\{(aligned|align\*?|split|gathered|gather\*?|eqnarray\*?)\}([\s\S]*)\\end\{\1\}$/.exec(
      t,
    );
  const inner = env ? (env[2] as string) : t;
  if (inner.includes("\\begin{") || deepHebrew(inner)) return null;
  // without Hebrew only a derivation with written reasons changes; "x \\text{ if } y" reads fine in KaTeX
  if (!HEB.test(inner) && !texLines(inner).every((l) => REASON.test(l) || !/\\text\{/.test(l)))
    return null;
  return texLines(inner)
    .map((l) => `| ${l.replace(/\n/g, " ")}`)
    .join("\n");
}
/** Bare Hebrew letters in a formula are separate symbols (reversed); wrapped in \\text{…} a phrase stays one run and reads right. */
export const wrapHebrew = (tex: string) =>
  tex.replace(
    /\\text\{[^{}]*\}|([\u0590-\u05FF][\u0590-\u05FF\s"'׳״,.:;!?-]*[\u0590-\u05FF"'׳״.:])|([\u0590-\u05FF])/g,
    (all, run?: string, one?: string) => (run || one ? `\\text{${run ?? one}}` : all),
  );
/**
 * Applies the bidi fixes to Claude's Markdown outside code blocks. An inline formula with Hebrew words is split into
 * text + formulas; a display formula or an environment (aligned with Hebrew reasons) is kept whole, its bare Hebrew wrapped.
 */
export const fixMath = (md: string) =>
  md
    .split(/(```[\s\S]*?```)/)
    .map((part, i) =>
      i % 2
        ? part
        : glueArrows(
            joinHyphenatedMath(
              balanceDollars(escapeCurrency(part))
                .replace(
                  /^([ \t]*(?:>[ \t]?)*)\$\$([\s\S]*?)\$\$[ \t]*$/gm,
                  (all, pre: string, t: string) => {
                    const body = t
                      .split("\n")
                      .map((l, k) => (k ? l.replace(/^[ \t]*(?:>[ \t]?)*/, "") : l))
                      .join("\n");
                    const rows = HEB.test(body) || REASON.test(body) ? displayToRows(body) : null;
                    return rows === null
                      ? all
                      : [
                          `${pre}\`\`\`rows`,
                          ...rows.split("\n").map((l) => pre + l),
                          `${pre}\`\`\``,
                        ].join("\n");
                  },
                )
                .replace(/\$\$([\s\S]+?)\$\$/g, (all, t: string) =>
                  HEB.test(t) ? `$$${wrapHebrew(t)}$$` : all,
                )
                .replace(
                  /(?<![$\\])\$([^$\n]+)\$(?!\$)/g,
                  (all, t: string, at: number, str: string) => {
                    if (HEB.test(t))
                      return /\\begin|&|\\\\/.test(t) ? `$${wrapHebrew(t)}$` : hebrewOutOfMath(t);
                    // a formula in a Hebrew sentence: its arrows follow the sentence (rtlArrows)
                    const line = str.slice(
                      str.lastIndexOf("\n", at) + 1,
                      (str.indexOf("\n", at) + 1 || str.length + 1) - 1,
                    );
                    return HEB.test(line.replace(/\$[^$\n]*\$/g, "")) ? rtlArrows(t) : all;
                  },
                ),
            ),
          ),
    )
    .join("");

/**
 * A dollar amount is not a formula: "מ-$100 ל-$120" would pair the two "$" into math. The rule Pandoc uses decides:
 * a formula opens with "$" before a non-space and closes with "$" after a non-space that is not followed by a digit.
 * A "$" that never closes that way is a currency sign, and is escaped. Inline code stays literal.
 */
export const escapeCurrency = (md: string) =>
  md
    .split("\n")
    .map((line) =>
      line
        // a table row: "$" never pairs across cells ("| תזרים ($) | … | ערך ($) |")
        .split(/^\s*\|/.test(line) ? /(`+[^`]*`+|(?<!\\)\|)/ : /(`+[^`]*`+)/)
        .map((part, k) => {
          if (k % 2) return part;
          const ds = [...part.matchAll(/(?<![\\$])\$(?!\$)/g)].map((m) => m.index);
          const lit = new Set<number>();
          let open = -1;
          for (const i of ds) {
            const next = part[i + 1] ?? "";
            // a formula never opens on a space or a closing mark ("($)"), never closes on a space or an opening mark
            if (open < 0) {
              if (next && !/[\s)\]},.;:!?]/.test(next)) open = i;
              else lit.add(i);
            } else if (!/[\s([{]/.test(part[i - 1] ?? "") && !/\d/.test(next)) open = -1;
            else {
              lit.add(open); // the "$" before was a price, not the start of a formula
              open = next && !/[\s)\]},.;:!?]/.test(next) ? i : -1;
              if (open < 0) lit.add(i);
            }
          }
          if (open >= 0) lit.add(open);
          return lit.size ? [...part].map((c, i) => (lit.has(i) ? "\\$" : c)).join("") : part;
        })
        .join(""),
    )
    .join("\n");

/** Claude sometimes opens an inline formula with one "$" and closes it with two ("$a \\neq 0$$"), or the reverse; both show raw. */
export const balanceDollars = (md: string) =>
  md
    .split("\n")
    .map((line) => {
      // Pair the delimiters left to right ($ or $$, not escaped); a pair of a "$" and a "$$" becomes "$…$".
      const ds = [...line.matchAll(/(?<!\\)\${1,2}/g)];
      let out = "";
      let at = 0;
      for (let k = 0; k + 1 < ds.length; k += 2) {
        const [a, b] = [ds[k] as RegExpExecArray, ds[k + 1] as RegExpExecArray];
        if (a[0] === b[0]) continue;
        out += line.slice(at, a.index) + "$" + line.slice(a.index + a[0].length, b.index) + "$";
        at = b.index + b[0].length;
      }
      return out + line.slice(at);
    })
    .join("\n");

/** An arrow formula never ends a line: it stays with the statement it points to (a no-break space after it). */
export const glueArrows = (md: string) =>
  md.replace(
    /(\$(?:\\mathrel\{)?\\(?:Leftarrow|Rightarrow|implies|impliedby|Longleftarrow|Longrightarrow|iff|Leftrightarrow|Longleftrightarrow)\}?\$) +/g,
    "$1\u00a0",
  );

export const joinHyphenatedMath = (md: string) =>
  md.replace(
    /(?<![$\\])\$([^$\n]+)\$-\$([^$\n]+)\$(?!\$)/g,
    (_, a: string, c: string) => `$${a}\\text{-}${c}$`,
  );

/** The one renderer for all Claude text (11.1). Raw HTML is ignored by react-markdown. */
/** Shrinks an element's font until its content fits its width (down to 60%; beyond that it scrolls). */
export function fitWidth(el: HTMLElement) {
  el.style.fontSize = "";
  // a few rounds: KaTeX has fixed-pixel parts (a 2px spacer per sub/superscript) that do not shrink with the font
  for (let f = 1, k = 0; k < 4 && f > 0.6; k++) {
    const over = el.scrollWidth / Math.max(1, el.clientWidth);
    if (over <= 1.002) return;
    f = Math.max(0.6, (f / over) * 0.995);
    el.style.fontSize = `${f.toFixed(3)}em`;
  }
}

/** A display formula wider than its board (a long fraction, a sum with limits) is scaled down, not cut off. */
function useFitFormulas(text: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const fit = () => {
      el.querySelectorAll<HTMLElement>(".katex-display").forEach(
        (d) => !d.closest(".board-rows") && fitWidth(d),
      );
      // an inline formula wider than its line (it never wraps) shrinks too, instead of running over its neighbours
      el.querySelectorAll<HTMLElement>(".katex").forEach((k) => {
        if (k.closest(".katex-display")) return; // display formulas (also a rows line's cells) are fitted whole
        k.style.fontSize = "";
        const room =
          k.parentElement?.closest<HTMLElement>("p, li, td, th, figcaption, div")?.clientWidth ?? 0;
        const w = k.getBoundingClientRect().width;
        if (room && w > room + 1)
          k.style.fontSize = `${(parseFloat(getComputedStyle(k).fontSize) * Math.max(0.6, room / w)).toFixed(2)}px`;
      });
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // KaTeX's fonts load lazily, after "ready" may already have resolved: measure again once any font arrives
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => (ro.disconnect(), document.fonts?.removeEventListener("loadingdone", fit));
  }, [text]); // only when the text changes (cards that poll re-render often)
  return ref;
}

export function Markdown({ children, className }: { children: string; className?: string }) {
  const ref = useFitFormulas(children);
  return (
    <div ref={ref} className={`md ${className ?? ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, KATEX], rehypeBoxes]}
        components={components}
      >
        {fixMath(children)}
      </ReactMarkdown>
    </div>
  );
}
