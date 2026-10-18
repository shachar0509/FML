import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ensureDataRoot } from "@/lib/firstRun";
import { useSettings } from "@/stores/settings";
import { inTauri, Row, Select } from "./parts";

export function General() {
  const { t } = useTranslation();
  const { language, theme, dataRoot } = useSettings((s) => s.settings);
  const update = useSettings((s) => s.update);

  async function change() {
    if (!inTauri()) return;
    const dir = await (await import("@tauri-apps/plugin-dialog")).open({ directory: true });
    if (typeof dir !== "string") return;
    await ensureDataRoot(dir);
    update({ dataRoot: dir });
  }
  async function reveal() {
    if (inTauri()) await (await import("@tauri-apps/plugin-opener")).revealItemInDir(dataRoot);
  }

  return (
    <div>
      <Row label={t("settings.general.language")}>
        <div className="flex gap-2" role="group">
          {(["he", "en"] as const).map((l) => (
            <Button key={l} variant={language === l ? "default" : "outline"} onClick={() => update({ language: l })}>
              {l === "he" ? "עברית" : "English"}
            </Button>
          ))}
        </div>
      </Row>
      <Row label={t("settings.general.theme")}>
        <Select aria-label={t("settings.general.theme")} value={theme} onChange={(e) => update({ theme: e.target.value as typeof theme })}>
          {(["system", "light", "dark"] as const).map((k) => (
            <option key={k} value={k}>
              {t(`settings.general.${k}`)}
            </option>
          ))}
        </Select>
      </Row>
      <Row label={t("settings.general.dataFolder")} hint={<code dir="ltr" className="break-all">{dataRoot}</code>}>
        <Button variant="outline" onClick={() => void change()}>
          {t("settings.general.change")}
        </Button>
        <Button variant="outline" onClick={() => void reveal()}>
          {t("settings.general.open")}
        </Button>
      </Row>
    </div>
  );
}
