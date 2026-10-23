import { expect, it } from "vitest";
import { mermaidBeats } from "./Mermaid";

it("mermaid beats: markers are stripped; a marked line's nodes and edges (by order) get its beat", () => {
  const m = mermaidBeats(`flowchart LR
  A[קלט] --> B{בדיקה}
  B -->|כן| C(("x > 1")) %% @2
  B -.-> D[שגיאה] %% @3-4
  class C m-blue`);
  expect(m.source).not.toMatch(/@\d/);
  expect([...m.nodes]).toEqual([["C", ["2", undefined]], ["D", ["3", "4"]]]); // B is named first on an unmarked line
  expect(m.edges).toEqual([null, ["2", undefined], ["3", "4"]]);
  const s = mermaidBeats(`stateDiagram-v2
  [*] --> q0
  q0 --> q1: a %% @2
  q1 --> [*] %% @3`);
  expect(s.edges).toEqual([null, ["2", undefined], ["3", undefined]]);
  expect(s.nodes.get("q1")).toEqual(["2", undefined]);
});
