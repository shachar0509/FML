import "@fontsource/heebo/400.css";
import "@fontsource/heebo/500.css";
import "@fontsource/heebo/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "./index.css";
import "./i18n";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { App } from "./App";
import { connectFromKeyring } from "./claude/connect";
import { firstRun } from "./lib/firstRun";
import { startSyncIfConnected } from "./sync/runtime";
import { useSettings } from "./stores/settings";

void useSettings
  .getState()
  .load()
  .then(() => firstRun().catch((e) => console.error("first run failed", e)))
  .then(() => (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window ? connectFromKeyring().catch(() => undefined) : undefined))
  .then(() => {
    createRoot(document.getElementById("root") as HTMLElement).render(
      <StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </StrictMode>,
    );
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void startSyncIfConnected().catch((e) => console.error("sync start failed", e));
      void Promise.all([import("./domain/courses/courses"), import("./domain/ingest/runtime")]).then(async ([c, r]) =>
        r.resumeAll((await c.listCourses()).map((x) => x.course.courseNumber)),
      ).catch((e) => console.error("ingest resume failed", e));
    }
  });
