import { useEffect, useRef } from "react";
import * as z from "zod";
import { showBeat } from "./Svg";
import { boxClass, useDraw } from "./useDraw";

/** M82: molecules from SMILES with SmilesDrawer (MIT), drawn in the card (it needs a DOM); a molecule is shown from its beat. */
const smilesSchema = z.object({
  molecules: z
    .array(z.object({ smiles: z.string().min(1).max(400), label: z.string().max(40).optional(), beat: z.number().int().min(0).optional(), until: z.number().int().min(1).optional() }))
    .min(1)
    .max(8),
});
/** A plain SMILES string is one molecule. */
export const parseSmiles = (src: string) => smilesSchema.parse(src.trim().startsWith("{") ? JSON.parse(src) : { molecules: [{ smiles: src.trim() }] });

export function Smiles({ source, dark, beat }: { source: string; dark: boolean; beat?: number }) {
  const at = useRef(beat);
  const ref = useDraw(
    async (el) => {
      const { default: SmilesDrawer } = await import("smiles-drawer");
      const spec = parseSmiles(source);
      const drawer = new SmilesDrawer.SvgDrawer({ width: 320, height: 240, bondThickness: 1.4, fontSizeLarge: 11, fontSizeSmall: 8, padding: 12, compactDrawing: false });
      for (const m of spec.molecules) {
        const box = el.appendChild(document.createElement("figure"));
        box.className = "fig-molecule";
        const svg = box.appendChild(document.createElementNS("http://www.w3.org/2000/svg", "svg"));
        await new Promise<void>((ok, bad) =>
          SmilesDrawer.parse(
            m.smiles,
            (tree) => {
              drawer.draw(tree, svg, dark ? "dark" : "light");
              ok();
            },
            (e) => bad(new Error(`SMILES "${m.smiles}": ${e instanceof Error ? e.message : String(e)}`)),
          ),
        );
        if (m.label) box.appendChild(Object.assign(document.createElement("figcaption"), { textContent: m.label }));
        // the beat on the drawing's own parts (and the caption): the molecule keeps its room while hidden
        if (m.beat || m.until)
          for (const e of box.querySelectorAll("svg > *, figcaption")) {
            e.setAttribute("data-beat", String(m.beat ?? 0));
            if (m.until) e.setAttribute("data-until", String(m.until));
          }
      }
      showBeat(el, at.current);
    },
    [source, dark],
  );
  useEffect(() => {
    at.current = beat;
    if (ref.current) showBeat(ref.current, beat);
  }, [ref, beat]);
  return <div ref={ref} className={`${boxClass} fig-svg fig-chords flex-wrap gap-4`} dir="ltr" />;
}
