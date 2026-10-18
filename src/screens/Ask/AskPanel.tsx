import { useRef, useState, useSyncExternalStore } from "react";
import { ImagePlus, Loader2, Plus, Send, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { claude } from "@/claude/runtime";
import { Button } from "@/components/ui/button";
import { AskThread } from "@/domain/ask/ask";
import { Markdown } from "@/render/Markdown";
import { useAskContext } from "./useAskContext";

/** One in-memory thread for the whole app session: closing the drawer keeps it (12.9). */
export const askThread = new AskThread(claude);

export function AskPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const th = askThread;
  const msgs = useSyncExternalStore(th.subscribe, () => th.messages);
  const ctx = useAskContext();
  const [text, setText] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  function submit() {
    if (th.busy || (!text.trim() && !image)) return;
    void th.send(text, ctx, image ?? undefined);
    setText("");
    setImage(null);
  }
  async function attach(f: File | undefined) {
    if (!f) return;
    setErr(null);
    try {
      setImage(await AskThread.image(f));
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("api.failed"));
    }
  }
  const error = th.error ?? err;
  return (
    <aside aria-label={t("ask.title")} className="fixed inset-y-12 end-0 z-40 flex w-[400px] max-w-full animate-in slide-in-from-right flex-col border-s border-border bg-card shadow-lg rtl:slide-in-from-left">
      <header className="flex items-center gap-2 border-b border-border p-3">
        <h2 className="font-semibold">{t("ask.title")}</h2>
        <Button variant="outline" className="ms-auto" onClick={() => th.reset()}>
          <Plus className="size-4" />
          {t("ask.new")}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t("common.close")} onClick={onClose}>
          <X className="size-4" />
        </Button>
      </header>
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        {msgs.map((m) => (
          <div key={m.id} className={m.role === "user" ? "ms-8 rounded-card bg-border/50 p-3" : "rounded-card border border-border p-3"}>
            {m.image && <img src={`data:image/jpeg;base64,${m.image}`} alt="" className="mb-2 max-h-32 rounded" />}
            <Markdown>{m.text}</Markdown>
          </div>
        ))}
        {th.busy && <Loader2 className="size-4 animate-spin text-muted" role="status" />}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
      <div className="flex flex-col gap-2 border-t border-border p-3">
        {!msgs.length && (
          <div className="flex flex-wrap gap-2">
            {(["ex1", "ex2", "ex3"] as const).map((k) => (
              <button key={k} className="rounded-full border border-border px-3 py-1 text-xs hover:border-primary" onClick={() => setText(t(`ask.${k}`))}>
                {t(`ask.${k}`)}
              </button>
            ))}
          </div>
        )}
        {image && (
          <div className="relative w-fit">
            <img src={`data:image/jpeg;base64,${image}`} alt="" className="max-h-16 rounded" />
            <button type="button" aria-label={t("learn.remove")} className="absolute -end-2 -top-2 rounded-full bg-card p-0.5" onClick={() => setImage(null)}>
              <X className="size-3" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />
          <Button type="button" variant="ghost" size="icon" title={t("learn.attach")} aria-label={t("learn.attach")} onClick={() => file.current?.click()}>
            <ImagePlus className="size-4" />
          </Button>
          <textarea dir="auto" rows={2} value={text} placeholder={t("ask.placeholder")} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="min-h-10 flex-1 resize-none rounded-lg border border-border bg-bg p-2 text-sm" />
          <Button onClick={submit} aria-label={t("learn.send")}>
            <Send className="size-4 rtl:-scale-x-100" />
          </Button>
        </div>
      </div>
    </aside>
  );
}
