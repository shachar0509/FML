import { expect, it } from "vitest";
import { tutorSystem } from "./tutor";

it("MCP tutor prompt: show_figure formats, TA lesson flow, no fenced figures", () => {
  const stage = { id: "S001", title: "t", objectives: [], newConcepts: [], prerequisites: [] };
  const s = tutorSystem({ course: { courseNumber: "1", nameHe: "x", credits: 1 }, courseKind: "m", stage, plan: { stages: [stage] }, minExercises: 2, lang: "Hebrew", knowledgeBoundary: "", lessonBrief: "", exercises: [], mistakeTags: [], mcp: true } as never);
  expect(s).toMatch(/figure in the teach_step/);
  // M79: the prompt lists the kinds in one line each; each kind's format comes from figure_guide
  for (const k of ["plot", "geometry", "tikz", "bio", "svg"]) expect(s).toMatch(new RegExp(`^- ${k}: `, "m"));
  expect(s).toMatch(/call figure_guide with that kind/);
  expect(s).not.toMatch(/"boundingBox"/); // the formats themselves are not in the prompt
  expect(s).not.toMatch(/mermaid/);
  expect(s).toMatch(/notebook \(paper or tablet\)/);
  expect(s).toMatch(/like a TA checking homework/);
  expect(s).toMatch(/Teach first, quiz second/);
  expect(s).toMatch(/no question in this first message/);
  expect(s).toMatch(/One teach_step per message/);
  expect(s).toMatch(/never in the chat text/);
  expect(s).toContain("```rows\nטבעיים | \\N = ");
  expect(s).toMatch(/\[!definition\]/);
  expect(s).toMatch(/sideMd/);
  expect(s).toMatch(/never put Hebrew or words inside math/);
  // M78: interactive slides: beats, figure parts by beat, the word-to-drawing colour link
  expect(s).toMatch(/Interactive slides \(beats\)/);
  expect(s).toMatch(/data-beat="n"/);
  expect(s).toMatch(/@n \/ @n-m/);
  expect(s).toMatch(/A worked example, a derivation or a process on one drawing is ONE teach_step with beats/);
  expect(s).toMatch(/\\blue\{גרעין\} with the nucleus in m-blue/);
});

it("figure guides: every kind has one, with its beat convention", async () => {
  const { FIGURE_KINDS, figureGuide, CATALOGUE } = await import("./figureGuides");
  for (const k of FIGURE_KINDS) expect(figureGuide(k, ["nucleus"])).toMatch(/[Bb]eats?/);
  expect(figureGuide("geometry", [])).toContain('"boundingBox"');
  expect(figureGuide("tikz", [])).toMatch(/% @n/);
  expect(figureGuide("bio", ["nucleus", "leaf"])).toContain("Parts: nucleus, leaf.");
  expect(CATALOGUE.length).toBeLessThan(1600); // about 400 tokens in every lesson prompt
});
