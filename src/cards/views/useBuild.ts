import { useEffect, useState } from "react";
import type { BuildStatus } from "../types";

/** Polls course_status while `number` is set; calls onEnd once when the build is done or failed. */
export function useBuild(
  number: string | null,
  callTool: (name: string, args?: Record<string, unknown>) => Promise<{ structuredContent?: unknown }>,
  onEnd: (s: BuildStatus) => void,
  everyMs = 2500,
) {
  const [s, setS] = useState<BuildStatus | null>(null);
  useEffect(() => {
    if (!number) return;
    let live = true;
    const tick = async () => {
      const r = (await callTool("course_status", { number }).catch(() => null))?.structuredContent as BuildStatus | undefined;
      if (!live || !r) return;
      setS(r);
      if (r.state === "done" || r.state === "failed") {
        clearInterval(id);
        onEnd(r);
      }
    };
    const id = setInterval(() => void tick(), everyMs);
    void tick();
    return () => {
      live = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [number]);
  return s;
}
