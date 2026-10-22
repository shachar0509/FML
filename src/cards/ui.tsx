/** Shared card building blocks (one visual language for every view). */
export const panel = "rounded-card border border-border bg-card shadow-card";
export const h2 = "text-base font-semibold";

export const Bar = ({
  pct,
  label,
  tone = "bg-primary",
  track = "bg-border",
}: {
  pct: number;
  label?: string;
  tone?: string;
  track?: string;
}) => (
  <div
    className={`h-2 w-full overflow-hidden rounded-full ${track}`}
    role="progressbar"
    aria-label={label ?? `${pct}%`}
    aria-valuenow={pct}
    aria-valuemin={0}
    aria-valuemax={100}
  >
    <div
      className={`h-full rounded-full ${tone} transition-[width] duration-500 motion-reduce:transition-none`}
      style={{ width: `${pct}%` }}
    />
  </div>
);

/** `hero`: drawn on a board header (board ink). */
export function Ring({ pct, hero }: { pct: number; hero?: boolean }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 48 48"
      className="size-14 shrink-0 -rotate-90"
      role="img"
      aria-label={`${pct}%`}
    >
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4.5" className={hero ? "stroke-(--board-muted)/30" : "stroke-border"} />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        strokeWidth="4.5"
        strokeLinecap="round"
        className={hero ? "stroke-(--board-ink)" : "stroke-primary"}
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
      <text
        x="24"
        y="24"
        textAnchor="middle"
        dominantBaseline="central"
        className={`origin-center rotate-90 text-[11px] font-semibold ${hero ? "fill-(--board-fg)" : "fill-fg"}`}
      >
        {pct}%
      </text>
    </svg>
  );
}

/** Placeholder bars while data loads; decorative (the caller owns any live/status semantics). */
export const Skeleton = ({ lines = 3 }: { lines?: number }) => (
  <div className="flex flex-col gap-3" aria-hidden>
    <div className="skeleton h-6 w-2/5" />
    {Array.from({ length: lines }, (_, i) => (
      <div key={i} className={`skeleton h-4 ${i % 2 ? "w-3/5" : "w-4/5"}`} />
    ))}
  </div>
);

/** Drawn on the board in marker / chalk: an ink box (a clue, feedback) and a choice box (options, modes). */
export const inkBox = "rounded-[10px_14px_9px_13px] border-2 border-(--board-ink)/60 px-4 py-3";
export const chalkChoice =
  "rounded-[10px_14px_9px_13px] border-2 border-(--board-fg)/30 text-(--board-fg) transition-colors enabled:hover:border-(--board-ink) has-checked:border-(--board-ink) has-checked:bg-(--board-ink)/10 focus-visible:outline-2 focus-visible:outline-primary has-focus-visible:outline-2 has-focus-visible:outline-primary";

/** A lesson-slide board (M56): handwritten title with an ink underline, the content written on it. */
export const Board = ({
  title,
  badge,
  children,
  label,
}: {
  title?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  label?: string;
}) => (
  <article
    aria-label={label}
    className="board-surface board mb-3 flex min-w-0 flex-col gap-4 overflow-x-auto px-6 py-6 sm:px-8"
  >
    {(title || badge) && (
      <div className="flex flex-wrap items-start justify-between gap-2">
        {title && (
          <h2 className="hand text-4xl leading-tight">
            {title}
            <span className="ink-underline" aria-hidden />
          </h2>
        )}
        {badge && (
          <span className="rounded-full bg-(--board-ink)/20 px-2.5 py-0.5 text-xs font-semibold text-(--board-fg) tabular-nums">
            {badge}
          </span>
        )}
      </div>
    )}
    {children}
  </article>
);
