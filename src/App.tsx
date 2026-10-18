import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ChevronRight, Cloud, MessageCircleQuestion, Settings as Gear } from "lucide-react";
import { useTranslation } from "react-i18next";
import { APP_NAME } from "@/constants";
import { applyLanguage, applyTheme } from "@/lib/dom";
import { useSettings } from "@/stores/settings";
import { AppRoutes } from "@/routes";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/toaster";

function Breadcrumbs() {
  const { t } = useTranslation();
  const [, a, b, c, d] = useLocation().pathname.split("/");
  const crumbs: [string, string][] = [];
  if (a === "course" && b) {
    crumbs.push([`/course/${b}`, t("nav.course", { number: b })]);
    if (c === "learn") crumbs.push([`/course/${b}/learn/${d}`, t("nav.learn")]);
    if (c === "practice") crumbs.push([`/course/${b}/practice`, t("nav.practice")]);
  }
  if (!crumbs.length) return null;
  return (
    <nav className="flex items-center gap-1 text-sm text-muted">
      {crumbs.map(([to, label]) => (
        <span key={to} className="flex items-center gap-1">
          <ChevronRight className="size-4 rtl:rotate-180" />
          <Link to={to}>{label}</Link>
        </span>
      ))}
    </nav>
  );
}

export function App() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { language, theme, onboardingCompleted } = useSettings((s) => s.settings);
  const [askOpen, setAskOpen] = useState(false);

  useEffect(() => applyLanguage(language), [language]);
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => applyTheme("system");
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [theme]);

  useEffect(() => {
    if (!onboardingCompleted) return;
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === ",") {
        e.preventDefault();
        void navigate("/settings");
      }
      if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAskOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [navigate, onboardingCompleted]);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 items-center gap-3 border-b border-border bg-card px-4">
        <Link to="/" className="font-semibold text-primary">
          {APP_NAME}
        </Link>
        <Breadcrumbs />
        <div className="ms-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label={t("nav.sync")}>
            <Cloud className="size-[14px]" />
          </Button>
          <Button variant="ghost" size="icon" aria-label={t("nav.settings")} asChild>
            <Link to="/settings">
              <Gear className="size-4" />
            </Link>
          </Button>
        </div>
      </header>
      <main className="flex-1">
        <AppRoutes />
      </main>
      {onboardingCompleted && (
        <>
          <button
            aria-label={t("nav.ask")}
            onClick={() => setAskOpen((o) => !o)}
            className="fixed end-0 top-1/2 flex items-center gap-1 rounded-s-lg bg-primary p-2 text-primary-fg"
          >
            <MessageCircleQuestion className="size-5" />
          </button>
          {askOpen && (
            <aside className="fixed inset-y-12 end-10 w-80 rounded-card border border-border bg-card p-4">
              <h2 className="font-semibold">{t("ask.title")}</h2>
              <p className="text-muted">{t("ask.placeholder")}</p>
            </aside>
          )}
        </>
      )}
      <Toaster />
    </div>
  );
}
