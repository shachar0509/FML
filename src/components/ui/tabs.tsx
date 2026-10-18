import * as T from "@radix-ui/react-tabs";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { useSettings } from "@/stores/settings";

// Radix defaults to dir="ltr", which would flip the whole panel in Hebrew.
export const Tabs = (p: ComponentProps<typeof T.Root>) => <T.Root dir={useSettings((s) => s.settings.language) === "he" ? "rtl" : "ltr"} {...p} />;
export const TabsContent = T.Content;
export const TabsList = ({ className, ...p }: ComponentProps<typeof T.List>) => (
  <T.List className={cn("flex gap-1 border-b border-border", className)} {...p} />
);
export const TabsTrigger = ({ className, ...p }: ComponentProps<typeof T.Trigger>) => (
  <T.Trigger
    className={cn(
      "px-4 py-2 text-sm text-muted data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-fg",
      className,
    )}
    {...p}
  />
);
