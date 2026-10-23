import { useState } from "react";
import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import { panel } from "../ui";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

/** 1-5 stars like a review; arrows move the choice (one radio group). */
function Stars({ value, set }: { value: number; set: (n: number) => void }) {
  const { t } = useTranslation();
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="flex gap-1"
        role="radiogroup"
        aria-label={t("custom.level")}
        onMouseLeave={() => setHover(0)}
        onKeyDown={(e) => {
          const rtl = getComputedStyle(e.currentTarget).direction === "rtl" ? -1 : 1;
          const d = { ArrowRight: rtl, ArrowLeft: -rtl, ArrowUp: 1, ArrowDown: -1 }[e.key];
          if (!d) return;
          e.preventDefault();
          setHover(0); // the keys win over a resting pointer
          const n = Math.min(5, Math.max(1, value + d));
          set(n);
          (e.currentTarget.children[n - 1] as HTMLElement | undefined)?.focus();
        }}
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} · ${t(`custom.levels.${n}`)}`}
            title={t(`custom.levels.${n}`)}
            tabIndex={value === n || (!value && n === 1) ? 0 : -1}
            className="grid size-10 place-items-center rounded-lg text-muted transition-colors hover:text-warning focus-visible:outline-2 focus-visible:outline-primary"
            onMouseEnter={() => setHover(n)}
            onClick={() => set(n)}
          >
            <Star
              className={`size-7 transition-transform motion-reduce:transition-none ${n <= shown ? "fill-warning text-warning" : ""} ${hover === n ? "scale-110" : ""}`}
              aria-hidden
            />
          </button>
        ))}
      </div>
      <span className="text-xs text-muted" aria-live="polite">
        {shown ? t(`custom.levels.${shown}`) : t("custom.levelHint")}
      </span>
    </div>
  );
}

/** M52: a course on any subject; the AI plans it from these answers (no university). */
export function CustomCourse({
  callTool,
  open,
  back,
}: {
  callTool: Tool;
  open: (n: string) => void;
  back: () => void;
}) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: "", description: "", goal: "" });
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = f.name.trim() && f.description.trim() && level > 0;

  async function create() {
    setBusy(true);
    setError(null);
    const r = await callTool("course_custom_create", {
      name: f.name.trim(),
      description: f.description.trim(),
      goal: f.goal.trim() || undefined,
      level,
    });
    const n = (r.structuredContent as { number?: string } | undefined)?.number;
    if (r.isError || !n) {
      setBusy(false);
      return setError(t("api.failed"));
    }
    open(n);
  }

  const lbl = "flex flex-col gap-1.5 text-sm font-medium";
  // dir="auto" on an empty field is LTR, so its placeholder would run backwards in Hebrew: the page direction until something is typed
  const area =
    "rounded-lg border border-border bg-card p-3 text-sm font-normal focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <section className="flex flex-col gap-4" aria-label={t("custom.title")}>
      <h1 className="hand text-4xl">{t("custom.title")}</h1>
      <p className="text-sm text-muted">{t("custom.intro")}</p>
      <form
        className={`${panel} flex flex-col gap-4 p-4`}
        onSubmit={(e) => (e.preventDefault(), ok && void create())}
      >
        <label className={lbl}>
          {t("custom.name")}
          <Input
            autoFocus
            dir={f.name ? "auto" : undefined}
            placeholder={t("custom.namePh")}
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
          />
        </label>
        <label className={lbl}>
          {t("custom.description")}
          <textarea
            className={`${area} min-h-32`}
            dir={f.description ? "auto" : undefined}
            placeholder={t("custom.descriptionPh")}
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
          />
          <span className="text-xs font-normal text-muted">{t("custom.descriptionHint")}</span>
        </label>
        <label className={lbl}>
          <span>
            {t("custom.goal")} <span className="font-normal text-muted">({t("custom.optional")})</span>
          </span>
          <textarea
            className={`${area} min-h-20`}
            dir={f.goal ? "auto" : undefined}
            placeholder={t("custom.goalPh")}
            value={f.goal}
            onChange={(e) => setF({ ...f, goal: e.target.value })}
          />
        </label>
        <div className={lbl}>
          {t("custom.level")}
          <Stars value={level} set={setLevel} />
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={back}>
            {t("home.cancel")}
          </Button>
          <Button type="submit" disabled={!ok || busy}>
            {t("custom.create")}
          </Button>
        </div>
      </form>
    </section>
  );
}
