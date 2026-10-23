import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/core/i18n";

/** Raw messages the server keeps in card data (English: the model and the logs read them too) → the key the student reads. */
const RULES: [RegExp, string][] = [
  [/^aborted$/, "job.stopped"], // bridge.ts: the request's own signal was aborted
  [/^(course not found|course\.json missing|plan\.json missing)$/, "errors.courseMissing"],
  [/^attachment \S+ not found$/, "errors.fileMissing"],
  [/^(ENOENT|EACCES|EPERM|ENOSPC|EROFS|EBUSY)\b/, "errors.disk"],
  [/^(Download failed|Download incomplete|Chromium was not installed)/, "errors.download"],
];
/** ClaudeError "invalid_output": the model's answer still failed validation after the corrections (structured.ts, plan/generate.ts, plan/refine.ts). */
const INVALID = /^(model did not call \w+|\w+: \[|plan (revision )?invalid: |outline has \d+ stages|unit \S+: stage ids )/;

/** The raw message is already a translation key (job.stopped, practice.noItems, grade.tooManyPages…). en has every key; an object path ("practice") is not a key. */
export const isKey = (raw: string) => typeof i18n.getResource("en", "translation", raw) === "string";

/** The i18n key for a raw error. `fallback` is the card's own failure sentence, used when no rule matches (model-output failures too). */
export function errorKey(raw: string | null | undefined, fallback?: string): string {
  if (raw && isKey(raw)) return raw;
  const rule = raw ? RULES.find(([re]) => re.test(raw)) : undefined;
  if (rule) return rule[1];
  return fallback ?? (raw && INVALID.test(raw) ? "errors.invalidOutput" : "errors.generic");
}

/** A card error: the translated sentence (announced), then the raw message in a closed Details for support. */
export function ErrorNote({
  raw,
  fallback,
  className = "text-sm text-danger",
  children,
}: {
  raw: string | null | undefined;
  fallback?: string;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1">
      <p role="alert" className={className}>
        {t(errorKey(raw, fallback))}
        {children && <> {children}</>}
      </p>
      {raw && !isKey(raw) && (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer">{t("errors.details")}</summary>
          <pre dir="auto" className="mt-1 font-mono whitespace-pre-wrap wrap-anywhere">
            {raw}
          </pre>
        </details>
      )}
    </div>
  );
}
