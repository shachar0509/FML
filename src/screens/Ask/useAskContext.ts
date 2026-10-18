import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { create } from "zustand";
import type { AskContext } from "@/domain/ask/ask";
import { loadCtx } from "@/domain/practice/exercises";

/** Statement of the exercise currently on screen ("" = none); published by ExerciseCard. */
export const useOpenExercise = create<{ statement: string }>(() => ({ statement: "" }));

/** AskContext from the route (12.9): stageId only in Learn. */
export function useAskContext(): AskContext {
  const [, a, n = null, c, stageId = null] = useLocation().pathname.split("/");
  const statement = useOpenExercise((s) => s.statement);
  const course = a === "course" ? n : null;
  const learnId = course && c === "learn" ? stageId : null;
  const [loaded, setLoaded] = useState<{ key: string; title: string }>({ key: "", title: "" });
  const key = `${course}/${learnId}`;
  const title = loaded.key === key ? loaded.title : "";
  useEffect(() => {
    if (!course || !learnId) return;
    let live = true;
    void loadCtx(course)
      .then((x) => live && setLoaded({ key, title: x.plan.stages.find((s) => s.id === learnId)?.title ?? "" }))
      .catch(() => undefined);
    return () => void (live = false);
  }, [course, learnId, key]);

  const screen = learnId
    ? `Learning ${learnId}${title ? ` — ${title}` : ""}`
    : course && c === "practice"
      ? "Practicing (completed stages only)"
      : course
        ? "Course home"
        : a === "settings"
          ? "Settings"
          : "Home";
  return { courseNumber: course, screen, stageId: learnId, openExercise: statement };
}
