import { useState } from "react";
import { saveAttachment } from "@/lib/attachments";
import type { Attachment } from "@/domain/learn/engine";

export function useAttachments(course: string) {
  const [items, setItems] = useState<(Attachment & { name: string })[]>([]);
  const [err, setErr] = useState<string | null>(null);
  async function add(files: FileList | null) {
    setErr(null);
    for (const f of Array.from(files ?? [])) {
      try {
        const a = await saveAttachment(course, f);
        setItems((x) => [...x, { ...a, name: f.name }]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
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
export type Atts = ReturnType<typeof useAttachments>;
