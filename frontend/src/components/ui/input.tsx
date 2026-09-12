import { InputHTMLAttributes, forwardRef, LabelHTMLAttributes, SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-500",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("mb-1 block text-sm font-medium text-neutral-700", className)} {...props} />
  );
}

export function Select({
  className,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 w-full rounded-md border border-neutral-300 bg-white px-3 text-sm outline-none focus:border-neutral-500",
        className
      )}
      {...props}
    />
  );
}
