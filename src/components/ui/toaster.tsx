import { create } from "zustand";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./button";

// Spec 12.7: bottom end corner, max 3 stacked, 5s auto-dismiss, errors persist.
type Toast = {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  action?: { label: string; onClick: () => void };
};

let nextId = 1;
export const MAX_TOASTS = 3;
export const TOAST_MS = 5000;

export const useToasts = create<{ toasts: Toast[]; dismiss: (id: number) => void }>((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function toast(t: Omit<Toast, "id" | "kind"> & { kind?: Toast["kind"] }) {
  const full: Toast = { kind: "info", ...t, id: nextId++ };
  useToasts.setState((s) => ({ toasts: [...s.toasts, full].slice(-MAX_TOASTS) }));
  if (full.kind !== "error") setTimeout(() => useToasts.getState().dismiss(full.id), TOAST_MS);
}

export function Toaster() {
  const { t } = useTranslation();
  const { toasts, dismiss } = useToasts();
  return (
    <div className="fixed bottom-4 end-4 z-50 flex w-80 flex-col gap-2">
      {toasts.map((x) => (
        <div
          key={x.id}
          role={x.kind === "error" ? "alert" : "status"}
          className="flex items-center gap-2 rounded-card border border-border bg-card p-3 text-sm shadow-lg"
        >
          <span className="flex-1">{x.message}</span>
          {x.action && (
            <Button
              variant="outline"
              onClick={() => {
                x.action?.onClick();
                dismiss(x.id);
              }}
            >
              {x.action.label}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("toast.close")}
            onClick={() => dismiss(x.id)}
          >
            <X className="size-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
