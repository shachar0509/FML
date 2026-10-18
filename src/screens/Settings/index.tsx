import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const TABS = ["general", "claude", "learning", "sync", "usage", "about"] as const;

export function SettingsScreen() {
  const { t } = useTranslation();
  return (
    <div className="p-6">
      <h1 className="mb-4 text-xl font-semibold">{t("screens.settings")}</h1>
      <Tabs defaultValue="general">
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`settings.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((k) => (
          <TabsContent key={k} value={k} className="py-4 text-muted">
            {t("screens.comingSoon")}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
