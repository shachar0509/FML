import { useCallback, useEffect, useState } from "react";
import { applyLanguage, applyTheme } from "@/lib/dom";
import { AddCourse } from "./views/AddCourse";
import { Course } from "./views/Course";
import { Exercise } from "./views/Exercise";
import { Home } from "./views/Home";
import { Lesson } from "./views/Lesson";
import { Settings } from "./views/Settings";
import { Practice } from "./views/Practice";
import { Mcq, OpenQ } from "./views/Question";
import type { CardData, Host } from "./types";
import { useShalav } from "./useShalav";

export function Cards({ host }: { host: Host }) {
  const { data, ctx, callTool, say } = useShalav(host);
  // Card-side navigation (open a course, add a course) sits on top of what the model last rendered.
  // A new model result (data) replaces the card-side view.
  const [navState, setNavState] = useState<{ on: CardData | null; v: CardData } | null>(null);
  const setNav = (v: CardData) => setNavState({ on: data, v });
  const shown = navState && navState.on === data ? navState.v : data;
  const language = data?.language ?? (ctx.locale?.startsWith("en") ? "en" : "he");
  // Host theme wins; the setting only applies when the host says nothing.
  const theme = ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : (data?.theme ?? "system");
  useEffect(() => applyLanguage(language), [language]);
  useEffect(() => applyTheme(theme), [theme]);

  const go = useCallback(async (name: string, args?: Record<string, unknown>) => {
    const r = (await callTool(name, args)).structuredContent as CardData | undefined;
    if (r && "view" in r) setNavState({ on: data, v: r });
  }, [callTool, data]);
  const home = () => void go("shalav_home");
  const open = (n: string) => void go("shalav_course", { number: n });

  if (!shown || !data) return <p className="p-4 text-muted" role="status">…</p>;
  if (shown.view === "add") return <AddCourse callTool={callTool} say={say} open={open} back={home} />;
  if (shown.view === "course") return <Course data={shown} callTool={callTool} say={say} reload={() => open(shown.number)} back={home} practice={() => void go("shalav_practice", { courseNumber: shown.number })} />;
  if (shown.view === "practice") return <Practice data={shown} callTool={callTool} say={say} back={() => open(shown.number)} />;
  if (shown.view === "settings") return <Settings data={shown} callTool={callTool} back={home} />;
  if (shown.view === "lesson") return <Lesson data={shown} callTool={callTool} say={say} />;
  if (shown.view === "mcq") return <Mcq data={shown} callTool={callTool} say={say} />;
  if (shown.view === "exercise") return <Exercise data={shown} callTool={callTool} say={say} />;
  if (shown.view === "open") return <OpenQ data={shown} say={say} />;
  return <Home data={shown} add={() => setNav({ view: "add", language: data.language, theme: data.theme })} open={open} settings={() => void go("shalav_settings")} />;
}
