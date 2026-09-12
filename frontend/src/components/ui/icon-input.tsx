import { InputHTMLAttributes, forwardRef } from "react";

import { cn } from "@/lib/utils";

export const IconInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { icon: React.ReactNode }
>(({ className, icon, ...props }, ref) => (
  <div className="relative">
    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
      {icon}
    </span>
    <input
      ref={ref}
      className={cn(
        "h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 pl-10 pr-3 text-sm outline-none transition-colors",
        "focus:border-[#E5484D] focus:bg-white focus:ring-4 focus:ring-[#E5484D]/10",
        className
      )}
      {...props}
    />
  </div>
));
IconInput.displayName = "IconInput";

export const MailIcon = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
    <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3 6l7 5 7-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LockIcon = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
    <rect x="4" y="9" width="12" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const UserIcon = () => (
  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none">
    <circle cx="10" cy="6.5" r="3" stroke="currentColor" strokeWidth="1.5" />
    <path d="M3.5 17c1-3.5 4-5 6.5-5s5.5 1.5 6.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
