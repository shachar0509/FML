import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { UNIVERSITIES } from "@/core/universities";
import type { SettingsData } from "../types";
import { h2, panel } from "../ui";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type L = SettingsData["learning"];
const NUMS: {
  key: Exclude<keyof L, "requireAllObjectives">;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: "minExercises", min: 1, max: 5, step: 1 },
  { key: "minExerciseScore", min: 70, max: 100, step: 1 },
  { key: "masteryThreshold", min: 0.6, max: 1, step: 0.05 },
  { key: "hintsBeforeSolution", min: 1, max: 3, step: 1 },
];
const DEFAULTS: L = {
  minExercises: 2,
  minExerciseScore: 85,
  masteryThreshold: 0.85,
  requireAllObjectives: true,
  hintsBeforeSolution: 3,
};

export function Settings({
  data,
  callTool,
}: {
  data: SettingsData;
  callTool: Tool;
}) {
  const { t, i18n } = useTranslation();
  const [d, setD] = useState(data);
  const save = async (patch: { language?: "he" | "en"; learning?: L }) => {
    const r = await callTool("settings_update", patch);
    if (r.structuredContent) setD(r.structuredContent as SettingsData);
  };
  const set = (patch: Partial<L>) => void save({ learning: { ...d.learning, ...patch } });
  return (
    <section className="flex flex-col gap-4" aria-label={t("mcp.settings.title")}>
      <h1 className="text-xl font-bold">{t("mcp.settings.title")}</h1>
      <div className={`${panel} flex flex-wrap items-center justify-between gap-3 p-4`}>
        <span className="font-medium">{t("settings.general.language")}</span>
        <div role="group" aria-label={t("settings.general.language")} className="flex gap-2">
          {(["he", "en"] as const).map((l) => (
            <Button
              key={l}
              size="sm"
              variant={d.language === l ? "default" : "outline"}
              aria-pressed={d.language === l}
              onClick={() => void save({ language: l })}
            >
              {l === "he" ? "עברית" : "English"}
            </Button>
          ))}
        </div>
      </div>
      <div className={`${panel} flex flex-col gap-4 p-4`}>
        {d.university && (
          <div>
            <p className={h2}>{t("university.label")}</p>
            <p className="text-sm">
              {i18n.language.startsWith("he")
                ? UNIVERSITIES[d.university].nameHe
                : UNIVERSITIES[d.university].nameEn}
            </p>
            <p className="text-sm text-muted">{t("university.locked")}</p>
          </div>
        )}
        <div>
          <p className={h2}>{t("mcp.settings.dataRoot")}</p>
          <p
            dir="ltr"
            className="my-1 rounded-md bg-border/50 px-2 py-1 font-mono text-xs break-all"
          >
            {d.dataRoot}
          </p>
          <p className="text-sm text-muted">{t("mcp.settings.dataHint")}</p>
        </div>
      </div>
      <div className={`${panel} flex flex-col gap-3 p-4`}>
        <div>
          <p className={h2}>{t("settings.tabs.learning")}</p>
          <p className="text-sm text-muted">{t("settings.learning.intro")}</p>
        </div>
        {NUMS.map(({ key, min, max, step }) => (
          <label
            key={key}
            className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm"
          >
            <span>{t(`settings.learning.${key}`)}</span>
            <Input
              type="number"
              dir="ltr"
              className="w-24"
              min={min}
              max={max}
              step={step}
              value={d.learning[key]}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v >= min && v <= max) set({ [key]: v });
              }}
            />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3 border-t border-border pt-3 text-sm">
          <span>{t("settings.learning.requireAllObjectives")}</span>
          <input
            type="checkbox"
            className="size-5 accent-[var(--primary)]"
            checked={d.learning.requireAllObjectives}
            onChange={(e) => set({ requireAllObjectives: e.target.checked })}
          />
        </label>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => void save({ learning: DEFAULTS })}
        >
          {t("settings.restoreDefaults")}
        </Button>
      </div>
      {d.conflicts.length ? (
        <div role="alert" className={`${panel} border-warning/60 p-4`}>
          <p className="font-bold">{t("mcp.settings.conflicts")}</p>
          <ul dir="ltr" className="list-disc ps-5 text-sm">
            {d.conflicts.map((c) => (
              <li key={c} className="break-all">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("mcp.settings.none")}</p>
      )}
    </section>
  );
}
