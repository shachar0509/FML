import { useEffect, useRef, useState } from "react";
import { Waiting } from "./Waiting";
import { ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/core/components/ui/button";
import { Markdown } from "@/core/render/Markdown";
import { GradeCard, readable } from "./GradeCard";
import { h2, panel } from "../ui";
import type { ExerciseData, Go } from "../types";

type Tool = (
  name: string,
  args?: Record<string, unknown>,
) => Promise<{ structuredContent?: unknown; isError?: boolean }>;
type Ref = { sha256: string; mediaType: string; name: string };

const b64 = (b: Blob) =>
  new Promise<string>((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] ?? "");
    r.onerror = () => no(r.error);
    r.readAsDataURL(b);
  });
/** Phone photos are shrunk here (long edge 1568) so the upload stays small; anything the browser cannot decode goes as-is. */
async function prep(f: File): Promise<{ mime: string; base64: string }> {
  if (f.type.startsWith("image/"))
    try {
      const bm = await createImageBitmap(f);
      const k = Math.min(1, 1568 / Math.max(bm.width, bm.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bm.width * k);
      c.height = Math.round(bm.height * k);
      c.getContext("2d")?.drawImage(bm, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
      if (blob) return { mime: "image/jpeg", base64: await b64(blob) };
    } catch {
      /* fall through */
    }
  return { mime: f.type, base64: await b64(f) };
}

export function Exercise({ data, callTool, go }: { data: ExerciseData; callTool: Tool; go: Go }) {
  const { t } = useTranslation();
  const [d, setD] = useState(data);
  const [files, setFiles] = useState<Ref[]>([]);
  const [err, setErr] = useState(false);
  const [up, setUp] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const done = readable(d.grade);
  const apply = (r: { structuredContent?: unknown; isError?: boolean }) => {
    setErr(!!r.isError || !r.structuredContent);
    if (!r.isError && r.structuredContent) setD(r.structuredContent as ExerciseData);
    return !r.isError;
  };

  // A grade/hint/solution is produced by Claude in the chat; follow it until it lands.
  useEffect(() => {
    if (!d.busy) return;
    const h = setInterval(
      () => void callTool("exercise_state", { runId: d.runId }).then(apply),
      2000,
    );
    return () => clearInterval(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.busy, d.runId]);

  async function add(list: FileList | null) {
    setUp(true);
    setErr(false);
    for (const f of Array.from(list ?? [])) {
      const p = await prep(f);
      const r = await callTool("attachment_upload", {
        number: d.number,
        name: f.name,
        mime: p.mime,
        base64: p.base64,
      });
      const got = (
        r.structuredContent as { files?: { sha256: string; mediaType: string }[] } | undefined
      )?.files;
      if (r.isError || !got) setErr(true);
      else
        setFiles((x) => [
          ...x,
          ...got
            .filter((g) => !x.some((y) => y.sha256 === g.sha256))
            .map((g, i) => ({ ...g, name: got.length > 1 ? `${f.name} ${i + 1}` : f.name })),
        ]);
    }
    setUp(false);
  }
  const refs = () => files.map(({ sha256, mediaType }) => ({ sha256, mediaType }));
  async function ask(tool: string, args: Record<string, unknown>) {
    if (apply(await callTool(tool, { runId: d.runId, ...args }))) {
      setFiles([]);
      void go();
    }
  }
  const busy = !!d.busy;
  const level = Math.min(3, d.hints.length + 1);

  return (
    <section className="flex flex-col gap-4" aria-label={t("learn.exercise")}>
      <div className="board-surface board mb-3 flex flex-col gap-3 px-5 py-5 sm:px-7">
        <p className="self-start rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {t("exercise.difficulty", { n: d.difficulty })}
        </p>
        <div className="lesson-text">
          <Markdown>{d.statementMd}</Markdown>
        </div>
        {d.figures.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {d.figures.map((s, i) => (
              <img
                key={i}
                src={s}
                alt={t("exercise.figure", { n: i + 1 })}
                className="max-h-48 rounded-lg border border-border"
              />
            ))}
          </div>
        )}
      </div>
      {d.hints.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className={h2}>{t("exercise.hints")}</h2>
          {d.hints.map((h) => (
            <div
              key={h.level}
              className="rounded-card border border-border border-s-4 border-s-warning bg-card p-3 text-sm shadow-card"
            >
              <Markdown>{h.hintMd}</Markdown>
            </div>
          ))}
        </div>
      )}
      {d.grade && (
        <GradeCard grade={d.grade} hintsUsed={d.hints.length} solutionRevealed={!!d.solutionMd} />
      )}
      {d.solutionMd && (
        <div className={`${panel} flex flex-col gap-1 p-4`}>
          <h2 className={h2}>{t("exercise.solution")}</h2>
          <Markdown>{d.solutionMd}</Markdown>
        </div>
      )}
      {busy && <Waiting go={go} label={d.busy === "grade" ? t("exercise.grading") : undefined} />}
      {(err || d.error) && (
        <p role="alert" className="text-sm text-danger">
          {t("exercise.failed")}
        </p>
      )}
      {!done && (
        <div className="flex flex-col gap-2 rounded-card border-2 border-dashed border-border bg-card/60 p-4">
          <p className="flex items-center gap-2 text-sm text-muted">
            <ImagePlus className="size-4 shrink-0" aria-hidden />
            {t("exercise.drop")}
          </p>
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((f) => (
                <li
                  key={f.sha256}
                  className="flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-xs"
                >
                  {f.name}
                  <button
                    className="rounded-full text-muted hover:text-danger focus-visible:outline-2 focus-visible:outline-primary"
                    aria-label={`${t("files.remove")} ${f.name}`}
                    onClick={() => setFiles((x) => x.filter((y) => y.sha256 !== f.sha256))}
                  >
                    <X className="size-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {!done && (
          <>
            <input
              ref={pick}
              type="file"
              accept="image/*,application/pdf"
              multiple
              hidden
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = "";
              }}
            />
            <Button variant="outline" disabled={busy || up} onClick={() => pick.current?.click()}>
              <ImagePlus className="size-4" aria-hidden />
              {t("exercise.upload")}
            </Button>
            <Button
              disabled={busy || up || files.length === 0}
              onClick={() => void ask("exercise_grade_request", { files: refs() })}
            >
              {busy && d.busy === "grade" ? t("exercise.grading") : t("exercise.submit")}
            </Button>
            <Button
              variant="outline"
              disabled={busy || up || d.hints.length >= 3}
              onClick={() => void ask("exercise_hint_request", { files: refs() })}
            >
              {t("exercise.hintN", { n: level })}
            </Button>
          </>
        )}
        {d.canReveal && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void ask("exercise_solution_request", {})}
          >
            {t("exercise.showSolution")}
          </Button>
        )}
        {d.grade && !done && (
          <Button
            variant="outline"
            onClick={async () => void apply(await callTool("exercise_retry", { runId: d.runId }))}
          >
            {t("exercise.retry")}
          </Button>
        )}
      </div>
    </section>
  );
}
