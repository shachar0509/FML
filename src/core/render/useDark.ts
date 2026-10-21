import { useSyncExternalStore } from "react";

const root = () => document.documentElement;
const sub = (cb: () => void) => {
  const o = new MutationObserver(cb);
  o.observe(root(), { attributes: true, attributeFilter: ["class"] });
  return () => o.disconnect();
};

/** True while the `dark` class is on <html> (see applyTheme). */
export const useDark = () => useSyncExternalStore(sub, () => root().classList.contains("dark"));
