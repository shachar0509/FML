import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Grade } from "@/claude/practiceTools";
import { PlanJsonSchema } from "@/domain/dataSchemas";
import i18n from "@/i18n";
import { ScopeChooser } from "@/screens/Practice/parts";
import { GradeCard } from "./GradeCard";

const grade = (o: Partial<Grade>): Grade => ({
  legibility: "clear", illegibleParts: [], verdict: "correct", score: 88, summaryMd: "SUM", steps: [], missingForFullCredit: [],
  mistakes: [], edgeCasesMissed: [], correctedKeyStepMd: "", usesMaterialBeyondCompleted: [], stageIds: [], ...o,
});
beforeEach(() => i18n.changeLanguage("en"));

describe("GradeCard", () => {
  it("shows the unreadable copy and no score", () => {
    render(<GradeCard grade={grade({ verdict: "unreadable", legibility: "illegible" })} hintsUsed={0} solutionRevealed={false} />);
    expect(screen.getByText(/couldn't read the solution/)).toBeTruthy();
    expect(screen.queryByText(/Score/)).toBeNull();
  });
  it("shows score and hints used", () => {
    render(<GradeCard grade={grade({})} hintsUsed={2} solutionRevealed={false} />);
    expect(screen.getByText("Score 88")).toBeTruthy();
    expect(screen.getByText("Hints used: 2")).toBeTruthy();
  });
});

describe("ScopeChooser", () => {
  const st = (n: number) => ({
    id: `S00${n}`, unitId: "U01", order: n, title: `t${n}`, summary: "s", kind: "concept", objectives: ["o"], newConcepts: [], theorems: [],
    techniques: [], prerequisites: [], edgeCases: [], examRelevance: "core", estimatedMinutes: 30,
  });
  const plan = PlanJsonSchema.parse({
    schema: 1, courseNumber: "01040195", version: 1, generatedAt: "", model: "m", courseKind: "computational",
    units: [{ id: "U01", title: "u", summary: "s", stageIds: ["S001", "S002"] }], stages: [st(1), st(2)],
  });
  it("Start passes the chosen scope", () => {
    const onStart = vi.fn();
    render(<ScopeChooser plan={plan} completed={new Set(["S001"])} onStart={onStart} />);
    fireEvent.click(screen.getByText("Start"));
    expect(onStart).toHaveBeenLastCalledWith({ kind: "all" });
    fireEvent.change(screen.getAllByRole("combobox")[0] as HTMLElement, { target: { value: "stage" } });
    fireEvent.click(screen.getByText("Start"));
    expect(onStart).toHaveBeenLastCalledWith({ kind: "stage", stageId: "S001" });
  });
});
