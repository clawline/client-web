import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border border-border/80 bg-white/88 dark:border-border-dark/80 dark:bg-card-alt/88 text-text dark:text-text-inv text-xs px-2.5 py-1 shadow-sm",
        success: "border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/12 dark:text-emerald-300 text-xs px-2.5 py-1",
        warning: "border border-amber-300/50 dark:border-amber-700/40 bg-amber-100/90 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 text-xs px-2.5 py-1",
        count: "w-5 h-5 bg-primary text-white text-[11px] font-bold justify-center",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
