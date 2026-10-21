import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/core/i18n";
import { Markdown } from "./Markdown";
import { isFigureTag } from "./Figure";
import { splitRel } from "./Rows";

describe("Markdown", () => {
  it("renders RTL blocks with isolated math, tables, and ignores raw HTML", () => {
    const { container } = render(
      <Markdown>{"שלום $x\\in\\R$ עולם\n\n$$\n\\sum_{i}^{n} i\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>"}</Markdown>,
    );
    expect(container.querySelector("p")?.getAttribute("dir")).toBe("auto");
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

  it("dispatches only the five figure tags", () => {
    expect(["mermaid", "plot", "geometry", "wavedrom", "svg", "python"].filter(isFigureTag)).toHaveLength(5);
  });
});
