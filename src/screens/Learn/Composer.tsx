import { useState } from "react";
import { Send, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Lesson } from "@/domain/learn/engine";
import { AttachButton, Chips } from "./Attach";
import { useAttachments } from "./useAttachments";

const QUICK = ["gotIt", "again", "example", "exercise", "summary"] as const;

export function Composer({ lesson }: { lesson: Lesson }) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const atts = useAttachments(lesson.courseNumber);
  const busy = lesson.busy;
  function submit() {
    if (busy || (!text.trim() && !atts.items.length)) return;
    void lesson.send(text.trim(), atts.refs());
    setText("");
    atts.clear();
  }
  const chip = "rounded-full border border-border px-3 py-1 text-xs hover:border-primary disabled:opacity-50";
  return (
    <div className="flex flex-col gap-2 border-t border-border bg-bg p-3">
      <div className="flex flex-wrap gap-2">
        {QUICK.map((k) => (
          <button key={k} className={chip} disabled={busy} onClick={() => void lesson.send(t(`quick.${k}`))}>{t(`quick.${k}`)}</button>
        ))}
        <button className={chip} disabled={busy} onClick={() => void lesson.recap()}>{t("learn.recap")}</button>
      </div>
      <Chips atts={atts} />
      <div className="flex items-end gap-2">
        <AttachButton atts={atts} disabled={busy} />
        <textarea dir="auto" rows={2} value={text} disabled={busy} placeholder={t("learn.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-card p-2 text-sm" />
        {busy ? (
          <Button variant="outline" onClick={() => lesson.stop()}><Square className="size-4" />{t("learn.stop")}</Button>
        ) : (
          <Button onClick={submit} aria-label={t("learn.send")}><Send className="size-4 rtl:-scale-x-100" />{t("learn.send")}</Button>
        )}
      </div>
    </div>
  );
}
