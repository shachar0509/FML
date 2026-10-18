import { useTranslation } from "react-i18next";

export function Placeholder({ title }: { title: string }) {
  const { t } = useTranslation();
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="text-muted">{t("screens.comingSoon")}</p>
    </div>
  );
}
