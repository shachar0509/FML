import { useEffect, useState } from "react";
import type { CardData, Host } from "./types";

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
  return { data, ctx: host.context(), callTool: host.callTool, say: host.say, displayMode: host.displayMode };
}
