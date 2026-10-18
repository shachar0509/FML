import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { join } from "@/lib/fs/paths";
import { useSettings } from "@/stores/settings";
import { SyncIcon, useSyncLabel } from "@/sync/SyncIndicator";
import { connectSync, disconnectSync, syncAvailable, syncNow, useSyncStatus } from "@/sync/runtime";
import { inTauri, Row } from "./parts";

export function Sync() {
  const { t } = useTranslation();
  const dataRoot = useSettings((s) => s.settings.dataRoot);
  const { status, email, conflicts } = useSyncStatus();
  const label = useSyncLabel();
  const [busy, setBusy] = useState(false);
  if (!syncAvailable) return <p className="text-muted">{t("settings.sync.unavailable")}</p>;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    try {
      await f();
    } catch (e) {
      toast({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
    setBusy(false);
  };
  const reveal = async (rel: string) => {
    if (inTauri()) await (await import("@tauri-apps/plugin-opener")).revealItemInDir(join(dataRoot, rel));
  };
  const connected = status.kind !== "off";

  return (
    <div>
      <Row label={t("settings.sync.status")}>
        <span className="flex items-center gap-2 text-sm">
          <SyncIcon kind={status.kind} />
          {label}
        </span>
      </Row>
      <Row label={t("settings.sync.account")}>
        <span dir="ltr" className="text-sm">{email ?? t("settings.sync.notConnected")}</span>
      </Row>
      <Row label={t("settings.sync.lastSync")}>
        <span className="text-sm">{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : "—"}</span>
      </Row>
      <Row label="">
        {connected ? (
          <>
            <Button variant="outline" disabled={busy} onClick={() => void run(syncNow)}>
              {t("settings.sync.now")}
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => void run(disconnectSync)}>
              {t("settings.sync.disconnect")}
            </Button>
          </>
        ) : (
          <Button disabled={busy} onClick={() => void run(connectSync)}>
            {t("settings.sync.connect")}
          </Button>
        )}
      </Row>
      {conflicts.length > 0 && (
        <div className="py-3">
          <div className="mb-1 text-sm font-medium">{t("settings.sync.conflicts")}</div>
          <ul>
            {conflicts.map((c) => (
              <li key={c.relPath + c.at} className="flex items-center justify-between gap-2 py-1 text-sm">
                <span dir="ltr" className="break-all">{c.relPath}</span>
                <Button variant="outline" onClick={() => void reveal(c.relPath)}>
                  {t("settings.sync.show")}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ul className="mt-3 list-disc ps-5 text-xs text-muted">
        <li>{t("settings.sync.limitScope")}</li>
        <li>{t("settings.sync.limitLessons")}</li>
      </ul>
    </div>
  );
}
