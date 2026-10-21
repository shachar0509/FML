import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { UNIVERSITIES } from "@/core/universities";
import type { SettingsData } from "../types";

type Tool = (name: string, args?: Record<string, unknown>) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type L = SettingsData["learning"];
const NUMS: { key: Exclude<keyof L, "requireAllObjectives">; min: number; max: number; step: number }[] = [
  { key: "minExercises", min: 1, max: 5, step: 1 },
  { key: "minExerciseScore", min: 70, max: 100, step: 1 },
  { key: "masteryThreshold", min: 0.6, max: 1, step: 0.05 },
  { key: "hintsBeforeSolution", min: 1, max: 3, step: 1 },
];
const DEFAULTS: L = { minExercises: 2, minExerciseScore: 85, masteryThreshold: 0.85, requireAllObjectives: true, hintsBeforeSolution: 3 };

export function Settings({ data, callTool, back }: { data: SettingsData; callTool: Tool; back: () => void }) {
  const { t, i18n } = useTranslation();
  const [d, setD] = useState(data);
  const save = async (patch: { language?: "he" | "en"; learning?: L }) => {
    const r = await callTool("settings_update", patch);
    if (r.structuredContent) setD(r.structuredContent as SettingsData);
  };
  const set = (patch: Partial<L>) => void save({ learning: { ...d.learning, ...patch } });
  return (
    <section className="flex flex-col gap-4 p-4" aria-label={t("mcp.settings.title")}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("mcp.settings.title")}</h1>
        <Button variant="outline" onClick={back}>{t("mcp.back")}</Button>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>{t("settings.general.language")}</span>
        <div role="group" aria-label={t("settings.general.language")} className="flex gap-2">
          {(["he", "en"] as const).map((l) => (
            <Button key={l} variant={d.language === l ? "default" : "outline"} aria-pressed={d.language === l} onClick={() => void save({ language: l })}>
              {l === "he" ? "עברית" : "English"}
            </Button>
          ))}
        </div>
      </div>
      <div>
        {d.university && (
          <>
            <p className="font-bold">{t("university.label")}</p>
            <p className="text-sm">{i18n.language.startsWith("he") ? UNIVERSITIES[d.university].nameHe : UNIVERSITIES[d.university].nameEn}</p>
            <p className="text-sm text-muted">{t("university.locked")}</p>
          </>
        )}
        <p className="font-bold">{t("mcp.settings.dataRoot")}</p>
        <p dir="ltr" className="break-all text-sm">{d.dataRoot}</p>
        <p className="text-sm text-muted">{t("mcp.settings.dataHint")}</p>
      </div>
      <div className="flex flex-col gap-2">
        <p className="font-bold">{t("settings.tabs.learning")}</p>
        <p className="text-sm text-muted">{t("settings.learning.intro")}</p>
        {NUMS.map(({ key, min, max, step }) => (
          <label key={key} className="flex items-center justify-between gap-3">
            <span>{t(`settings.learning.${key}`)}</span>
            <Input
              type="number" dir="ltr" className="w-24" min={min} max={max} step={step} value={d.learning[key]}
              onChange={(e) => {
                const v = e.target.valueAsNumber;
                if (Number.isFinite(v) && v >= min && v <= max) set({ [key]: v });
              }}
            />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3">
          <span>{t("settings.learning.requireAllObjectives")}</span>
          <input type="checkbox" className="size-5" checked={d.learning.requireAllObjectives} onChange={(e) => set({ requireAllObjectives: e.target.checked })} />
        </label>
        <Button variant="outline" className="self-start" onClick={() => void save({ learning: DEFAULTS })}>{t("settings.restoreDefaults")}</Button>
      </div>
      {d.conflicts.length ? (
        <div role="alert" className="rounded-card border border-border bg-card p-3">
          <p className="font-bold">{t("mcp.settings.conflicts")}</p>
          <ul dir="ltr" className="list-disc ps-5 text-sm">{d.conflicts.map((c) => <li key={c} className="break-all">{c}</li>)}</ul>
        </div>
      ) : (
        <p className="text-sm text-muted">{t("mcp.settings.none")}</p>
      )}
    </section>
  );
}
