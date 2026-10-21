import { useLayoutEffect, useRef, useState } from "react";
import katex from "katex";
import { fitWidth, hebrewOutOfMath, joinPieces, KATEX, Markdown, mathPieces, MIRROR } from "./Markdown";

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

/** Splits a row at its first top-level "&&", or at a spacing (\quad, \qquad, \hspace) followed by words: [formula, reason]. */
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
    // "&&" opens an aligned derivation's note column, whatever is in it ("&& \\Delta H_1 = -393.5")
    if (sep === "&&" || HEB.test(rest) || /^\(?\s*\\text\{/.test(rest)) return [m.slice(0, i).trim(), rest.replace(/^\(([\s\S]*)\)$/, "$1").trim()];
    i += sep.length - 1;
  }
  return [m, ""];
}

type Row = { label: string; pre: string; lead: string; parts: readonly [string, string, string] | null; mixed: string; note: string };

/** One source line "name | formula": the name, words before the formula, the formula split at its relation, the reason. */
function parse(l: string): Row {
  const r = parseLine(l);
  // "|x| < R ⇒ הטור מתכנס": in a Hebrew row the arrow sits between the formula and its words, pointing at the words
  const arrow = /\\([A-Za-z]+)\s*$/.exec(r.parts?.[2] || r.parts?.[0] || "");
  if (!r.parts || !arrow || !MIRROR[arrow[1] as string] || !HEB.test(r.note)) return r;
  const cut = (t: string) => t.slice(0, t.length - arrow[0].length).trim();
  const parts = (r.parts[2] ? [r.parts[0], r.parts[1], cut(r.parts[2])] : [cut(r.parts[0]), r.parts[1], r.parts[2]]) as Row["parts"];
  return { ...r, parts, note: `$\\mathrel{\\${MIRROR[arrow[1] as string]}}$\u00a0${r.note}` };
}
/**
 * "name | formula": the name is what comes before the first "|", when it is a name. Not a name: "|x| < R" (an
 * absolute value at the start; "| x" with a space is an empty name) and "f(x) = |x|" (the "|" is the formula's).
 * A short name written as math ("r = 5\% | NPV = …") is a name when the formula after it has a relation too.
 */
function splitLabel(l: string): [string, string] {
  const bar = l.indexOf("|");
  if (bar < 0 || (bar === 0 && !/^\|\s/.test(l))) return ["", l.trim()];
  const [left, right] = [l.slice(0, bar).trim(), l.slice(bar + 1).trim()];
  const rel = (t: string) => /[=<>]|\\(?:le|ge|leq|geq|neq|in|subset|approx|equiv|sim)\b/.test(t);
  if (HEB.test(left) || (!left.includes("\\") && !rel(left))) return [left, right];
  return left.length <= 24 && rel(right) ? [`$${left}$`, right] : ["", l.trim()];
}

function parseLine(l: string): Row {
  const [label, math] = splitLabel(l);
  const [f, reason] = splitReason(math);
  // an aligned derivation's "&&" was a gap before a second column: keep a gap; single "&" marks are dropped
  const formula = f.replace(/&&/g, "\\qquad ").replace(/(?<!\\)&/g, " ").trim();
  const note = reason ? hebrewOutOfMath(reason) : "";
  if (!HEB.test(formula) && !/\\text\{[^{}]*[A-Za-z]/.test(formula)) return { label, pre: "", lead: "", parts: splitRel(formula) ?? [formula, "", ""], mixed: "", note };
  const ps = mathPieces(formula);
  // only units in \text ("kN·m"), no words: an ordinary formula
  if (!ps.some((p) => p.words)) return { label, pre: "", lead: "", parts: splitRel(formula) ?? [formula, "", ""], mixed: "", note };
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
      el.style.fontSize = "";
      if (el.dataset.stack !== "true") need = el.scrollWidth;
      const s = el.clientWidth + 1 < need;
      setStack(s);
      // what stacking cannot fix (a long fraction in a narrow box, a block with no names to move): smaller, not cut
      // off. When the stacking changes, the effect below fits after the new layout.
      if (s === (el.dataset.stack === "true")) fitWidth(el);
    };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    // KaTeX's fonts load lazily, after "ready" may already have resolved: measure again once any font arrives
    document.fonts?.addEventListener("loadingdone", fit);
    void document.fonts?.ready.then(fit);
    return () => (ro.disconnect(), document.fonts?.removeEventListener("loadingdone", fit));
  }, [source]);
  useLayoutEffect(() => {
    if (ref.current) fitWidth(ref.current);
  }, [stack]);
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
            {r.label.startsWith("$") ? <Markdown>{r.label}</Markdown> : r.label}
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
