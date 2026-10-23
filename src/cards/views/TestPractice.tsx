import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import type { Go, PracticeData, TestData } from "../types";
import { ErrorNote } from "../errors";
import { Board, chalkChoice, inkBox } from "../ui";
import { AnswerFiles, type FileRef } from "./AnswerFiles";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;

/** M59: what a test practice covers: the whole course, chosen subjects, or the quiz material the course published (read by the tutor). */
export function TestChooser({
  number,
  test,
  callTool,
  go,
  set,
  back,
}: {
  number: string;
  test: TestData;
  callTool: Tool;
  go: Go;
  set: (d: PracticeData) => void;
  back: () => void;
}) {
  const { t } = useTranslation();
  const [scope, setScope] = useState<"course" | "units" | "notes">("course");
  const [units, setUnits] = useState<string[]>([]);
  const [files, setFiles] = useState<FileRef[]>([]);
  const [up, setUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    setBusy(true);
    const r = await callTool(name, { courseNumber: number, ...args });
    setBusy(false);
    const d = r.structuredContent as PracticeData | undefined;
    if (d) set(d);
    return d;
  };

  // The quiz notes are read by Claude in the chat; follow it until they land.
  useEffect(() => {
    if (!test.scoping) return;
    const h = setInterval(
      () =>
        void callTool("practice_state", { courseNumber: number }).then(
          (r) => r.structuredContent && set(r.structuredContent as PracticeData),
        ),
      2500,
    );
    return () => clearInterval(h);
  }, [test.scoping, number, callTool, set]);

  const stageIds =
    scope === "course"
      ? null
      : scope === "units"
        ? test.units.filter((u) => units.includes(u.id)).flatMap((u) => u.stageIds)
        : (test.notes?.map((s) => s.id) ?? []);
  const start = async () => {
    const d = await call("practice_start_request", { scope: { kind: "test", stageIds } });
    if (d?.loading) void go();
  };

  return (
    <section className="flex flex-col gap-4" aria-label={t("practice.test.title")}>
      <Board title={t("practice.test.title")}>
        {test.exams === 0 ? (
          <p className="text-[15px]">{t("practice.test.none")}</p>
        ) : (
          <>
            <p className="text-[15px]">{t("practice.test.found", { n: test.exams, left: test.left })}</p>
            {test.weak.length > 0 && (
              <p className="text-sm">
                <span className="board-label">{t("practice.test.weak")}</span>{" "}
                {test.weak.map((w) => w.title).join(", ")}
              </p>
            )}
            <div role="radiogroup" aria-label={t("practice.test.title")} className="grid gap-2">
              {(["course", "units", "notes"] as const).map((k) => (
                <label key={k} className={`${chalkChoice} flex cursor-pointer items-center gap-3 p-3 text-[15px]`}>
                  <input
                    type="radio"
                    name="test-scope"
                    className="size-4 accent-[var(--primary)]"
                    checked={scope === k}
                    onChange={() => setScope(k)}
                  />{" "}
                  {t(`practice.test.scope.${k}`)}
                </label>
              ))}
            </div>
            {scope === "units" && (
              <fieldset className="flex flex-col gap-1">
                <legend className="board-label">{t("practice.test.pickUnits")}</legend>
                {test.units.map((u) => (
                  <label key={u.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--primary)]"
                      checked={units.includes(u.id)}
                      onChange={(e) => setUnits(e.target.checked ? [...units, u.id] : units.filter((x) => x !== u.id))}
                    />
                    {u.title}
                  </label>
                ))}
              </fieldset>
            )}
            {scope === "notes" && test.scoping && (
              <p role="status" className="flex items-center gap-2 text-(--board-muted)">
                {t("practice.test.reading")}
                <Button variant="ghost" size="sm" onClick={() => void callTool("shalav_cancel", { key: `test:${number}` })}>
                  {t("job.cancel")}
                </Button>
              </p>
            )}
            {scope === "notes" && test.notes && !test.scoping && (
              <div className={`${inkBox} board-note`} role="status">
                <p className="board-label">{t("practice.test.covers")}</p>
                <ul className="list-disc ps-5 text-sm">
                  {test.notes.map((s) => (
                    <li key={s.id}>{s.title}</li>
                  ))}
                </ul>
              </div>
            )}
            {test.error && <ErrorNote raw={test.error} fallback="homework.failed" />}
          </>
        )}
      </Board>
      {scope === "notes" && test.exams > 0 && !test.scoping && (
        <>
          <AnswerFiles
            number={number}
            callTool={callTool}
            files={files}
            setFiles={setFiles}
            disabled={busy}
            onBusy={setUp}
            hint={t("practice.test.drop")}
            button={t("practice.test.upload")}
          />
          <Button
            variant="outline"
            className="self-start"
            disabled={busy || up || files.length === 0}
            onClick={async () => {
              const d = await call("test_scope_request", { files: files.map(({ sha256, mediaType }) => ({ sha256, mediaType })) });
              if (d) void go();
            }}
          >
            {t("practice.test.readNotes")}
          </Button>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={back}>
          {t("homework.back")}
        </Button>
        {test.exams > 0 && (
          <Button
            className="ms-auto h-11 px-6 text-[15px]"
            disabled={busy || test.scoping || (stageIds !== null && stageIds.length === 0)}
            onClick={() => void start()}
          >
            {t("practice.start")}
          </Button>
        )}
      </div>
    </section>
  );
}
