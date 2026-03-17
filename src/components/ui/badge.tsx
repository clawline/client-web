import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[#EDF2F0] dark:bg-[#2d3748] text-[#2D3436] dark:text-[#e2e8f0] text-xs px-2 py-1",
        success: "bg-[#67B88B]/10 text-[#67B88B] text-xs px-2 py-1",
        warning: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 text-xs px-2 py-1",
        count: "w-5 h-5 bg-[#67B88B] text-white text-[11px] font-bold justify-center",
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
