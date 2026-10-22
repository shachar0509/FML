import type { Go } from "../types";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";

/** "Waiting for Claude…" with a Nudge button after `afterMs` (plan v2 §11: the model may skip shalav_next_job). */
export function Waiting({
  go,
  req,
  label,
  afterMs = 20000,
  cancel,
}: {
  go: Go;
  /** what the Nudge asks for (default: "▶️ Continue") */
  req?: Parameters<Go>[0];
  label?: string;
  afterMs?: number;
  /** Stops the job (shalav_cancel); the card's polling then shows it ended. */
  cancel?: () => void;
}) {
  const { t } = useTranslation();
  const [late, setLate] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setLate(true), afterMs);
    return () => clearTimeout(h);
  }, [afterMs]);
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2
          className="size-4 animate-spin text-primary motion-reduce:animate-none"
          aria-hidden
        />
        {label ?? t("mcp.waiting")}
      </p>
      {late && (
        <Button variant="outline" size="sm" onClick={() => void (req ? go(req) : go())}>
          {t("mcp.nudgeBtn")}
        </Button>
      )}
      {cancel && (
        <Button variant="ghost" size="sm" onClick={cancel}>
          {t("job.cancel")}
        </Button>
      )}
    </div>
  );
}
