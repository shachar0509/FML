import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function Row({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-3 border-b border-border py-3", className)}>
      <div className="min-w-48 flex-1 text-start">
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export const Select = ({ className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("h-9 rounded-lg border border-border bg-card px-2 text-sm", className)} {...p} />
);

export const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <input type="checkbox" role="switch" aria-label={label} className="size-5 accent-primary" checked={checked} onChange={(e) => onChange(e.target.checked)} />
);

/** Runs `apply` right away when !needsWarning, otherwise after the model.warn* dialog is confirmed. Cancel just closes (controls are controlled, so they revert). */
export function useWarn() {
  const { t } = useTranslation();
  const [pending, setPending] = useState<(() => void) | null>(null);
  const warn = (needsWarning: boolean, apply: () => void) => (needsWarning ? setPending(() => apply) : apply());
  const dialog = (
    <Dialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
      <DialogContent>
        <DialogTitle className="mb-2 text-lg font-semibold">{t("model.warnTitle")}</DialogTitle>
        <DialogDescription className="mb-4 text-sm">{t("model.warnBody")}</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setPending(null)}>
            {t("model.warnCancel")}
          </Button>
          <Button
            onClick={() => {
              pending?.();
              setPending(null);
            }}
          >
            {t("model.warnConfirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
  return { warn, dialog };
}
