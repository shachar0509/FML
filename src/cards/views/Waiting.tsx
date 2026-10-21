import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";

/** "Waiting for Claude…" with a Nudge button after `afterMs` (plan v2 §11: the model may skip shalav_next_job). */
export function Waiting({ say, label, afterMs = 20000 }: { say: (t: string) => Promise<unknown>; label?: string; afterMs?: number }) {
  const { t } = useTranslation();
  const [late, setLate] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setLate(true), afterMs);
    return () => clearTimeout(h);
  }, [afterMs]);
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      <p className="text-sm text-muted">{label ?? t("mcp.waiting")}</p>
      {late && <Button variant="outline" onClick={() => void say(t("mcp.nudge"))}>{t("mcp.nudgeBtn")}</Button>}
    </div>
  );
}
