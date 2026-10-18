import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { UsageEntry } from "@/claude/gateway";
import { Input } from "@/components/ui/input";
import { readUsage, summarizeMonth, type Totals } from "@/domain/usage/usage";
import { useSettings } from "@/stores/settings";
import { Row } from "./parts";

const tokens = (x: Totals) => x.input + x.output + x.cacheWrite + x.cacheRead;

export function Usage() {
  const { t } = useTranslation();
  const cap = useSettings((s) => s.settings.usage.monthlyCapUsd);
  const update = useSettings((s) => s.update);
  const [entries, setEntries] = useState<UsageEntry[]>([]);
  const [capText, setCapText] = useState(cap === null ? "" : String(cap));

  useEffect(() => {
    void (async () => {
      try {
        const { appConfigDir } = await import("@tauri-apps/api/path");
        setEntries(await readUsage(await appConfigDir()));
      } catch {
        setEntries([]); // browser / no usage file yet
      }
    })();
  }, []);

  const d = new Date();
  const { total, byTask, byCourse } = summarizeMonth(entries, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  const fmt = new Intl.NumberFormat(undefined);

  const table = (title: string, first: string, rows: [string, Totals][]) => (
    <section className="mt-6">
      <h2 className="mb-2 text-base font-semibold">{title}</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-start text-muted">
            <th className="py-1 text-start font-medium">{first}</th>
            <th className="py-1 text-end font-medium">{t("settings.usage.input")}</th>
            <th className="py-1 text-end font-medium">{t("settings.usage.output")}</th>
            <th className="py-1 text-end font-medium">{t("settings.usage.cached")}</th>
            {total.usd > 0 && <th className="py-1 text-end font-medium">USD</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-t border-border">
              <td className="py-1 text-start">{k}</td>
              <td className="py-1 text-end tabular-nums">{fmt.format(v.input)}</td>
              <td className="py-1 text-end tabular-nums">{fmt.format(v.output)}</td>
              <td className="py-1 text-end tabular-nums">{fmt.format(v.cacheRead + v.cacheWrite)}</td>
              {total.usd > 0 && <td className="py-1 text-end tabular-nums">${v.usd.toFixed(2)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );

  return (
    <div>
      <h2 className="text-base font-semibold">{t("settings.usage.month")}</h2>
      <p className="mt-1 text-lg">{t("settings.usage.tokens", { n: fmt.format(tokens(total)) })}</p>
      {total.usd > 0 ? (
        <p className="text-sm">{t("settings.usage.cost", { usd: `$${total.usd.toFixed(2)}` })}</p>
      ) : (
        <p className="text-sm text-muted">{t("settings.usage.noPricing")}</p>
      )}
      {entries.length === 0 || tokens(total) === 0 ? (
        <p className="mt-4 text-sm text-muted">{t("settings.usage.empty")}</p>
      ) : (
        <>
          {table(t("settings.usage.perTask"), t("settings.usage.task"), Object.entries(byTask).map(([k, v]) => [t(`settings.claude.tasks.${k}`, { defaultValue: k }), v]))}
          {table(t("settings.usage.perCourse"), t("settings.usage.course"), Object.entries(byCourse).map(([k, v]) => [k === "-" ? t("settings.usage.noCourse") : k, v]))}
        </>
      )}
      <Row className="mt-6" label={t("settings.usage.cap")} hint={t("settings.usage.capHint")}>
        <Input
          type="number"
          dir="ltr"
          className="w-28"
          min={0}
          step={1}
          aria-label={t("settings.usage.cap")}
          value={capText}
          onChange={(e) => {
            setCapText(e.target.value);
            const v = e.target.valueAsNumber;
            if (e.target.value === "") update({ usage: { monthlyCapUsd: null } });
            else if (Number.isFinite(v) && v >= 0) update({ usage: { monthlyCapUsd: v } });
          }}
        />
      </Row>
    </div>
  );
}
