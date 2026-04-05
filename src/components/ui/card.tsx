import * as React from "react";
import { cn } from "@/src/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("bg-white/84 dark:bg-card-alt/84 backdrop-blur-xl rounded-[32px] border border-border/70 dark:border-border-dark/70 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.26)] dark:shadow-[0_22px_48px_-30px_rgba(2,6,23,0.7)]", className)}
      {...props}
    />
  )
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col space-y-1.5 p-5", className)} {...props} />
  )
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn("font-semibold text-[16px] leading-none", className)} {...props} />
  )
);
CardTitle.displayName = "CardTitle";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
  )
);
CardContent.displayName = "CardContent";

const GlassCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("bg-white/88 dark:bg-card-alt/88 backdrop-blur-[20px] border border-border/70 dark:border-border-dark/70 shadow-[0_22px_48px_-30px_rgba(15,23,42,0.28)] dark:shadow-[0_26px_52px_-30px_rgba(2,6,23,0.72)] rounded-[32px]", className)}
      {...props}
    />
  )
);
GlassCard.displayName = "GlassCard";

export { Card, CardHeader, CardTitle, CardContent, GlassCard };
