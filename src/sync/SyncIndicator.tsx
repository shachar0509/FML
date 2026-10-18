import { CircleX, CloudAlert, CloudCheck, CloudOff, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { connectSync, retrySync, syncAvailable, useSyncStatus, type SyncKind } from "./runtime";

const ICONS: Record<SyncKind, { Icon: typeof CloudOff; cls: string }> = {
  off: { Icon: CloudOff, cls: "text-muted" },
  synced: { Icon: CloudCheck, cls: "text-success" },
  syncing: { Icon: Loader2, cls: "animate-spin" },
  offline: { Icon: CloudOff, cls: "text-muted" },
  error: { Icon: CircleX, cls: "text-danger" },
  reconnect: { Icon: CloudAlert, cls: "text-warning" },
};

export function SyncIcon({ kind, className = "size-4" }: { kind: SyncKind; className?: string }) {
  const { Icon, cls } = ICONS[kind];
  return <Icon className={`${className} ${cls}`} />;
}

function ago(iso: string | null, lang: string) {
  const min = iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0;
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  return min < 60 ? rtf.format(-min, "minute") : min < 1440 ? rtf.format(-Math.round(min / 60), "hour") : rtf.format(-Math.round(min / 1440), "day");
}

/** Spec 14.6 status text (also used as the tooltip). */
export function useSyncLabel() {
  const { t, i18n } = useTranslation();
  const { kind, pending, lastSyncAt, error } = useSyncStatus((s) => s.status);
  switch (kind) {
    case "synced":
      return t("sync.synced", { when: ago(lastSyncAt, i18n.language) });
    case "syncing":
      return t("sync.syncing", { count: pending });
    case "error":
      return error ?? t("sync.error");
    default:
      return t(`sync.${kind}`);
  }
}

export function SyncIndicator() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const kind = useSyncStatus((s) => s.status.kind);
  const label = useSyncLabel();
  if (!syncAvailable) return null;

  const run = (p: Promise<void>) => p.catch((e: unknown) => toast({ kind: "error", message: e instanceof Error ? e.message : String(e) }));
  const onClick = () => {
    if (kind === "off") void navigate("/settings?tab=sync");
    else if (kind === "error") void run(retrySync());
    else if (kind === "reconnect") void run(connectSync());
    else void navigate("/settings?tab=sync");
  };
  return (
    <Button variant="ghost" size="icon" aria-label={t("nav.sync")} title={label} onClick={onClick}>
      <SyncIcon kind={kind} />
    </Button>
  );
}
