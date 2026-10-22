import { Check, CircleSlash, HelpCircle, Minus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Grade } from "@/core/claude/practiceTools";
import { Markdown } from "@/core/render/Markdown";

/** Unreadable attempts carry no score and are ignored by mastery (7.6, 12.8). */
export const readable = (g: Grade | null): g is Grade =>
  !!g && g.verdict !== "unreadable" && g.legibility !== "illegible";

const ICON = {
  correct: Check,
  error: X,
  missing: Minus,
  unjustified: HelpCircle,
  irrelevant: CircleSlash,
} as const;
const TONE = {
  correct: "text-success",
  error: "text-danger",
  missing: "text-warning",
  unjustified: "text-warning",
  irrelevant: "text-muted",
} as const;
const SEV = {
  minor: "bg-border",
  major: "bg-warning text-bg",
  critical: "bg-danger text-bg",
} as const;
const VERDICT = {
  correct: "bg-success text-white dark:text-bg",
  partially_correct: "bg-warning text-bg",
  incorrect: "bg-danger text-bg",
  incomplete: "bg-warning text-bg",
  unreadable: "bg-border",
} as const;

export function GradeCard({
  grade,
  hintsUsed,
  solutionRevealed,
}: {
  grade: Grade;
  hintsUsed: number;
  solutionRevealed: boolean;
}) {
  const { t, i18n } = useTranslation();
  const he = i18n.language === "he";
  const parts = grade.illegibleParts.length > 0 && (
    <p className="text-sm text-muted">
      {t("grade.illegibleParts")} {grade.illegibleParts.join("; ")}
    </p>
  );
  if (!readable(grade))
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-card border border-warning/60 bg-card p-4 shadow-card"
      >
        <p>{t("grade.unreadable")}</p>
        {parts}
      </div>
    );
  const list = (title: string, xs: string[]) =>
    xs.length > 0 && (
      <div>
        <h4 className="font-medium">{title}</h4>
        <ul className="ms-5 list-disc text-sm">
          {xs.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </div>
    );
  return (
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 shadow-card">
      <div className="flex items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-sm font-bold ${VERDICT[grade.verdict]}`}>
          {t(`grade.verdict.${grade.verdict}`)}
        </span>
        <span className="ms-auto text-lg font-bold tabular-nums">
          {t("grade.score")} {Math.round(grade.score)}
        </span>
      </div>
      <Markdown>{grade.summaryMd}</Markdown>
      {grade.steps.length > 0 && (
        <div>
          <h4 className="font-medium">{t("grade.steps")}</h4>
          <ul className="flex flex-col gap-2 text-sm">
            {grade.steps.map((s, i) => {
              const Icon = ICON[s.status];
              return (
                <li key={i} className="flex items-start gap-2">
                  <Icon
                    className={`mt-1 size-4 shrink-0 ${TONE[s.status]}`}
                    aria-label={s.status}
                  />
                  <div className="min-w-0">
                    <span className="font-medium">{s.label}</span>
                    <Markdown>{s.commentMd}</Markdown>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {list(t("grade.missing"), grade.missingForFullCredit)}
      {grade.mistakes.length > 0 && (
        <div>
          <h4 className="font-medium">{t("grade.mistakes")}</h4>
          <ul className="flex flex-col gap-2 text-sm">
            {grade.mistakes.map((m) => (
              <li key={m.tag} className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{he ? m.labelHe : m.labelEn}</span>
                  <span className={`rounded px-1.5 text-xs ${SEV[m.severity]}`}>
                    {t(`grade.severity.${m.severity}`)}
                  </span>
                </div>
                <Markdown>{m.whereMd}</Markdown>
              </li>
            ))}
          </ul>
        </div>
      )}
      {list(t("grade.edgeCases"), grade.edgeCasesMissed)}
      {grade.correctedKeyStepMd && (
        <div>
          <h4 className="font-medium">{t("grade.correctedKey")}</h4>
          <Markdown>{grade.correctedKeyStepMd}</Markdown>
        </div>
      )}
      {grade.usesMaterialBeyondCompleted.length > 0 && (
        <p className="text-sm text-warning">
          {t("grade.beyond")} {grade.usesMaterialBeyondCompleted.join("; ")}
        </p>
      )}
      {parts}
      {(hintsUsed > 0 || solutionRevealed) && (
        <p className="text-sm text-muted">
          {hintsUsed > 0 && t("grade.hintsUsed", { n: hintsUsed })}
          {hintsUsed > 0 && solutionRevealed && " · "}
          {solutionRevealed && t("grade.solutionRevealed")}
        </p>
      )}
    </div>
  );
}
