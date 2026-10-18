import { useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Atts } from "./useAttachments";

export function AttachButton({ atts, disabled }: { atts: Atts; disabled?: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => { void atts.add(e.target.files); e.target.value = ""; }} />
      <Button type="button" variant="ghost" size="icon" disabled={disabled} title={t("learn.attach")} aria-label={t("learn.attach")} onClick={() => ref.current?.click()}>
        <ImagePlus className="size-4" />
      </Button>
    </>
  );
}

export function Chips({ atts }: { atts: Atts }) {
  const { t } = useTranslation();
  return (
    <>
      {atts.items.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {atts.items.map((a) => (
            <span key={a.sha256} className="inline-flex items-center gap-1 rounded bg-border px-2 py-0.5 text-xs">
              <span dir="ltr" className="max-w-40 truncate">{a.name}</span>
              <button type="button" aria-label={t("learn.remove")} onClick={() => atts.remove(a.sha256)}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      {atts.err && <p className="text-xs text-danger">{atts.err}</p>}
    </>
  );
}
