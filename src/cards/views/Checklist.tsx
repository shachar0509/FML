import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { BuildStatus, FileCounts, Go } from "../types";
import { Waiting } from "./Waiting";

const STEPS = ["plan", "index", "cover"] as const;
const DOTS = { scanned: "bg-success", scanning: "bg-warning", notScanned: "bg-danger", total: "bg-muted" } as const;

/** The scan step's files by state, colored like the file lists' legend. */
function Counts({ c }: { c: FileCounts }) {
  const { t } = useTranslation();
  return (
    <span className="flex flex-wrap gap-x-3 text-xs text-muted">
      {(Object.keys(DOTS) as (keyof FileCounts)[]).map((k) => (
        <span key={k} className="flex items-center gap-1">
          <span className={`size-2 rounded-full ${DOTS[k]}`} aria-hidden />
          {t(`files.state.${k}`)} <span className="font-medium text-fg tabular-nums">{c[k]}</span>
        </span>
      ))}
    </span>
  );
}
/** Plan build checklist (v1 §4.3): spinner -> check. */
export function Checklist({ b, go }: { b: BuildStatus; go: Go }) {
  const { t } = useTranslation();
  const cur = STEPS.indexOf(b.step ?? "plan");
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
              {i === cur && s === "plan" && b.unit ? t("plan.detailing", b.unit) : t(`plan.step.${s}`)}
            </span>
            {i === cur && s === "index" && b.files && <Counts c={b.files} />}
          </li>
        ))}
      </ul>
      {!!b.pending && <Waiting go={go} req={{ kind: "build" }} />}
    </div>
  );
}
