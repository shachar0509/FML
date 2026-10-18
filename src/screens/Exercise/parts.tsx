import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ImagePlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { MAX_PAGES } from "@/domain/practice/grade";
import { paths } from "@/domain/practice/exercises";
import { saveAnswerFile } from "@/lib/attachments";
import { fs } from "@/lib/fs/fs";

/** Re-render on every emit of a subscribable controller (Lesson, ExerciseRun, Practice). */
export function useSub(o: { subscribe: (f: () => void) => () => void }) {
  const v = useRef(0);
  useSyncExternalStore(
    useCallback((cb: () => void) => o.subscribe(() => { v.current++; cb(); }), [o]),
    () => v.current,
  );
}

/** Solution pages for grading/hints: images or PDFs (rendered per page), max 12 pages in total. Same shape as Learn's `useAttachments`. */
export function useAnswerFiles(course: string) {
  const { t } = useTranslation();
  const [items, setItems] = useState<(Awaited<ReturnType<typeof saveAnswerFile>>[number] & { name: string })[]>([]);
  const [err, setErr] = useState<string | null>(null);
  async function add(files: FileList | File[] | null) {
    setErr(null);
    for (const f of Array.from(files ?? [])) {
      try {
        const saved = await saveAnswerFile(course, f);
        setItems((x) => {
          const fresh = saved.filter((a) => !x.some((y) => y.sha256 === a.sha256));
          if (x.length + fresh.length > MAX_PAGES) {
            setErr(t("grade.tooManyPages"));
            return x;
          }
          return [...x, ...fresh.map((a, i) => ({ ...a, name: saved.length > 1 ? `${f.name} ${i + 1}` : f.name }))];
        });
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        setErr(t(m, { defaultValue: m }));
      }
    }
  }
  return {
    items, err, add,
    remove: (sha: string) => setItems((x) => x.filter((a) => a.sha256 !== sha)),
    clear: () => setItems([]),
    refs: () => items.map(({ name, ...a }) => (void name, a)),
  };
}
export type AnswerFiles = ReturnType<typeof useAnswerFiles>;

/** Button + hidden picker for images and PDFs. */
export function PickButton({ files, label, disabled, variant = "outline" }: { files: AnswerFiles; label: string; disabled?: boolean; variant?: "outline" | "ghost" }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => { void files.add(e.target.files); e.target.value = ""; }} />
      <Button type="button" variant={variant} disabled={disabled} onClick={() => ref.current?.click()}><ImagePlus className="size-4" />{label}</Button>
    </>
  );
}

/** Object URL of a figure crop stored in the course folder. */
export function useCropUrl(course: string, file: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let live = true;
    void (async () => {
      try {
        const bytes = await fs().readBytes(`${paths(course).course}/${file}`);
        if (!live) return;
        made = URL.createObjectURL(new Blob([bytes as BlobPart], { type: file.endsWith(".png") ? "image/png" : "image/jpeg" }));
        setUrl(made);
      } catch {
        /* missing crop: show nothing */
      }
    })();
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [course, file]);
  return url;
}
