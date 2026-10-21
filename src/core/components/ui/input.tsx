import type { InputHTMLAttributes } from "react";
import { cn } from "@/core/lib/utils";

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input
    className={cn(
      "h-9 w-full rounded-lg border border-border bg-card px-3 text-sm focus-visible:outline-2 focus-visible:outline-primary",
      className,
    )}
    {...p}
  />
);
