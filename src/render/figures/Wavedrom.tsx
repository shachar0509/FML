import { boxClass, useDraw } from "./useDraw";

let seq = 0;

export function Wavedrom({ source, dark }: { source: string; dark: boolean }) {
  const ref = useDraw(
    async (el) => {
      const [{ default: wd }, { default: skin }] = await Promise.all([
        import("wavedrom"),
        dark ? import("wavedrom/skins/dark.js") : import("wavedrom/skins/default.js"),
      ]);
      const tree = wd.renderAny(`wd${++seq}`, JSON.parse(source), skin);
      el.innerHTML = wd.onml.stringify(tree);
      const s = el.querySelector("svg");
      if (s) {
        s.style.maxWidth = "100%";
        s.style.height = "auto";
      }
    },
    [source, dark],
  );
  return <div ref={ref} className={boxClass} />;
}
