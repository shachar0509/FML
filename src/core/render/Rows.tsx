import { useLayoutEffect, useRef, useState } from "react";
import katex from "katex";
import { hebrewOutOfMath, joinPieces, KATEX, Markdown, mathPieces } from "./Markdown";

const RELS = new Set(["neq", "ne", "le", "leq", "ge", "geq", "subset", "subseteq", "supset", "supseteq", "in", "notin", "iff", "Rightarrow", "Leftrightarrow", "to", "approx", "equiv", "sim", "cong", "coloneqq"]);

/** Splits math at its first top-level relation (outside {…} and \left…\right) into [lhs, rel, rhs]; null when there is none. */
export function splitRel(m: string): [string, string, string] | null {
  let depth = 0;
  for (let i = 0; i < m.length; ) {
    const c = m[i] as string;
    if (c === "\\") {
      const name = /^[a-zA-Z]+/.exec(m.slice(i + 1))?.[0] ?? "";
      if (name === "left") depth++;
      else if (name === "right") depth--;
      else if (depth === 0 && RELS.has(name)) return [m.slice(0, i).trim(), m.slice(i, i + 1 + name.length), m.slice(i + 1 + name.length).trim()];
      else if (!name && m[i + 1] === "{") depth++; // \{ … \} is a set: its relations are inside
      else if (!name && m[i + 1] === "}") depth--;
      i += 1 + (name.length || 1); // \{ \| \, … skip the escaped character
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && "=<>".includes(c)) {
      const s = m[i - 1] === ":" ? i - 1 : i; // :=
      return [m.slice(0, s).trim(), m.slice(s, i + 1), m.slice(i + 1).trim()];
    }
    i++;
  }
  return null;
}

const tex = (s: string) => ({ __html: katex.renderToString(s, { ...KATEX, displayMode: true }) });
const HEB = /[֐-׿]/;

/** Splits a row at the first top-level spacing (&&, \quad, \qquad, \hspace) that is followed by Hebrew: [formula, reason]. */
export function splitReason(m: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < m.length; i++) {
    const c = m[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (depth || (c !== "&" && c !== "\\")) continue;
    const sep = /^(?:&&|\\q?quad\b|\\hspace\{[^{}]*\})/.exec(m.slice(i))?.[0];
    if (!sep) {
      if (c === "\\") i++;
      continue;
    }
    const rest = m.slice(i + sep.length).trim();
    if (HEB.test(rest) || /^\(?\s*\\text\{/.test(rest)) return [m.slice(0, i).trim(), rest.replace(/^\(([\s\S]*)\)$/, "$1").trim()];
    i += sep.length - 1;
  }
  return [m, ""];
}

type Row = { label: string; pre: string; lead: string; parts: readonly [string, string, string] | null; mixed: string; note: string };

/** One source line "name | formula": the name, words before the formula, the formula split at its relation, the reason. */
function parse(l: string): Row {
  const bar = l.indexOf("|");
  const [label, math] = bar >= 0 && !l.slice(0, bar).includes("\\") ? [l.slice(0, bar).trim(), l.slice(bar + 1).trim()] : ["", l.trim()];
  const [f, reason] = splitReason(math);
  const formula = f.replace(/(?<!\\)&/g, " ").trim();
  const note = reason ? hebrewOutOfMath(reason) : "";
  if (!HEB.test(formula) && !/\\text\{[^{}]*[A-Za-z]/.test(formula)) return { label, pre: "", lead: "", parts: splitRel(formula) ?? [formula, "", ""], mixed: "", note };
  const ps = mathPieces(formula);
  const last = ps.at(-1);
  // words, then one formula ("בדיוק אחד מהבאים: a<b, …"): the words go before it; after a ":" on their own line
  if (ps.length > 1 && last && !last.words && ps.slice(0, -1).every((p) => p.words)) {
    const words = joinPieces(ps.slice(0, -1));
    const parts = splitRel(last.s) ?? ([last.s, "", ""] as const);
    return words.endsWith(":") ? { label, pre: "", lead: words, parts, mixed: "", note } : { label, pre: words, lead: "", parts, mixed: "", note };
  }
  // a formula, then only words: the words are its reason, even without && or \quad before them
  const first = ps[0];
  if (!note && ps.length > 1 && first && !first.words && ps.slice(1).every((p) => p.words))
    return { label, pre: "", lead: "", parts: splitRel(first.s) ?? [first.s, "", ""], mixed: "", note: joinPieces(ps.slice(1)).replace(/^\((.*)\)$/, "$1") };
  // words woven through the formula ("a<b וגם b<c ⇒ a<c"): one right-to-left line, math stays formulas
  return { label, pre: "", lead: "", parts: null, mixed: hebrewOutOfMath(formula), note };
}

/**
 * ```rows block: one "name | formula" per line, the relation lined up across rows like a lecturer's board.
 * The columns follow the reading direction: in a Hebrew block the name is on the right and a reason (after && or
 * \quad) on the left; in English the other way round. Formulas are always left to right, lined up at the relation.
 */
export function Rows({ source }: { source: string }) {
  const rows = source
    .split("\n")
    .filter((l) => l.trim())
    .map(parse)
    // a line that ends with ":" introduces what follows: it gets its own line, the formula goes on the next one
    .flatMap((r): Row[] => (r.lead ? [{ ...r, parts: null, note: "" }, { ...r, label: "", lead: "" }] : [r]));
  const rtl = rows.some((r) => HEB.test(r.label + r.pre + r.lead + r.mixed + r.note));
  // Too narrow for name · formula · reason side by side (a board beside a note, a phone): names and reasons move to
  // their own lines. Measured, not guessed: the side-by-side width is taken while side by side.
  const ref = useRef<HTMLDivElement>(null);
  const [stack, setStack] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    let need = 0;
    const fit = () => {
      if (el.dataset.stack !== "true") need = el.scrollWidth;
      setStack(el.clientWidth + 1 < need);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    void document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [source]);
  const md = (cls: string, s: string) =>
    s ? (
      <span className={cls} dir="auto">
        <Markdown>{s}</Markdown>
      </span>
    ) : null;
  return (
    // tabIndex: a wide row scrolls sideways, so the block must be reachable by keyboard.
    <div ref={ref} className="board-rows" data-dir={rtl ? "rtl" : "ltr"} data-stack={stack} dir="ltr" role="list" tabIndex={0} style={{ "--rows": rows.length } as React.CSSProperties}>
      {rows.map((r, i) => (
        <div key={i} role="listitem" className="board-row" style={{ "--row": i + 1 } as React.CSSProperties}>
          <span className="board-label" dir="auto">
            {r.label}
          </span>
          {r.lead ? (
            md("board-lead", r.lead)
          ) : r.parts ? (
            <>
              {md("board-pre", r.pre)}
              <span className="board-lhs" dangerouslySetInnerHTML={tex(r.parts[0])} />
              <span className="board-rel" dangerouslySetInnerHTML={r.parts[1] ? tex(r.parts[1]) : undefined} />
              <span className="board-rhs" dangerouslySetInnerHTML={r.parts[2] ? tex(r.parts[2]) : undefined} />
            </>
          ) : (
            md("board-mixed", r.mixed)
          )}
          {md("board-note", r.note)}
        </div>
      ))}
    </div>
  );
}
