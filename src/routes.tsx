import { Navigate, Route, Routes, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Placeholder } from "@/screens/Placeholder";
import { CourseHome } from "@/screens/CourseHome";
import { HomeScreen } from "@/screens/Home";
import { Onboarding } from "@/screens/Onboarding";
import { SettingsScreen } from "@/screens/Settings";
import { useSettings } from "@/stores/settings";

function Page({ k }: { k: "practice" }) {
  const { t } = useTranslation();
  return <Placeholder title={t(`screens.${k}`)} />;
}
function Learn() {
  const { stageId } = useParams();
  const { t } = useTranslation();
  return <Placeholder title={t("screens.learn", { stageId })} />;
}

export function AppRoutes() {
  const done = useSettings((s) => s.settings.onboardingCompleted);
  // Until onboarding completes the app always opens the wizard (spec 15.1).
  if (!done)
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  return (
    <Routes>
      <Route path="/" element={<HomeScreen />} />
      <Route path="/course/:number" element={<CourseHome />} />
      <Route path="/course/:number/learn/:stageId" element={<Learn />} />
      <Route path="/course/:number/practice" element={<Page k="practice" />} />
      <Route path="/settings" element={<SettingsScreen />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
