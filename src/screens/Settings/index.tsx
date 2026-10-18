import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { About } from "./About";
import { Claude } from "./Claude";
import { General } from "./General";
import { Learning } from "./Learning";
import { Sync } from "./Sync";
import { Usage } from "./Usage";

const TABS = ["general", "claude", "learning", "sync", "usage", "about"] as const;
const BODY = {
  general: <General />,
  claude: <Claude />,
  learning: <Learning />,
  sync: <Sync />,
  usage: <Usage />,
  about: <About />,
};

export function SettingsScreen() {
  const { t } = useTranslation();
  const tab = useSearchParams()[0].get("tab");
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-4 text-xl font-semibold">{t("screens.settings")}</h1>
      <Tabs defaultValue={TABS.find((k) => k === tab) ?? "general"}>
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {t(`settings.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        {TABS.map((k) => (
          <TabsContent key={k} value={k} className="py-4">
            {BODY[k]}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
