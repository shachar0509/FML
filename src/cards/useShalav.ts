import { useCallback, useEffect, useState } from "react";
import i18n from "i18next";
import type { CardData, Go, Host } from "./types";

export function useShalav(host: Host) {
  const [data, setData] = useState<CardData | null>(null);
  // the number of the result this card was created with (0: a result without one)
  const [first, setFirst] = useState<number | undefined>(undefined);
  const [, bump] = useState(0);
  useEffect(
    () =>
      host.subscribe(
        (d) => {
          if (typeof d !== "object" || d === null || !("view" in d)) return;
          setData(d as CardData);
          setFirst((f) => f ?? (d as { card?: number }).card ?? 0);
        },
        () => bump((n) => n + 1),
      ),
    [host],
  );
  // One card on screen (M23): this card claims the number of the result it was created with (M31: mounting the same card
  // again keeps its number), then folds away once a newer card exists.
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (first === undefined) return;
    let mine = 0;
    const latest = async (claim: boolean) =>
      ((await host.callTool("shalav_card", claim && first ? { claim, card: first } : { claim })).structuredContent as { latest?: number } | undefined)?.latest ?? 0;
    // ponytail: polling every 2 s (only the newest card keeps polling); a host push would replace it if hosts add one
    const h = setInterval(() => {
      if (!mine || document.visibilityState !== "visible") return;
      void latest(false)
        .then((n) => n > mine && (setStale(true), clearInterval(h)))
        .catch(() => undefined);
    }, 2000);
    latest(true).then((n) => void (mine = first || n), () => clearInterval(h));
    return () => clearInterval(h);
  }, [host, first]);
  const [asked, setAsked] = useState(0);
  // The real request goes to the server; the chat only gets one short word the student sends with Enter (M15).
  const go: Go = useCallback(
    async (req) => {
      if (req) await host.callTool("shalav_request", req);
      await host.say(i18n.t("mcp.go"));
      setAsked(Date.now());
    },
    [host],
  );
  return { data, stale, ctx: host.context(), callTool: host.callTool, go, asked, clearAsked: useCallback(() => setAsked(0), []), displayMode: host.displayMode };
}
