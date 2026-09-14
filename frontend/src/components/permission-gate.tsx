import { LockIcon } from "@/components/ui/icons";

/** Blocks a page's content for a role that lacks the permission it needs —
 * the nav already hides the link (see app-shell.tsx), but a direct URL
 * still reaches the page, and an empty/broken screen from silently
 * failing API calls reads as a bug rather than "you're not allowed here." */
export function PermissionGate({ allowed, children }: { allowed: boolean; children: React.ReactNode }) {
  if (allowed) return <>{children}</>;

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-neutral-200 bg-neutral-50/50 py-20 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-300 shadow-sm">
        <LockIcon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-sm font-medium text-neutral-700">You don&apos;t have access to this page</p>
        <p className="mt-0.5 text-xs text-neutral-400">Ask an admin to grant your role the right permission.</p>
      </div>
    </div>
  );
}
