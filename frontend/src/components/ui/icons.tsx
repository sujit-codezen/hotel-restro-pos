type IconProps = { className?: string };

const base = "h-[18px] w-[18px]";

export const GridIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const UtensilsIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M5 2.5v6a1.5 1.5 0 0 0 3 0v-6M6.5 2.5v15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M14.5 2.5c-1.5 0-2.5 1.8-2.5 4s1 4 2.5 4M14.5 2.5v15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const MonitorIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <rect x="2.5" y="3.5" width="15" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M7 17h6M10 13.5V17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const BedIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M2.5 16V6.5M2.5 12h15v4M2.5 12V9a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 9.5 9v3M9.5 9.5H16a1.5 1.5 0 0 1 1.5 1.5v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const CalendarIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <rect x="2.5" y="4" width="15" height="13.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.5 8h15M6.5 2.5v3M13.5 2.5v3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const ListIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M7 5h10.5M7 10h10.5M7 15h10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="3" cy="5" r="1" fill="currentColor" />
    <circle cx="3" cy="10" r="1" fill="currentColor" />
    <circle cx="3" cy="15" r="1" fill="currentColor" />
  </svg>
);

export const TableIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <rect x="2.5" y="4.5" width="15" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2.5 9h15M8 9v6.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

export const DoorIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <rect x="4.5" y="2.5" width="11" height="15" rx="1" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="12" cy="10" r="0.9" fill="currentColor" />
  </svg>
);

export const UsersIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <circle cx="7" cy="6.5" r="2.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M2 16c.7-2.8 2.6-4.5 5-4.5s4.3 1.7 5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M13 7a2.3 2.3 0 1 0 0-4.6M15.5 16c-.5-2.1-1.5-3.6-3-4.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const ChartIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M3 17V8M9.5 17V3M16 17v-5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const GearIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
    <path
      d="M10 3v1.6M10 15.4V17M17 10h-1.6M4.6 10H3M14.8 5.2l-1.1 1.1M6.3 13.7l-1.1 1.1M14.8 14.8l-1.1-1.1M6.3 6.3 5.2 5.2"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const LogoutIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M8 17H4.5A1.5 1.5 0 0 1 3 15.5v-11A1.5 1.5 0 0 1 4.5 3H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M13 13.5 17 10l-4-3.5M17 10H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SearchIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.5" />
    <path d="M17 17l-3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const TrashIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M3.5 5.5h13M8 5.5v-1a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5.5 5.5l.6 10a1.5 1.5 0 0 0 1.5 1.4h4.8a1.5 1.5 0 0 0 1.5-1.4l.6-10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const PlusIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const MinusIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

export const TagIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path
      d="M10.5 3H4.5A1.5 1.5 0 0 0 3 4.5v6c0 .4.16.78.44 1.06l7 7a1.5 1.5 0 0 0 2.12 0l6-6a1.5 1.5 0 0 0 0-2.12l-7-7A1.5 1.5 0 0 0 10.5 3Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <circle cx="7" cy="7" r="1" fill="currentColor" />
  </svg>
);

export const MenuIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M3 5.5h14M3 10h14M3 14.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const XIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const EditIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path
      d="M13.5 3.5a1.5 1.5 0 0 1 2.12 0l.88.88a1.5 1.5 0 0 1 0 2.12L7.5 15.5l-3.5 1 1-3.5 8.5-9.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

export const ClockIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
    <path d="M10 6v4l2.5 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SparkleIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path
      d="M9.5 2.5c.3 2.4 1 3.6 3.5 4-2.5.4-3.2 1.6-3.5 4-.3-2.4-1-3.6-3.5-4 2.5-.4 3.2-1.6 3.5-4Z"
      fill="currentColor"
    />
    <path
      d="M15.2 11c.2 1.5.7 2.2 2.3 2.5-1.6.3-2.1 1-2.3 2.5-.2-1.5-.7-2.2-2.3-2.5 1.6-.3 2.1-1 2.3-2.5Z"
      fill="currentColor"
    />
  </svg>
);

export const ReceiptIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path
      d="M5 2.5h10v15l-1.8-1.3-1.7 1.3-1.7-1.3-1.8 1.3-1.7-1.3-1.3 1.3v-15Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M7 7h6M7 10h6M7 13h3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const ShieldIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path
      d="M10 2.5 16 5v4.5c0 4.2-2.7 6.9-6 8-3.3-1.1-6-3.8-6-8V5l6-2.5Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path d="M7.3 10 9.2 12l3.5-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const LockIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <rect x="4" y="9" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <circle cx="10" cy="13" r="1.25" fill="currentColor" />
  </svg>
);

export const CheckIcon = ({ className }: IconProps) => (
  <svg viewBox="0 0 20 20" fill="none" className={className ?? base}>
    <path d="M4 10.5 8 14.5 16 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

