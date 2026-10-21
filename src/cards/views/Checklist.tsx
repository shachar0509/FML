import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BuildStatus } from "../types";
import { Waiting } from "./Waiting";

const STEPS = ["folders", "plan", "validate", "progress"] as const;
/** Plan build checklist (v1 §4.3): spinner -> check. */
export function Checklist({ b, say }: { b: BuildStatus; say: (t: string) => Promise<unknown> }) {
  const { t } = useTranslation();
  const cur = STEPS.indexOf(b.step ?? "folders");
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="text-sm text-muted">{t("plan.building")}</p>
      <ul className="flex flex-col gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-sm">
            {i < cur ? <Check className="size-4 text-success" aria-hidden /> : i === cur ? <Loader2 className="size-4 animate-spin text-primary" aria-hidden /> : <span className="size-4 rounded-full border border-border" />}
            <span className={i > cur ? "text-muted" : ""}>{s === "plan" && i === cur && b.unit ? t("plan.detailing", b.unit) : t(`plan.step.${s}`)}</span>
          </li>
        ))}
      </ul>
      {!!b.pending && <Waiting say={say} />}
    </div>
  );
}
