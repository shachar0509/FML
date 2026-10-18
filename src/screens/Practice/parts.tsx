import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { PlanJson } from "@/domain/dataSchemas";
import type { Scope } from "@/domain/practice/select";

const sel = "rounded-lg border border-border bg-card p-2 text-sm";

/** Scope chooser (7.2). Units/stages offered are the ones with a completed stage. */
export function ScopeChooser({ plan, completed, onStart }: { plan: PlanJson; completed: Set<string>; onStart: (s: Scope) => void }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Scope["kind"]>("all");
  const units = plan.units.filter((u) => u.stageIds.some((s) => completed.has(s)));
  const stages = plan.stages.filter((s) => completed.has(s.id));
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [stageId, setStageId] = useState(stages[0]?.id ?? "");
  const scope: Scope = kind === "unit" ? { kind, unitId } : kind === "stage" ? { kind, stageId } : { kind };
  return (
    <div className="flex flex-col items-start gap-4">
      <h2 className="text-lg font-bold">{t("practice.chooseTitle")}</h2>
      <select aria-label={t("practice.chooseTitle")} className={sel} value={kind} onChange={(e) => setKind(e.target.value as Scope["kind"])}>
        {(["all", "unit", "weak", "stage"] as const).map((k) => <option key={k} value={k}>{t(`practice.scope.${k}`)}</option>)}
      </select>
      {kind === "unit" && (
        <select aria-label={t("practice.pickUnit")} className={sel} value={unitId} onChange={(e) => setUnitId(e.target.value)}>
          {units.map((u) => <option key={u.id} value={u.id}>{u.title}</option>)}
        </select>
      )}
      {kind === "stage" && (
        <select aria-label={t("practice.pickStage")} className={sel} value={stageId} onChange={(e) => setStageId(e.target.value)}>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.id} · {s.title}</option>)}
        </select>
      )}
      <Button onClick={() => onStart(scope)}>{t("practice.start")}</Button>
    </div>
  );
}

export const Skeleton = () => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-6" aria-busy="true">
      <div className="h-4 w-2/3 animate-pulse rounded bg-border" />
      <div className="h-4 w-1/2 animate-pulse rounded bg-border" />
      <p className="text-sm text-muted">{t("practice.preparing")}</p>
    </div>
  );
};
