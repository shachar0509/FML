import { useEffect, useRef } from "react";
import * as z from "zod";
import { showBeat } from "./Svg";
import { boxClass, useDraw } from "./useDraw";

/** M81: guitar (or ukulele…) chord charts with svguitar, drawn in the card; a chord is one diagram, shown from its beat. */
const chordsSchema = z.object({
  strings: z.number().int().min(4).max(7).default(6),
  frets: z.number().int().min(3).max(7).default(4),
  chords: z
    .array(
      z.object({
        title: z.string().max(20).default(""),
        fingers: z.array(z.tuple([z.number().int().min(1), z.union([z.number().int().min(0), z.literal("x")])]).rest(z.string().max(3))).default([]),
        barres: z.array(z.object({ fromString: z.number().int(), toString: z.number().int(), fret: z.number().int().min(1), text: z.string().max(3).optional() })).default([]),
        position: z.number().int().min(1).optional(),
        color: z.enum(["m-blue", "m-green", "m-pink", "m-orange"]).optional(),
        beat: z.number().int().min(0).optional(),
        until: z.number().int().min(1).optional(),
      }),
    )
    .min(1)
    .max(12),
});
export const parseChords = (src: string) => chordsSchema.parse(JSON.parse(src));

const PAPER = "#abcdef"; // finger dots: outlined in ink on the card's paper (set after drawing), so the number reads in both themes

export function Chords({ source, dark, beat }: { source: string; dark: boolean; beat?: number }) {
  const at = useRef(beat);
  const ref = useDraw(
    async (el) => {
      const { SVGuitarChord } = await import("svguitar");
      const spec = parseChords(source);
      for (const c of spec.chords) {
        const box = el.appendChild(document.createElement("div"));
        box.className = `fig-chord ${c.color ?? ""}`;
        new SVGuitarChord(box)
          .configure({ strings: spec.strings, frets: spec.frets, color: "currentColor", backgroundColor: "none", fingerColor: PAPER, fingerStrokeColor: "currentColor", fingerStrokeWidth: 1.5, fingerTextColor: "currentColor", fontFamily: "inherit", position: c.position, noPosition: !c.position })
          .chord({ title: c.title, fingers: c.fingers as never, barres: c.barres })
          .draw();
        for (const t of box.querySelectorAll(`[fill="${PAPER}" i]`)) (t as SVGElement).style.fill = "var(--card)";
        // the beat goes on the chart's own parts (the chart keeps its room while hidden)
        if (c.beat || c.until)
          for (const e of box.querySelectorAll("svg > *")) {
            e.setAttribute("data-beat", String(c.beat ?? 0));
            if (c.until) e.setAttribute("data-until", String(c.until));
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
