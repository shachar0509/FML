import { useCallback, useEffect, useState } from "react";
import i18n from "i18next";
import type { CardData, Go, Host } from "./types";

export function useShalav(host: Host) {
  const [data, setData] = useState<CardData | null>(null);
  const [, bump] = useState(0);
  useEffect(
    () =>
      host.subscribe(
        (d) => typeof d === "object" && d !== null && "view" in d && setData(d as CardData),
        () => bump((n) => n + 1),
      ),
    [host],
  );
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
  return { data, ctx: host.context(), callTool: host.callTool, go, asked, clearAsked: useCallback(() => setAsked(0), []), displayMode: host.displayMode };
}
