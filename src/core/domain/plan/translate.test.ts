import { expect, it } from "vitest";
import { FakeClaudeGateway, toolCall } from "@/core/claude/fake";
import type { ClaudeRequest } from "@/core/claude/types";
import type { CourseJson, PlanJson } from "@/core/domain/dataSchemas";
import { setFs } from "@/core/lib/fs/fs";
import { useSettings } from "@/stores/settings";
import { memFs } from "@/test/memfs";
import { localize, missing, translateCourse, translator } from "./translate";

const course = { courseNumber: "01040195", nameHe: "חשבון אינפיניטסימלי 1" } as CourseJson;
const plan = {
  units: [{ title: "סדרות" }],
  stages: [{ title: "גבולות", summary: "הגדרת הגבול" }, { title: "ε-N", summary: "Cauchy sequences" }],
} as PlanJson;

it("shows a text as is when it is in the language, else its translation, else the original", () => {
  const tr = translator({ "גבולות": "Limits" }, "en");
  expect(tr("גבולות")).toBe("Limits");
  expect(tr("סדרות")).toBe("סדרות"); // not translated yet
  expect(tr("Cauchy sequences")).toBe("Cauchy sequences"); // already English
  expect(missing(["∑ ∞", "2.1"], {}, "he")).toEqual([]); // no Hebrew or Latin letters: fine in either language
  expect(missing(["גבולות", "סדרות", "סדרות", "Cauchy", ""], { "גבולות": "Limits" }, "en")).toEqual(["סדרות"]);
  expect(missing(["גבולות", "Cauchy sequences"], {}, "he")).toEqual(["Cauchy sequences"]);
});

it("translates only the missing texts, saves them per language, and the next run asks for nothing", async () => {
  setFs(memFs());
  useSettings.setState({ settings: { ...useSettings.getState().settings, dataRoot: "/r" } });
  let asked = "";
  const gw = new FakeClaudeGateway([
    (r: ClaudeRequest) => {
      asked = JSON.stringify(r.messages);
      return toolCall("submit_translations", { items: [{ i: 1, text: "Calculus 1" }, { i: 2, text: "Sequences" }, { i: 3, text: "Limits" }, { i: 4, text: "Definition of the limit" }] });
    },
  ]);
  expect(await translateCourse(gw, course, plan, "en")).toBe(4);
  expect(asked).toContain("1. חשבון אינפיניטסימלי 1");
  expect(asked).not.toContain("Cauchy"); // already English
  const { tr, missing: left } = await localize(course, plan, "en");
  expect([tr(course.nameHe), tr("סדרות"), tr("גבולות")]).toEqual(["Calculus 1", "Sequences", "Limits"]);
  expect(left).toBe(0);
  expect(await translateCourse(new FakeClaudeGateway([]), course, plan, "en")).toBe(0); // nothing left: no job
  expect((await localize(course, plan, "he")).missing).toBe(2); // the other way is its own: "ε-N", "Cauchy sequences"
});
