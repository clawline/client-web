import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[#67B88B] text-white shadow-lg shadow-[#67B88B]/25 hover:bg-[#5aa77d]",
        outline: "border border-[#EDF2F0] dark:border-[#2d3748] bg-white dark:bg-[#232437] text-[#2D3436] dark:text-[#e2e8f0] shadow-sm hover:bg-[#F8FAFB] dark:hover:bg-[#2d3748]",
        ghost: "text-[#2D3436]/60 dark:text-[#e2e8f0]/60 hover:text-[#2D3436] dark:hover:text-[#e2e8f0] hover:bg-[#EDF2F0]/50 dark:hover:bg-[#2d3748]/50",
        destructive: "bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50",
        icon: "text-[#2D3436]/40 dark:text-[#e2e8f0]/40 hover:text-[#2D3436] dark:hover:text-[#e2e8f0]",
      },
      size: {
        default: "h-12 px-6 py-3 text-[15px] rounded-[24px]",
        sm: "h-10 px-4 py-2 text-[14px] rounded-[20px]",
        lg: "h-14 px-8 py-4 text-[16px] rounded-[24px]",
        icon: "h-10 w-10 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
