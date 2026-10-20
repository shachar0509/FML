import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { HomeData } from "../types";

function Ring({ pct }: { pct: number }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 48 48" className="size-12 shrink-0 -rotate-90" role="img" aria-label={`${pct}%`}>
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-border" />
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" strokeLinecap="round" className="stroke-primary" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      <text x="24" y="24" textAnchor="middle" dominantBaseline="central" className="rotate-90 origin-center fill-fg text-[11px]">{pct}%</text>
    </svg>
  );
}

export function Home({ data, say }: { data: HomeData; say: (t: string) => Promise<void> }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-4 p-4" aria-label={t("screens.home")}>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t("screens.home")}</h1>
        <Button onClick={() => void say(t("mcp.addCourse"))}>
          <Plus className="size-4" aria-hidden /> {t("home.add")}
        </Button>
      </div>
      {data.courses.length === 0 && <p className="text-muted">{t("home.empty")}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {data.courses.map((c) => (
          <li key={c.number} className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
            <div className="flex items-start gap-3">
              <Ring pct={c.pct} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{c.name}</p>
                <p className="text-sm text-muted">
                  <span dir="ltr">{c.number}</span> · {t("home.credits", { count: c.credits })}
                </p>
              </div>
            </div>
            {c.stage && <p className="truncate text-sm">{c.stage}</p>}
            <Button onClick={() => void say(t("mcp.openCourse", { name: c.name }))}>{t("home.continue")}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
