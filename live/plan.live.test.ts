/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { expect, it } from "vitest";
import { generatePlan } from "@/domain/plan/generate";
import { renderPlanMd, stageRange } from "@/domain/plan/plan";
import { catalog, KEY, liveEnv, save } from "./setup";

const COURSE = process.env.SHALAV_LIVE_COURSE ?? "01040195";

it.skipIf(!KEY)(`builds a plan for ${COURSE} from the real catalog`, async () => {
  const { gw, usage } = await liveEnv("he");
  const entry = await catalog().lookup(COURSE);
  expect(entry).not.toBeNull();
  save(`catalog-${COURSE}.json`, entry);
  const t0 = Date.now();
  const plan = await generatePlan({ gw, course: entry!, lang: "he", onProgress: (p) => console.log("progress", JSON.stringify(p)) });
  save(`plan-${COURSE}.json`, plan);
  save(`plan-${COURSE}.md`, renderPlanMd(entry!, plan));
  save(`usage-plan-${COURSE}.json`, usage);
  const kinds: Record<string, number> = {};
  for (const s of plan.stages) kinds[s.kind] = (kinds[s.kind] ?? 0) + 1;
  console.log(JSON.stringify({ stages: plan.stages.length, range: stageRange(entry!.credits), units: plan.units.length, kinds, seconds: (Date.now() - t0) / 1000 }));
});
