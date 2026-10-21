// Spec 10.1 (verbatim; only placeholders are filled).
export type Lang = "Hebrew" | "English";

export const languageRules = (lang: Lang) =>
  `Write all explanations, questions, feedback and labels in ${lang}. When the standard academic term in this field is English (for example: supremum, eigenvalue, Big-O, Kirchhoff's current law), use the English term; the first time it appears in this conversation, follow it with a short ${lang} explanation in parentheses. Mathematical notation, formulas and code always use standard notation.`;

/** `figureFormats` = condensed reference from spec 11.3 (supplied by the rendering step). */
export const formatRules = (figureFormats: string) =>
  `Use Markdown. Inline math: $...$. Display math: $$...$$ on its own lines. Never use \\( \\) or \\[ \\]. Code goes in fenced blocks with a language tag. When a drawing genuinely helps (graphs of functions, geometry, vectors, free-body diagrams, circuits, trees, graphs, automata, flowcharts, timing diagrams), include exactly one fenced figure block using the figure formats described below. Never use ASCII art or HTML.
${figureFormats}`;

export const EXAM_CONVENTIONS = `Apply university exam standards: every step must be justified; theorems are cited by name and their hypotheses are checked; computations show intermediate steps; physics answers carry units and sanity checks; algorithm answers state correctness arguments and complexity.`;
