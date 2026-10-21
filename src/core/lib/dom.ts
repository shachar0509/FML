import i18n from "@/core/i18n";
import type { Settings } from "@/core/domain/schemas";

export const dirFor = (lang: Settings["language"]) => (lang === "he" ? "rtl" : "ltr");

export function applyLanguage(lang: Settings["language"]) {
  const el = document.documentElement;
  el.lang = lang;
  el.dir = dirFor(lang);
  void i18n.changeLanguage(lang);
}

export function applyTheme(theme: Settings["theme"]) {
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
