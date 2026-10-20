import { useEffect } from "react";
import { applyLanguage, applyTheme } from "@/lib/dom";
import { Home } from "./views/Home";
import type { Host } from "./types";
import { useShalav } from "./useShalav";

export function Cards({ host }: { host: Host }) {
  const { data, ctx, say } = useShalav(host);
  const language = data?.language ?? (ctx.locale?.startsWith("en") ? "en" : "he");
  // Host theme wins; the setting only applies when the host says nothing.
  const theme = ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : (data?.theme ?? "system");
  useEffect(() => applyLanguage(language), [language]);
  useEffect(() => applyTheme(theme), [theme]);
  if (!data) return <p className="p-4 text-muted" role="status">…</p>;
  return <Home data={data} say={say} />;
}
