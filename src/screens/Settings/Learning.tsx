import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_SETTINGS, type Settings } from "@/domain/schemas";
import { useSettings } from "@/stores/settings";
import { Row, Toggle } from "./parts";

type L = Settings["learning"];
const NUMS: { key: Exclude<keyof L, "requireAllObjectives">; min: number; max: number; step: number }[] = [
  { key: "minExercises", min: 1, max: 5, step: 1 },
  { key: "minExerciseScore", min: 70, max: 100, step: 1 },
  { key: "masteryThreshold", min: 0.6, max: 1, step: 0.05 },
  { key: "hintsBeforeSolution", min: 1, max: 3, step: 1 },
];
const D = DEFAULT_SETTINGS.learning;

export function Learning() {
  const { t } = useTranslation();
  const learning = useSettings((s) => s.settings.learning);
  const update = useSettings((s) => s.update);
  const set = (patch: Partial<L>) => update({ learning: { ...learning, ...patch } });

  return (
    <div>
      <p className="mb-2 text-sm text-muted">{t("settings.learning.intro")}</p>
      {NUMS.map(({ key, min, max, step }) => (
        <Row key={key} label={t(`settings.learning.${key}`)} hint={t("settings.default", { v: D[key] })}>
          <Input
            type="number"
            dir="ltr"
            className="w-24"
            aria-label={t(`settings.learning.${key}`)}
            min={min}
            max={max}
            step={step}
            value={learning[key]}
            onChange={(e) => {
              const v = e.target.valueAsNumber;
              if (Number.isFinite(v) && v >= min && v <= max) set({ [key]: v });
            }}
          />
        </Row>
      ))}
      <Row label={t("settings.learning.requireAllObjectives")} hint={t("settings.default", { v: t(D.requireAllObjectives ? "settings.on" : "settings.off") })}>
        <Toggle label={t("settings.learning.requireAllObjectives")} checked={learning.requireAllObjectives} onChange={(v) => set({ requireAllObjectives: v })} />
      </Row>
      <Button variant="outline" className="mt-4" onClick={() => update({ learning: D })}>
        {t("settings.restoreDefaults")}
      </Button>
    </div>
  );
}
