import * as D from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;
export const DialogTitle = D.Title;
export const DialogDescription = D.Description;
export function DialogContent({ className, children, ...p }: ComponentProps<typeof D.Content>) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 bg-black/40" />
      <D.Content
        className={cn(
          "fixed start-1/2 top-1/2 w-[90vw] max-w-md -translate-y-1/2 rounded-card border border-border bg-card p-6 ltr:-translate-x-1/2 rtl:translate-x-1/2",
          className,
        )}
        {...p}
      >
        {children}
      </D.Content>
    </D.Portal>
  );
}
