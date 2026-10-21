import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/core/i18n";
import { balanceDollars, escapeCurrency, mathPieces, fixMath, rtlArrows, rtlTextArrows, hebrewOutOfMath, joinHyphenatedMath, Markdown } from "./Markdown";
import { isFigureTag } from "./Figure";
import { splitRel } from "./Rows";

describe("Markdown", () => {
  it("renders RTL blocks with isolated math, tables, and ignores raw HTML", () => {
    const { container } = render(
      <Markdown>{"שלום $x\\in\\R$ עולם\n\n$$\n\\sum_{i}^{n} i\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>"}</Markdown>,
    );
    expect(container.querySelector("p")?.getAttribute("dir")).toBe("rtl");
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.querySelector(".katex-mathml")?.innerHTML).toMatch(/ℝ|double-struck/); // \R macro
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
    expect(container.querySelector("script")).toBeNull();
  });

  it("code blocks show the language and a Copy button; unknown language stays plain", () => {
    render(<Markdown>{"```brainfuck\n+++\n```\n\nuse `x` here"}</Markdown>);
    expect(screen.getByText("brainfuck")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy|העתק/i })).toBeInTheDocument();
    expect(screen.getByText("+++")).toBeInTheDocument();
    expect(screen.getByText("x").className).toContain("inline-code");
  });

  it("board rows: split at the first top-level relation, label optional, aligned grid", () => {
    expect(splitRel(String.raw`\Q = \left\{ \frac{m}{n} \middle| n \neq 0 \right\}`)).toEqual(["\\Q", "=", String.raw`\left\{ \frac{m}{n} \middle| n \neq 0 \right\}`]);
    expect(splitRel(String.raw`\{x \le 1\} \subseteq A`)).toEqual([String.raw`\{x \le 1\}`, "\\subseteq", "A"]);
    expect(splitRel(String.raw`\left\{ a = b \right\} \le 2`)?.[1]).toBe("\\le");
    expect(splitRel("f := x^2")).toEqual(["f", ":=", "x^2"]);
    expect(splitRel("x + 1")).toBeNull();
    const { container } = render(<Markdown>{"```rows\nטבעיים | \\N = \\{1, 2, \\dots\\}\n| \\Z \\supset \\N\nx + 1\n```"}</Markdown>);
    const rows = [...container.querySelectorAll(".board-row")];
    expect(rows.map((r) => r.querySelector(".board-label")?.textContent)).toEqual(["טבעיים", "", ""]);
    expect(rows[1]?.querySelector(".board-rel .katex")).toBeTruthy();
    expect(rows[2]?.querySelector(".board-rel")?.innerHTML).toBe("");
  });

  it("board boxes: [!kind] blockquotes get a labelled box, others stay blockquotes", () => {
    const { container } = render(<Markdown>{"> [!theorem] Bolzano\n> If $f$ is continuous…\n\n> [!proof]\n> Trivial.\n\n> [!nope] x\n\n> plain"}</Markdown>);
    const boxes = [...container.querySelectorAll(".board-box")];
    expect(boxes.map((b) => b.className)).toEqual(["board-box board-box-theorem", "board-box board-box-proof"]);
    expect(boxes[0]?.querySelector(".board-box-tab")?.textContent).toMatch(/(משפט|Theorem) Bolzano/);
    expect(boxes[0]?.textContent).not.toContain("[!theorem]");
    expect(container.querySelectorAll("blockquote")).toHaveLength(2);
  });

  it("a colour macro written outside math is coloured, not shown raw", () => {
    const { container } = render(<Markdown>{"1. \\blue{מעבד (CPU)} – מבצע. ו-\\green{זיכרון} `\\pink{x}`"}</Markdown>);
    expect(container.textContent).not.toMatch(/\\blue|\\green/);
    expect(container.querySelector(".m-blue")?.textContent).toBe("מעבד (CPU)");
    expect(container.querySelector(".m-green")?.textContent).toBe("זיכרון");
    expect(container.querySelector("code")?.textContent).toBe("\\pink{x}"); // code stays literal
  });

  it("a short word before inline math stays glued to it", () => {
    const { container } = render(<Markdown>{"לכל $c$: אם $a<b$ אז $a+c<b+c$"}</Markdown>);
    expect(container.querySelector("p")?.innerHTML).toMatch(/אם&nbsp;<span class="katex"/);
  });

  it("two formulas around a hyphen become one (keeps their order in RTL)", () => {
    expect(joinHyphenatedMath("הגדרת $\\varepsilon$-$N$ ו-$x$")).toBe("הגדרת $\\varepsilon\\text{-}N$ ו-$x$");
    expect(joinHyphenatedMath("$$a$$-$$b$$")).toBe("$$a$$-$$b$$");
  });

  it("Hebrew inside a formula is pulled out as text; formulas skip the paragraph direction", () => {
    expect(hebrewOutOfMath(String.raw`a < b \text{ וגם } b < c \Rightarrow a < c`)).toBe(String.raw`$a < b$ וגם $b < c$ $\mathrel{\Leftarrow}$ $a < c$`); // read from the right: b<c, then a<c
    // a formula in a Hebrew sentence: cut at its top-level arrows, which point the way the sentence reads
    expect(rtlArrows(String.raw`x>0 \implies x^2>0 \iff y`)).toBe(String.raw`$x>0$ $\mathrel{\impliedby}$ $x^2>0$ $\mathrel{\iff}$ $y$`);
    expect(rtlArrows(String.raw`\left(a \Rightarrow b\right) \Rightarrow c`)).toBe(String.raw`$\left(a \Rightarrow b\right)$ $\mathrel{\Leftarrow}$ $c$`); // nested stays
    expect(rtlArrows(String.raw`a_n \to 0`)).toBe(String.raw`$a_n \to 0$`); // a limit is not an implication
    expect(fixMath(String.raw`לכן $x>0 \Rightarrow x^2>0$ תמיד`)).toBe("לכן $x>0$ $\\mathrel{\\Leftarrow}$\u00a0$x^2>0$ תמיד");
    expect(fixMath(fixMath("לכן $x>0 \\Rightarrow y$"))).toBe(fixMath("לכן $x>0 \\Rightarrow y$")); // turned once, not back again // the arrow stays with the statement it points to
    expect(fixMath(String.raw`So $x>0 \Rightarrow x^2>0$.`)).toBe(String.raw`So $x>0 \Rightarrow x^2>0$.`); // English reads left to right
    expect(fixMath("לכן\n$$\na \\Rightarrow b\n$$")).toBe("לכן\n$$\na \\Rightarrow b\n$$"); // a display formula stands alone
    expect(hebrewOutOfMath("בדיוק אחד מהבאים: a<b, a=b")).toBe("בדיוק אחד מהבאים: $a<b, a=b$");
    expect(fixMath("אם $a<b \\text{ אז } c$ ו-`$x$ שלום`")).toBe("אם $a<b$ אז $c$ ו-`$x$ שלום`"); // code untouched
    expect(fixMath("$$\na \\text{ כאשר } b\n$$")).toBe("```rows\n| a \\text{ כאשר } b\n```"); // Hebrew in display math: a rows line
    expect(fixMath("$$\\underbrace{x}_{\\text{חיובי}} > 0$$")).toBe("$$\\underbrace{x}_{\\text{חיובי}} > 0$$"); // a note under a term stays KaTeX
    // "$…$$" / "$$…$" (mismatched delimiters) showed raw; matched ones are untouched
    expect(balanceDollars("($a \\cdot a^{-1} = 1$ לכל $a \\neq 0$$)")).toBe("($a \\cdot a^{-1} = 1$ לכל $a \\neq 0$)");
    expect(balanceDollars("$$x$ ו-$y$")).toBe("$x$ ו-$y$");
    for (const ok of ["$a$ $b$", "$$a$$ ו-$b$", "$$\na\n$$", "\\$5$$"]) expect(balanceDollars(ok)).toBe(ok);
    expect(fixMath("$$x = 1 \\quad איבר אפס$$")).toBe("```rows\n| x = 1 \\quad איבר אפס\n```");
    expect(fixMath("$$\\begin{cases} 1 & \\text{אם } x>0 \\\\ 0 \\end{cases}$$")).toBe("$$\\begin{cases} 1 & \\text{אם } x>0 \\\\ 0 \\end{cases}$$"); // other environments stay KaTeX
    const { container } = render(<Markdown>{"$a<b$ ו-$0<c$ גוררים $a c < b c$"}</Markdown>);
    expect(container.querySelector("p")?.getAttribute("dir")).toBe("rtl"); // the words decide, not the leading formula
    expect(render(<Markdown>{"$a_n \\to 0$"}</Markdown>).container.querySelector("p")?.hasAttribute("dir")).toBe(false); // formulas only: the card's direction
    expect(render(<Markdown>{"Since $1/n \\to 0$."}</Markdown>).container.querySelector("p")?.getAttribute("dir")).toBe("ltr");
    const rows = render(<Markdown>{"```rows\nטרנזיטיביות | a < b \\text{ וגם } b < c \\Rightarrow a < c\nסגירות | a + b \\in F\n```"}</Markdown>).container;
    expect(rows.querySelectorAll(".board-mixed")).toHaveLength(1);
    expect(rows.querySelector(".board-mixed")?.textContent).toContain("וגם");
    expect(rows.querySelectorAll(".board-rel .katex")).toHaveLength(1);
  });

  it("a proof box with an aligned derivation and Hebrew reasons renders (no KaTeX error); a box title equal to its kind is dropped", () => {
    const md = [
      "> [!theorem] משפט",
      "> לכל $a \\in F$ מתקיים $0 \\cdot a = 0$.",
      "",
      "> [!proof]",
      "> $$",
      "> \\begin{aligned}",
      "> 0 \\cdot a &= (0 + 0) \\cdot a && \\text{איבר אפס} \\\\",
      "> &= 0 \\cdot a + 0 \\cdot a && \\text{פילוג}",
      "> \\end{aligned}",
      "> $$",
      "> נוסיף $-(0 \\cdot a)$ לשני האגפים.",
    ].join("\n");
    const { container } = render(<Markdown>{md}</Markdown>);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelector(".board-box-proof .katex-display")).toBeTruthy();
    expect(container.querySelector(".board-box-theorem .board-box-title")).toBeNull();
  });

  it("an aligned derivation with Hebrew reasons: formulas lined up, reasons as right-to-left notes beside them", () => {
    const md = ["> [!proof]", "> $$", "> \\begin{aligned}", "> 0 &= x + (-x) && \\text{איבר נגדי} \\\\", "> &= (x+x) + (-x) && \\text{מ-} x = x+x \\\\", "> &= x + 0 \\quad (\\text{קיבוץ})", "> \\end{aligned}", "> $$"].join("\n");
    const { container } = render(<Markdown>{md}</Markdown>);
    const rows = container.querySelector(".board-box-proof .board-rows");
    expect(rows?.getAttribute("data-dir")).toBe("rtl");
    expect(rows?.querySelectorAll(".board-rel .katex")).toHaveLength(3); // every line lined up at "="
    const notes = [...(rows?.querySelectorAll(".board-note") ?? [])];
    expect(notes.map((n) => n.textContent?.replace(/\s+/g, ""))).toEqual(["איברנגדי", expect.stringMatching(/^מ-x=x\+x/), "קיבוץ"]);
    expect(notes[1]?.querySelector("p")?.getAttribute("dir")).toBe("rtl"); // "מ-x=x+x" reads right to left
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("rows: a Hebrew name sits on the right; words before a formula get their own column, after a colon their own line", () => {
    const { container } = render(<Markdown>{"```rows\nטריכוטומיה | \\text{בדיוק אחד מהבאים:} a<b,\\ a=b,\\ b<a\nטרנזיטיביות | a<b \\land b<c \\Rightarrow a<c\nלכן | \\text{לכן} x = 0\n```"}</Markdown>);
    const rows = [...container.querySelectorAll(".board-row")];
    expect(container.querySelector(".board-rows")?.getAttribute("data-dir")).toBe("rtl");
    expect(rows).toHaveLength(4); // the ":" line is split into two
    expect(rows[0]?.querySelector(".board-lead")?.textContent).toBe("בדיוק אחד מהבאים:");
    expect(rows[1]?.querySelector(".board-label")?.textContent).toBe("");
    expect(rows[1]?.querySelector(".board-rel .katex")).toBeTruthy(); // the formula is lined up with the others
    expect(rows[3]?.querySelector(".board-pre")?.textContent).toBe("לכן");
    expect(container.querySelectorAll(".board-rel .katex")).toHaveLength(3);
    const bare = render(<Markdown>{"$$\n\\begin{aligned} x &= y \\text{ פילוג} \\\\ &= z \\end{aligned}\n$$"}</Markdown>).container; // no && before the reason
    expect(bare.querySelector(".board-note")?.textContent).toBe("פילוג");
    expect(bare.querySelectorAll(".board-rel .katex")).toHaveLength(2);
    // a name written as math; an absolute value at the start of a line is not a name; "f(x) = |x|" keeps its bar
    const named = render(<Markdown>{"```rows\nr = 5\\% | NPV = 89.3\n|x| < R\nf(x) = |x|\n```"}</Markdown>).container;
    const names = [...named.querySelectorAll(".board-label")];
    expect(names[0]?.querySelector(".katex")).toBeTruthy();
    expect(names.slice(1).map((n) => n.textContent)).toEqual(["", ""]);
    expect(named.querySelectorAll(".katex-error")).toHaveLength(0);
    expect(render(<Markdown>{"```rows\nClosure | a + b \\in F\n```"}</Markdown>).container.querySelector(".board-rows")?.getAttribute("data-dir")).toBe("ltr");
  });

  it("words that end with a colon before symbols: the symbols start on the next line", () => {
    const { container } = render(<Markdown>{"בדיוק אחד מהבאים: $a<b$, $a=b$\n\nלכל $c$: אם $a<b$"}</Markdown>);
    const [p1, p2] = [...container.querySelectorAll("p")];
    expect(p1?.innerHTML).toMatch(/מהבאים:<br><span class="(nobr|katex)"/);
    expect(p1?.querySelector(".nobr")?.textContent).toMatch(/,$/); // the comma stays with its formula
    expect(p2?.querySelector("br")).toBeNull(); // ": אם" — words follow the colon, no break
    expect(hebrewOutOfMath("\\text{מ-} x = x+x")).toBe("מ-$x = x+x$");
    expect(hebrewOutOfMath("|H|_{\\text{dB}} = -3 \\text{ שיפוע}")).toBe("$|H|_{\\text{dB}} = -3$ שיפוע"); // a subscript's words stay in the formula
  });

  it("edge cases: dollar amounts, arrow characters in Hebrew, chemistry, units in a formula", () => {
    // a price is not a formula; a formula still is, and inline code stays literal
    expect(escapeCurrency("המניה עלתה מ-$100 ל-$120 והתשואה $r$")).toBe("המניה עלתה מ-\\$100 ל-\\$120 והתשואה $r$");
    expect(escapeCurrency("עלות של $5 מיליון")).toBe("עלות של \\$5 מיליון");
    expect(escapeCurrency("$x$ ו-$2y$ `$5`")).toBe("$x$ ו-$2y$ `$5`");
    const fin = render(<Markdown>{"המניה עלתה מ-$100 ל-$120 ($20$ אחוז)"}</Markdown>).container;
    expect(fin.textContent).toContain("$100");
    expect(fin.querySelectorAll(".katex")).toHaveLength(1);
    // an arrow character next to Hebrew is turned to read right to left; between Latin words it stays
    expect(rtlTextArrows("גלוקוז → פירובט → לקטט")).toBe("גלוקוז ← פירובט ← לקטט");
    expect(rtlTextArrows("ATP → ADP")).toBe("ATP → ADP");
    expect(render(<Markdown>{"ATP → ADP משחרר אנרגיה, וגלוקוז → פירובט"}</Markdown>).container.textContent).toBe("ATP → ADP משחרר אנרגיה, וגלוקוז ← פירובט");
    expect(render(<Markdown>{"Glucose → pyruvate"}</Markdown>).container.textContent).toBe("Glucose → pyruvate"); // English: untouched
    // \ce (mhchem) renders, also in a Hebrew sentence; its arrows are KaTeX's
    const chem = render(<Markdown>{"התגובה $\\ce{2H2 + O2 -> 2H2O}$ משחררת חום"}</Markdown>).container;
    expect(chem.querySelector(".katex-error")).toBeNull();
    expect(chem.querySelector(".katex")).toBeTruthy();
    // a table row: "$" never pairs across cells, and a cell's words keep their spaces
    const table = render(<Markdown>{"| שנה | תזרים ($) | מקדם היוון ב-5% | ערך נוכחי ($) |\n|---|---|---|---|\n| 0 | −1,000 | 1.000 | $r$ |"}</Markdown>).container;
    expect([...table.querySelectorAll("th")].map((t) => t.textContent)).toEqual(["שנה", "תזרים ($)", "מקדם היוון ב-5%", "ערך נוכחי ($)"]);
    expect(table.querySelectorAll("td .katex")).toHaveLength(1); // "$r$" is still a formula
    // a sign at the edge of a number or a Latin word stays on its side in a Hebrew line (a left-to-right island)
    const edge = render(<Markdown>{"ההפסד −1,000 ו-~26 מולקולות NAD⁺ ב-25°C, בשלבים 1, 2, 3"}</Markdown>).container;
    expect([...edge.querySelectorAll(".ltr-token")].map((t) => t.textContent)).toEqual(["−1,000", "~26", "NAD⁺", "25°C"]);
    expect(edge.querySelector(".ltr-token")?.getAttribute("dir")).toBe("ltr");
    expect(render(<Markdown>{"| −1,000 |\n|---|\n| 400 |"}</Markdown>).container.querySelector("th .ltr-token")?.textContent).toBe("−1,000"); // a cell with only a number
    // a unit in \text stays inside its formula (no woven line)
    expect(mathPieces("-3 \\text{ dB}").every((p) => !p.words)).toBe(true);
    expect(mathPieces("\\text{exactly one of:} a<b")[0]).toEqual({ words: true, s: "exactly one of:" });
  });

  it("dispatches only the five figure tags", () => {
    expect(["mermaid", "plot", "geometry", "wavedrom", "svg", "python"].filter(isFigureTag)).toHaveLength(5);
  });
});
