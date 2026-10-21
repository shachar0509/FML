// Spec 10.1 (verbatim; only placeholders are filled).
export type Lang = "Hebrew" | "English";

// M22: the student asked for no mixed languages, so this rule is stricter than spec 10.1.
export const languageRules = (lang: Lang) =>
  `Write everything the student sees in ${lang}: explanations, titles, questions, answer options, feedback, labels, notes and exercise statements. English appears only inside mathematical notation (variable names, symbols, function names such as sin or lim) and in code. For a technical term use the standard ${lang} term taught at universities; if students also meet it in English, you may add the English term once in parentheses. Words never go inside math: write $x \\in \\R$ and put the words outside the formula, not in \\text{...}.`;

/** `figureFormats` = condensed reference from spec 11.3 (supplied by the rendering step). */
export const formatRules = (figureFormats: string) =>
  `Use Markdown. Inline math: $...$. Display math: $$...$$ on its own lines. Never use \\( \\) or \\[ \\]. Code goes in fenced blocks with a language tag. When a drawing genuinely helps (graphs of functions, geometry, vectors, free-body diagrams, circuits, trees, graphs, automata, flowcharts, timing diagrams), include exactly one fenced figure block using the figure formats described below. Never use ASCII art or HTML.
${figureFormats}`;

export const EXAM_CONVENTIONS = `Apply university exam standards: every step must be justified; theorems are cited by name and their hypotheses are checked; computations show intermediate steps; physics answers carry units and sanity checks; algorithm answers state correctness arguments and complexity.`;
