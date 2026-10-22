import { useEffect, useState } from "react";
import { ArrowLeft, CornerDownLeft, GraduationCap, Pin, PinOff, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { applyLanguage, applyTheme } from "@/core/lib/dom";
import { AddCourse } from "./views/AddCourse";
import { Course } from "./views/Course";
import { CustomCourse } from "./views/CustomCourse";
import { Exercise } from "./views/Exercise";
import { FigureCard } from "./views/FigureCard";
import { Home } from "./views/Home";
import { Lesson } from "./views/Lesson";
import { Settings } from "./views/Settings";
import { Step } from "./views/Step";
import { SlideBrowser } from "./views/History";
import { Practice } from "./views/Practice";
import { Mcq, OpenQ } from "./views/Question";
import type { CardData, Host } from "./types";
import { Skeleton } from "./ui";
import { useShalav } from "./useShalav";

export function Cards({ host }: { host: Host }) {
  const { data, stale, ctx, callTool, go: ask, asked, clearAsked, displayMode } = useShalav(host);
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState(ctx.displayMode ?? "inline");
  const canPin = !!ctx.availableDisplayModes?.includes("pip");
  const pinned = mode === "pip";
  const togglePin = async () =>
    setMode(await displayMode(pinned ? "inline" : "pip").catch(() => mode));
  // Card-side navigation is a history on top of what the model last rendered (h[0]);
  // a new model result (data) starts a new history. Back pops it, or opens the screen above (course, home).
  const [nav, setNavState] = useState<{ on: CardData | null; h: CardData[] } | null>(null);
  const h = nav && nav.on === data ? nav.h : data ? [data] : [];
  const shown = h.at(-1) ?? null;
  const push = (v: CardData, replace = false) =>
    setNavState({ on: data, h: [...(replace ? h.slice(0, -1) : h), v] });
  const setNav = (v: CardData) => push(v);
  const language = data?.language ?? (ctx.locale?.startsWith("en") ? "en" : "he");
  // Host theme wins; the setting only applies when the host says nothing.
  const theme =
    ctx.theme === "light" || ctx.theme === "dark" ? ctx.theme : (data?.theme ?? "system");
  useEffect(() => applyLanguage(language), [language]);
  useEffect(() => applyTheme(theme), [theme]);
  // The host renders a card from its stored result (e.g. when the student comes back to the chat): show the live state.
  useEffect(() => {
    if (data?.view !== "home" && data?.view !== "course") return;
    void callTool(data.view === "home" ? "shalav_home" : "shalav_course", data.view === "course" ? { number: data.number } : undefined)
      .then((r) => {
        const v = r.structuredContent as CardData | undefined;
        // only while the student is still on that first screen
        if (v && "view" in v) setNavState((n) => (n && n.on === data && n.h.length > 1 ? n : { on: data, h: [v] }));
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);
  // The language was switched in Settings (card-side, at once): fetch Home or the course again for its texts in that language.
  useEffect(() => {
    const l = i18n.language;
    if (!shown || l === shown.language || (shown.view !== "home" && shown.view !== "course")) return;
    void callTool(shown.view === "home" ? "shalav_home" : "shalav_course", shown.view === "course" ? { number: shown.number } : undefined).then((r) => {
      const v = r.structuredContent as CardData | undefined;
      if (v && "view" in v) push(v, true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.language, shown?.view, shown?.language]);
  // "Press Enter" hint after a button put the short line in the chat box; gone after 90 s or when the model answers.
  useEffect(() => {
    if (!asked) return;
    const h = setTimeout(clearAsked, 90_000);
    return () => clearTimeout(h);
  }, [asked, clearAsked]);
  useEffect(() => clearAsked(), [data, clearAsked]);
  // A newer card took over: unpin this one so it does not float over the new card.
  useEffect(() => {
    if (stale && mode === "pip") void displayMode("inline").then(setMode, () => undefined);
  }, [stale, mode, displayMode]);

  if (stale)
    return (
      <p className="cards px-4 py-2 text-sm text-muted" role="status">
        {t("mcp.replaced")}
      </p>
    );

  // Leaving a screen voids the requests made on it (e.g. a lesson step), or the next "▶️ Continue" serves them.
  const leave = () => void callTool("shalav_request", { kind: "clear" }).catch(() => undefined);
  const show = async (name: string, args?: Record<string, unknown>, replace = false) => {
    const r = (await callTool(name, args)).structuredContent as CardData | undefined;
    if (r && "view" in r) push(r, replace);
  };
  const go = async (name: string, args?: Record<string, unknown>, replace = false) => {
    leave();
    await show(name, args, replace);
  };
  const home = () => void go("shalav_home");
  const open = (n: string, replace = false) => void go("shalav_course", { number: n }, replace);
  // The screen above the current one when there is no history: a course's parts → the course, the rest → home.
  const up =
    !shown || shown.view === "home"
      ? null
      : "number" in shown && shown.view !== "course"
        ? () => open(shown.number, true)
        : () => void go("shalav_home", undefined, true);
  const back = h.length > 1 ? () => (leave(), setNavState({ on: data, h: h.slice(0, -1) })) : up;

  const view = () => {
    if (!shown || !data)
      return (
        <div role="status">
          <span className="sr-only">{t("learn.loading")}</span>
          <Skeleton />
        </div>
      );
    if (shown.view === "add")
      return (
        <AddCourse example={shown.example} callTool={callTool} open={(n) => open(n, true)} back={back ?? home} />
      );
    if (shown.view === "custom")
      return <CustomCourse callTool={callTool} open={(n) => open(n, true)} back={back ?? home} />;
    if (shown.view === "course")
      return (
        <Course
          data={shown}
          callTool={callTool}
          go={ask}
          reload={() => void show("shalav_course", { number: shown.number }, true)}
        />
      );
    if (shown.view === "practice")
      return <Practice data={shown} callTool={callTool} go={ask} />;
    if (shown.view === "settings") return <Settings data={shown} callTool={callTool} />;
    if (shown.view === "lesson") return <Lesson data={shown} callTool={callTool} go={ask} />;
    if (shown.view === "mcq") return <Mcq data={shown} callTool={callTool} go={ask} />;
    if (shown.view === "exercise") return <Exercise data={shown} callTool={callTool} go={ask} />;
    if (shown.view === "open") return <OpenQ data={shown} go={ask} callTool={callTool} />;
    if (shown.view === "figure") return <FigureCard data={shown} />;
    if (shown.view === "step") return <Step data={shown} go={ask} callTool={callTool} />;
    return (
      <Home
        data={shown}
        add={(example) =>
          setNav({ view: "add", language: data.language, theme: data.theme, example })
        }
        custom={() => setNav({ view: "custom", language: data.language, theme: data.theme })}
        open={open}
        callTool={callTool}
        go={ask}
        practice={(n) => void go("shalav_practice", { courseNumber: n })}
        settings={() => void go("shalav_settings")}
        choose={(id) => void go("shalav_choose_university", { university: id })}
      />
    );
  };
  // Inline cards scroll away with the chat; hosts that support it can float the card (pip) so it stays visible.
  return (
    <div className="cards mx-auto flex max-w-3xl flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-bg px-4 pt-3 pb-2">
        {back && (
          <button
            className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-border/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={t("mcp.prev")}
            title={t("mcp.prev")}
            onClick={back}
          >
            <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden />
          </button>
        )}
        <span
          className="grid size-6 place-items-center rounded-md bg-primary text-primary-fg"
          aria-hidden
        >
          <GraduationCap className="size-4" />
        </span>
        <span className="grow text-sm font-semibold tracking-tight text-muted">
          {language === "he" ? "שלב" : "Shalav"}
        </span>
        {canPin && (
          <button
            className="grid size-8 place-items-center rounded-full text-muted transition-colors hover:bg-border/60 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={t(pinned ? "mcp.unpin" : "mcp.pin")}
            title={t(pinned ? "mcp.unpin" : "mcp.pin")}
            aria-pressed={pinned}
            onClick={() => void togglePin()}
          >
            {pinned ? (
              <PinOff className="size-4" aria-hidden />
            ) : (
              <Pin className="size-4" aria-hidden />
            )}
          </button>
        )}
      </header>
      <main className="flex grow flex-col px-4 pb-4">
        {shown && "history" in shown && shown.history ? (
          <SlideBrowser history={shown.history} callTool={callTool} slide={(s) => <Step data={s} go={ask} callTool={callTool} readOnly />}>
            {view()}
          </SlideBrowser>
        ) : (
          view()
        )}
      </main>
      {!!asked && (
        <div
          aria-live="polite"
          className="sticky bottom-0 mx-4 mb-3 flex items-center gap-3 rounded-card border border-primary/40 bg-[color-mix(in_oklab,var(--primary)_10%,var(--card))] px-4 py-2.5 text-sm shadow-lg"
        >
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full bg-primary text-primary-fg"
            aria-hidden
          >
            <CornerDownLeft className="size-4" />
          </span>
          <span className="grow font-medium">{t("mcp.pressEnter")}</span>
          <button
            className="grid size-7 place-items-center rounded-full text-muted hover:bg-border/60 hover:text-fg focus-visible:outline-2 focus-visible:outline-primary"
            aria-label={t("mcp.dismiss")}
            onClick={clearAsked}
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
