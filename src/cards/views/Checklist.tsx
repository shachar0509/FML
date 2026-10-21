import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BuildStatus, Go } from "../types";
import { Waiting } from "./Waiting";

const STEPS = ["folders", "plan", "validate", "progress"] as const;
/** Plan build checklist (v1 §4.3): spinner -> check. */
export function Checklist({ b, go }: { b: BuildStatus; go: Go }) {
  const { t } = useTranslation();
  const cur = STEPS.indexOf(b.step ?? "folders");
  return (
    <div className="flex flex-col gap-3" role="status">
      <p className="font-medium">{t("plan.building")}</p>
      <ul className="flex flex-col gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-sm">
            {i < cur ? (
              <Check className="size-4 text-success" aria-hidden />
            ) : i === cur ? (
              <Loader2
                className="size-4 animate-spin text-primary motion-reduce:animate-none"
                aria-hidden
              />
            ) : (
              <span className="size-4 rounded-full border-2 border-border" aria-hidden />
            )}
            <span className={i > cur ? "text-muted" : ""}>
              {s === "plan" && i === cur && b.unit
                ? t("plan.detailing", b.unit)
                : t(`plan.step.${s}`)}
            </span>
          </li>
        ))}
      </ul>
      {!!b.pending && <Waiting go={go} />}
    </div>
  );
}
