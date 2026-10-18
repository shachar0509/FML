import { useEffect, useRef, useState } from "react";

/** Runs `draw` into a div; failures are rethrown into React for the error boundary. */
export function useDraw(
  draw: (el: HTMLDivElement) => unknown,
  deps: unknown[],
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  const [, setState] = useState();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let live = true;
    let free: (() => void) | undefined;
    Promise.resolve()
      .then(() => draw(el))
      .then((f) => {
        free = typeof f === "function" ? (f as () => void) : undefined;
        if (!live) free?.();
      })
      .catch((e: unknown) => {
        if (live)
          setState(() => {
            throw e;
          });
      });
    return () => {
      live = false;
      free?.();
      el.replaceChildren();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export const boxClass = "mx-auto max-w-full overflow-x-auto flex justify-center";
