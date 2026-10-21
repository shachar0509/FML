import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/core/i18n";
import { balanceDollars, fixMath, hebrewOutOfMath, joinHyphenatedMath, Markdown } from "./Markdown";
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
    expect(hebrewOutOfMath(String.raw`a < b \text{ וגם } b < c \Rightarrow a < c`)).toBe(String.raw`$a < b$ וגם $b < c \Rightarrow a < c$`);
    expect(hebrewOutOfMath("בדיוק אחד מהבאים: a<b, a=b")).toBe("בדיוק אחד מהבאים: $a<b, a=b$");
    expect(fixMath("אם $a<b \\text{ אז } c$ ו-`$x$ שלום`")).toBe("אם $a<b$ אז $c$ ו-`$x$ שלום`"); // code untouched
    expect(fixMath("$$\na \\text{ כאשר } b\n$$")).toBe("$$\na \\text{ כאשר } b\n$$"); // display math stays whole
    // "$…$$" / "$$…$" (mismatched delimiters) showed raw; matched ones are untouched
    expect(balanceDollars("($a \\cdot a^{-1} = 1$ לכל $a \\neq 0$$)")).toBe("($a \\cdot a^{-1} = 1$ לכל $a \\neq 0$)");
    expect(balanceDollars("$$x$ ו-$y$")).toBe("$x$ ו-$y$");
    for (const ok of ["$a$ $b$", "$$a$$ ו-$b$", "$$\na\n$$", "\\$5$$"]) expect(balanceDollars(ok)).toBe(ok);
    expect(fixMath("$$x = 1 \\quad איבר אפס$$")).toBe("$$x = 1 \\quad \\text{איבר אפס}$$"); // bare Hebrew wrapped as one run
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

  it("dispatches only the five figure tags", () => {
    expect(["mermaid", "plot", "geometry", "wavedrom", "svg", "python"].filter(isFigureTag)).toHaveLength(5);
  });
});
