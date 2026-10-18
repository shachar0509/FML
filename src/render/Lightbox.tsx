import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";

/** Exercise figure crop: thumbnail that opens full size; Esc closes (Radix). */
export function Thumb({ src, alt }: { src: string; alt: string }) {
  const { t } = useTranslation();
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <img src={src} alt={alt} title={t("render.zoom")} className="max-h-40 cursor-zoom-in rounded border border-border bg-white" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content className="fixed inset-4 z-50 flex items-center justify-center overflow-auto" aria-describedby={undefined}>
          <Dialog.Title className="sr-only">{alt}</Dialog.Title>
          <Dialog.Close asChild>
            <img src={src} alt={alt} className="max-h-full max-w-full cursor-zoom-out rounded bg-white" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
