import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Input } from "@/core/components/ui/input";
import type { LookupResult } from "../types";
import { panel } from "../ui";

type Entry = Extract<LookupResult, { status: "found" }>["entry"];
type Phase = "input" | "looking" | "preview" | "manual";
type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

export function AddCourse({
  example,
  callTool,
  open,
  back,
}: {
  example: string;
  callTool: Tool;
  open: (n: string) => void;
  back: () => void;
}) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("input");
  const [raw, setRaw] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [manual, setManual] = useState(false);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [more, setMore] = useState(false);
  const [man, setMan] = useState({ nameHe: "", credits: "", syllabusHe: "" });

  async function lookup() {
    setError(null);
    setPhase("looking");
    const r = ((await callTool("course_lookup", { number: raw })).structuredContent ?? {
      status: "offline",
    }) as LookupResult;
    if (r.status === "invalid") {
      setError(t("course.invalidNumber"));
      setPhase("input");
    } else if (r.status === "exists") open(r.number);
    else if (r.status === "found") {
      setEntry(r.entry);
      setNumber(r.entry.courseNumber);
      setPhase("preview");
    } else {
      setNumber(r.number);
      setManual(r.status === "manual");
      setOffline(r.status === "offline");
      setPhase("manual");
    }
  }

  async function create(manual?: { nameHe: string; credits: number; syllabusHe: string }) {
    const r = await callTool("course_create_request", { number: number || raw, manual });
    if (r.isError) return setError(t("api.failed"));
    open((r.structuredContent as { number?: string } | undefined)?.number ?? number);
  }

  const credits = Number(man.credits);
  const manOk = man.nameHe.trim() && credits > 0 && man.syllabusHe.trim().length >= 100;
  const lbl = "flex flex-col gap-1.5 text-sm font-medium";
  return (
    <section className="flex flex-col gap-4" aria-label={t("home.add")}>
      <h1 className="text-xl font-bold">{t("home.add")}</h1>
      {(phase === "input" || phase === "looking") && (
        <form
          className={`${panel} flex flex-col gap-3 p-4`}
          onSubmit={(e) => (e.preventDefault(), void lookup())}
        >
          <label className={lbl}>
            {t("home.addDesc")}
            <Input
              autoFocus
              dir="ltr"
              placeholder={example}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
            />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={back}>
              {t("home.cancel")}
            </Button>
            <Button type="submit" disabled={phase === "looking" || !raw.trim()}>
              {phase === "looking" ? t("home.searching") : t("home.search")}
            </Button>
          </div>
        </form>
      )}
      {phase === "preview" && entry && (
        <div className="flex flex-col gap-3">
          <div className={`${panel} p-4`}>
            <p className="text-lg font-bold">{entry.nameHe}</p>
            <p className="text-sm text-muted">
              <span dir="ltr">{entry.courseNumber}</span> ·{" "}
              {t("home.credits", { count: entry.credits })} · {entry.faculty}
            </p>
            <p className="mt-3 text-xs font-medium text-muted">{t("course.catalogLabel")}</p>
            <p className="whitespace-pre-line text-sm">
              {more ? entry.syllabusHe : entry.syllabusHe.slice(0, 400)}
              {!more && entry.syllabusHe.length > 400 && "…"}
            </p>
            {entry.syllabusHe.length > 400 && (
              <button className="mt-1 text-sm text-primary" onClick={() => setMore(!more)}>
                {more ? t("home.less") : t("home.more")}
              </button>
            )}
          </div>
          <p className="text-sm text-muted">{t("course.afterAdd")}</p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={back}>
              {t("home.cancel")}
            </Button>
            <Button onClick={() => void create()}>{t("home.add")}</Button>
          </div>
        </div>
      )}
      {phase === "manual" && (
        <form
          className={`${panel} flex flex-col gap-3 p-4`}
          onSubmit={(e) => (
            e.preventDefault(),
            void create({ nameHe: man.nameHe.trim(), credits, syllabusHe: man.syllabusHe.trim() })
          )}
        >
          <p className="text-sm text-muted">
            {t(manual ? "course.manualEntry" : "course.notFound")}
          </p>
          {offline && <p className="text-sm text-warning">{t("net.offline")}</p>}
          <label className={lbl}>
            {t("home.name")}
            <Input
              value={man.nameHe}
              onChange={(e) => setMan({ ...man, nameHe: e.target.value })}
            />
          </label>
          <label className={lbl}>
            {t("home.creditsLabel")}
            <Input
              type="number"
              min={0}
              step={0.5}
              dir="ltr"
              value={man.credits}
              onChange={(e) => setMan({ ...man, credits: e.target.value })}
            />
          </label>
          <label className={lbl}>
            {t("home.syllabus")}
            <textarea
              className="min-h-28 rounded-lg border border-border bg-card p-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
              value={man.syllabusHe}
              onChange={(e) => setMan({ ...man, syllabusHe: e.target.value })}
            />
            <span className="text-xs text-muted">
              {t("home.syllabusHint", { n: man.syllabusHe.trim().length })}
            </span>
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={back}>
              {t("home.cancel")}
            </Button>
            <Button type="submit" disabled={!manOk}>
              {t("home.add")}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
