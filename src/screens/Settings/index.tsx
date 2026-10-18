import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { About } from "./About";
import { Claude } from "./Claude";
import { General } from "./General";
import { Learning } from "./Learning";
import { Usage } from "./Usage";

const TABS = ["general", "claude", "learning", "sync", "usage", "about"] as const;
const BODY = {
  general: <General />,
  claude: <Claude />,
  learning: <Learning />,
  usage: <Usage />,
  about: <About />,
};

export function SettingsScreen() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">{t("screens.settings")}</h1>
      <Tabs defaultValue="general">
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`settings.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((k) => (
          <TabsContent key={k} value={k} className="py-4">
            {k === "sync" ? <p className="text-muted">{t("settings.sync.soon")}</p> : BODY[k]}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
