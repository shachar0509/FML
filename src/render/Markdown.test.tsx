import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "@/i18n";
import { Markdown } from "./Markdown";
import { isFigureTag } from "./Figure";

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

  it("dispatches only the five figure tags", () => {
    expect(["mermaid", "plot", "geometry", "wavedrom", "svg", "python"].filter(isFigureTag)).toHaveLength(5);
  });
});
