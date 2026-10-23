import { boxClass, useDraw } from "./useDraw";

let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

export function Mermaid({ source, dark }: { source: string; dark: boolean; beat?: number }) {
  const ref = useDraw(
    async (el) => {
      const { default: mermaid } = await import("mermaid");
      // mermaid.initialize is global and render is not reentrant: serialise.
      const job = queue.then(async () => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          flowchart: { htmlLabels: false },
          theme: dark ? "dark" : "default",
        });
        return mermaid.render(`mermaid-${++seq}`, source);
      });
      queue = job.catch(() => undefined);
      const { svg } = await job;
      el.innerHTML = svg;
      const s = el.querySelector("svg");
      if (s) s.style.maxWidth = "100%";
    },
    [source, dark],
  );
  return <div ref={ref} className={boxClass} />;
}
