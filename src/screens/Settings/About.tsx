import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { useSettings } from "@/stores/settings";
import { inTauri, Row, Toggle } from "./parts";

const REPO_URL = "https://github.com/<owner>/<repo>";

export function About() {
  const { t } = useTranslation();
  const autoCheck = useSettings((s) => s.settings.updates.autoCheck);
  const update = useSettings((s) => s.update);
  const [version, setVersion] = useState("dev");

  useEffect(() => {
    if (!inTauri()) return;
    void import("@tauri-apps/api/app").then((m) => m.getVersion()).then(setVersion, () => undefined);
  }, []);

  async function checkUpdates() {
    if (!inTauri()) return toast({ message: t("settings.about.unavailable") });
    try {
      const up = await (await import("@tauri-apps/plugin-updater")).check();
      if (!up) return toast({ message: t("settings.about.upToDate") });
      toast({
        message: t("settings.about.available", { v: up.version }),
        action: {
          label: t("settings.about.install"),
          onClick: () => void up.downloadAndInstall().then(async () => (await import("@tauri-apps/plugin-process")).relaunch()),
        },
      });
    } catch {
      toast({ kind: "error", message: t("api.failed") });
    }
  }
  async function openRepo() {
    if (inTauri()) await (await import("@tauri-apps/plugin-opener")).openUrl(REPO_URL);
    else window.open(REPO_URL, "_blank");
  }
  async function openLogs() {
    if (!inTauri()) return;
    const dir = await (await import("@tauri-apps/api/path")).appLogDir();
    await (await import("@tauri-apps/plugin-opener")).openPath(dir);
  }

  return (
    <div>
      <p className="mb-2 text-lg font-semibold" dir="ltr">
        Shalav · {t("settings.about.version", { v: version })}
      </p>
      <Row label={t("settings.about.check")}>
        <Button variant="outline" onClick={() => void checkUpdates()}>
          {t("settings.about.check")}
        </Button>
      </Row>
      <Row label={t("settings.about.autoCheck")}>
        <Toggle label={t("settings.about.autoCheck")} checked={autoCheck} onChange={(v) => update({ updates: { autoCheck: v } })} />
      </Row>
      <Row label={t("settings.about.github")}>
        <Button variant="outline" onClick={() => void openRepo()}>
          {t("settings.about.github")}
        </Button>
      </Row>
      <Row label={t("settings.about.logs")}>
        <Button variant="outline" onClick={() => void openLogs()}>
          {t("settings.about.logs")}
        </Button>
      </Row>
    </div>
  );
}
