import katex from "katex";
import { KATEX } from "./Markdown";

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

/**
 * ```rows block: one "label | math" per line, the relation lined up across rows like a lecturer's board.
 * Laid out left to right as on the board (label, lhs, relation, rhs); the label is optional.
 */
export function Rows({ source }: { source: string }) {
  const rows = source
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      const bar = l.indexOf("|");
      const [label, math] = bar >= 0 && !l.slice(0, bar).includes("\\") ? [l.slice(0, bar).trim(), l.slice(bar + 1).trim()] : ["", l.trim()];
      return { label, parts: splitRel(math) ?? ([math, "", ""] as const) };
    });
  return (
    // tabIndex: a wide row scrolls sideways, so the block must be reachable by keyboard.
    <div className="board-rows" dir="ltr" role="list" tabIndex={0}>
      {rows.map(({ label, parts: [l, r, rhs] }, i) => (
        <div key={i} role="listitem" className="board-row">
          <span className="board-label" dir="auto">
            {label}
          </span>
          <span className="board-lhs" dangerouslySetInnerHTML={tex(l)} />
          <span className="board-rel" dangerouslySetInnerHTML={r ? tex(r) : undefined} />
          <span className="board-rhs" dangerouslySetInnerHTML={rhs ? tex(rhs) : undefined} />
        </div>
      ))}
    </div>
  );
}
