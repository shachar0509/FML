import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/core/lib/utils";

const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-fg shadow-sm hover:opacity-90",
        outline: "border border-border bg-card shadow-sm hover:bg-border/50",
        ghost: "hover:bg-border/50",
        danger: "bg-danger text-danger-fg hover:opacity-90",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", icon: "size-9" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

type Props = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof variants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, ...p }: Props) {
  const C = asChild ? Slot : "button";
  return <C className={cn(variants({ variant, size }), className)} {...p} />;
}
