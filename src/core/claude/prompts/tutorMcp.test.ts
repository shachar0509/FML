import { expect, it } from "vitest";
import { tutorSystem } from "./tutor";

it("MCP tutor prompt: show_figure formats, TA lesson flow, no fenced figures", () => {
  const stage = { id: "S001", title: "t", objectives: [], newConcepts: [], prerequisites: [] };
  const s = tutorSystem({ course: { courseNumber: "1", nameHe: "x", credits: 1 }, courseKind: "m", stage, plan: { stages: [stage] }, minExercises: 2, lang: "Hebrew", knowledgeBoundary: "", lessonBrief: "", exercises: [], mistakeTags: [], mcp: true } as never);
  expect(s).toMatch(/figure in the teach_step/);
  expect(s).toMatch(/^- plot: JSON/m);
  expect(s).toMatch(/^- geometry: JSON/m);
  expect(s).toMatch(/^- svg: /m);
  expect(s).not.toMatch(/mermaid/);
  expect(s).toMatch(/notebook \(paper or tablet\)/);
  expect(s).toMatch(/like a TA checking homework/);
  expect(s).toMatch(/Teach first, quiz second/);
  expect(s).toMatch(/no question in this first message/);
  expect(s).toMatch(/One teach_step per message/);
  expect(s).toMatch(/never in the chat text/);
});
