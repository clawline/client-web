import * as React from "react";
import { cn } from "@/src/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "pressable-inset flex w-full bg-white/92 dark:bg-card-alt/92 border border-border/80 dark:border-border-dark/80 rounded-[16px] px-4 py-3 text-[15px] text-text dark:text-text-inv transition-all placeholder:text-text/35 dark:placeholder:text-text-inv/35 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:italic",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
