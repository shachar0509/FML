import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square } from "lucide-react";
import { BEAT_MARK } from "./beats";
import { showBeat } from "./Svg";
import { boxClass, useDraw } from "./useDraw";

/** M81: the beat of each source line: a music line ending with `% @n` (or `% @n-m`) is drawn from beat n; header fields and comments are not music lines. */
export function abcBeats(source: string) {
  const lines = source.replace(/\r/g, "").split("\n");
  const music: ([string, string?] | null)[] = []; // per music line, in order (abcjs numbers them abcjs-l0, l1…)
  const byLine: number[] = []; // per source line: its beat, for the notes the Play button plays
  for (const line of lines) {
    const m = BEAT_MARK.exec(line);
    const isMusic = line.trim() && !/^\s*(%|[A-Za-z]:)/.test(line);
    byLine.push(m ? Number(m[1]) : 0);
    if (isMusic) music.push(m ? [m[1] ?? "0", m[2]] : null);
  }
  return { music, byLine, starts: lines.map((_, i) => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0)) };
}

type Note = { pitch: number; start: number; duration: number; startChar: number };

/** Plays the notes on the board with a plain WebAudio tone (abcjs's synth fetches its sound font from a CDN, which the card can't use). */
function play(notes: Note[], tempo: number, onEnd: () => void) {
  const ctx = new AudioContext();
  const whole = (4 * 60) / (tempo || 100);
  const t0 = ctx.currentTime + 0.05;
  for (const n of notes) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    o.frequency.value = 440 * 2 ** ((n.pitch - 69) / 12);
    const [a, b] = [t0 + n.start * whole, t0 + (n.start + n.duration) * whole];
    g.gain.setValueAtTime(0, a);
    g.gain.linearRampToValueAtTime(0.22, a + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, Math.max(a + 0.05, b));
    o.connect(g).connect(ctx.destination);
    o.start(a);
    o.stop(b + 0.05);
  }
  const end = Math.max(0, ...notes.map((n) => n.start + n.duration)) * whole;
  const timer = setTimeout(() => {
    void ctx.close();
    onEnd();
  }, (end + 0.3) * 1000);
  return () => {
    clearTimeout(timer);
    void ctx.close();
  };
}

export function Abc({ source, dark, beat }: { source: string; dark: boolean; beat?: number }) {
  const { t } = useTranslation();
  const at = useRef(beat);
  const audio = useRef<{ notes: Note[]; tempo: number; byLine: number[]; starts: number[] }>(null);
  const stop = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const ref = useDraw(
    async (el) => {
      const abcjs = await import("abcjs");
      const marked = abcBeats(source);
      const box = el.appendChild(document.createElement("div"));
      const [tune] = abcjs.renderAbc(box, source, { responsive: "resize", add_classes: true, foregroundColor: "currentColor", paddingtop: 0, paddingbottom: 0 });
      if (!tune) throw new Error("no tune");
      marked.music.forEach((b, k) => {
        if (!b) return;
        for (const e of box.querySelectorAll(`.abcjs-l${k}`)) {
          e.setAttribute("data-beat", b[0]);
          if (b[1]) e.setAttribute("data-until", b[1]);
        }
      });
      const a = tune.setUpAudio({}) as unknown as { tempo: number; tracks: ({ cmd: string } & Note)[][] };
      audio.current = { notes: a.tracks.flat().filter((n) => n.cmd === "note"), tempo: a.tempo, ...marked };
      showBeat(el, at.current);
    },
    [source, dark],
  );
  useEffect(() => {
    at.current = beat;
    if (ref.current) showBeat(ref.current, beat);
  }, [ref, beat]);
  useEffect(() => () => stop.current?.(), []);
  const toggle = () => {
    if (stop.current) {
      stop.current();
      stop.current = null;
      setPlaying(false);
      return;
    }
    const a = audio.current;
    if (!a) return;
    // only the music already on the board
    const line = (c: number) => a.starts.findLastIndex((s) => s <= c);
    const notes = a.notes.filter((n) => at.current === undefined || (a.byLine[line(n.startChar)] ?? 0) <= at.current);
    stop.current = play(notes, a.tempo, () => {
      stop.current = null;
      setPlaying(false);
    });
    setPlaying(true);
  };
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div ref={ref} className={`${boxClass} fig-svg fig-abc w-full`} dir="ltr" />
      <button type="button" onClick={toggle} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-sm hover:bg-card">
        {playing ? <Square className="size-3.5" aria-hidden /> : <Play className="size-4" aria-hidden />}
        {t(playing ? "render.stop" : "render.play")}
      </button>
    </div>
  );
}
