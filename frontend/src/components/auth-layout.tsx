const FEATURES = [
  { title: "Bill in seconds", desc: "Search, tap, pay — no menus to dig through" },
  { title: "Charge to room", desc: "Restaurant orders land straight on the guest's folio" },
  { title: "Live kitchen display", desc: "Tickets update the moment an order's sent" },
];

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-stretch justify-center bg-neutral-50 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl shadow-xl shadow-neutral-200/60 md:grid-cols-2">
        {/* Branded panel */}
        <div className="relative hidden flex-col justify-between overflow-hidden bg-[#E5484D] p-10 text-white md:flex">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/10"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -left-10 h-56 w-56 rounded-full bg-white/10"
          />

          <div className="relative flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15 text-lg font-bold">
              P
            </div>
            <span className="text-sm font-semibold tracking-wide">POS Restro Hotel</span>
          </div>

          <div className="relative space-y-8">
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold leading-snug">{title}</h2>
              <p className="text-sm text-white/80">{subtitle}</p>
            </div>

            <ul className="space-y-4">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20">
                    <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none">
                      <path
                        d="M3 8.5L6.2 11.5L13 4.5"
                        stroke="white"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div>
                    <p className="text-sm font-medium">{f.title}</p>
                    <p className="text-xs text-white/70">{f.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <p className="relative text-xs text-white/60">One system. Restaurant + hotel billing.</p>
        </div>

        {/* Form panel */}
        <div className="flex flex-col justify-center bg-white p-8 sm:p-10">{children}</div>
      </div>
    </div>
  );
}
