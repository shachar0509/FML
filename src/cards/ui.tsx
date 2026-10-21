/** Shared card building blocks (one visual language for every view). */
export const panel = "rounded-card border border-border bg-card shadow-card";
export const h2 = "text-base font-semibold";
export const backLink =
  "self-start rounded text-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary";

export const Bar = ({
  pct,
  label,
  tone = "bg-primary",
}: {
  pct: number;
  label?: string;
  tone?: string;
}) => (
  <div
    className="h-2 w-full overflow-hidden rounded-full bg-border"
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

export function Ring({ pct }: { pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 48 48"
      className="size-14 shrink-0 -rotate-90"
      role="img"
      aria-label={`${pct}%`}
    >
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="4.5" className="stroke-border" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        strokeWidth="4.5"
        strokeLinecap="round"
        className="stroke-primary"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct / 100)}
      />
      <text
        x="24"
        y="24"
        textAnchor="middle"
        dominantBaseline="central"
        className="origin-center rotate-90 fill-fg text-[11px] font-semibold"
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
