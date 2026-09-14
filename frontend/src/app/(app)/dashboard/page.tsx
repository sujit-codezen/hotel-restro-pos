"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { BedIcon, CalendarIcon, ChartIcon, MonitorIcon, ReceiptIcon, TableIcon, TagIcon, UtensilsIcon } from "@/components/ui/icons";
import { api } from "@/lib/api";
import { useCurrentUser } from "@/lib/hooks";
import { DashboardDayTrend, DashboardSummary } from "@/lib/types";
import { cn, formatCurrency } from "@/lib/utils";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function weekday(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" });
}

/** Rounds a chart's max value up to a "clean" axis tick (1/2/5 × 10^n) so
 * the gridlines read 0 / 500 / 1,000 instead of 0 / 437 / 874. */
function niceMax(value: number) {
  if (value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const residual = value / magnitude;
  const step = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 5 ? 5 : 10;
  return step * magnitude;
}

/** Tiny decorative trend line for a stat card — the whole line stays in
 * the de-emphasis gray except the final (today) segment and dot, which
 * carry the card's own accent hue, per the stat-tile sparkline spec. */
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const width = 100;
  const height = 28;
  const max = Math.max(...values, 1);
  const points = values.map((v, i) => [
    (i / (values.length - 1)) * width,
    height - (v / max) * (height - 4) - 2,
  ]);
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [px, py] = points[points.length - 2] ?? points[points.length - 1];
  const [lx, ly] = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="mt-2 h-7 w-full" aria-hidden="true">
      <path d={path} fill="none" stroke="#e5e5e5" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d={`M${px.toFixed(1)},${py.toFixed(1)} L${lx.toFixed(1)},${ly.toFixed(1)}`}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx={lx} cy={ly} r="2.5" fill={color} />
    </svg>
  );
}

function StatCard({
  icon,
  iconClass,
  accentColor,
  label,
  value,
  trend,
  loading,
}: {
  icon: React.ReactNode;
  iconClass: string;
  accentColor?: string;
  label: string;
  value: string;
  trend?: number[];
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", iconClass)}>
          {icon}
        </span>
        <div className="min-w-0">
          {loading ? (
            <div className="h-6 w-20 animate-pulse rounded bg-neutral-100" />
          ) : (
            <p className="truncate text-xl font-semibold leading-tight text-neutral-900">{value}</p>
          )}
          <p className="mt-0.5 text-xs text-neutral-500">{label}</p>
        </div>
      </div>
      {trend && accentColor && !loading && <Sparkline values={trend} color={accentColor} />}
    </div>
  );
}

function QuickAction({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-4 text-center shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FDECEC] text-[#E5484D]">
        {icon}
      </span>
      <span className="text-xs font-medium text-neutral-700">{label}</span>
    </Link>
  );
}

/** The dashboard's one real chart: sales for each of the last 7 days.
 * Single series, so no legend box (the title already says what's
 * plotted) — just the area/line in the brand accent, gridlines rounded to
 * clean numbers, an end label on today, and a per-day hover/focus
 * tooltip so every value is reachable without a mouse. */
function SalesTrendChart({ days, loading }: { days: DashboardDayTrend[]; loading: boolean }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (loading || days.length === 0) {
    return <div className="h-[220px] animate-pulse rounded-2xl bg-neutral-100" />;
  }

  const width = 640;
  const height = 220;
  const margin = { top: 24, right: 12, bottom: 28, left: 64 };
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;
  const n = days.length;

  const max = niceMax(Math.max(...days.map((d) => d.sales)));
  const yTicks = [0, max / 2, max];

  const xAt = (i: number) => margin.left + (n === 1 ? innerWidth / 2 : (i / (n - 1)) * innerWidth);
  const yAt = (v: number) => margin.top + innerHeight - (v / max) * innerHeight;

  const points = days.map((d, i) => ({ x: xAt(i), y: yAt(d.sales), day: d }));
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const baseline = margin.top + innerHeight;
  const areaPath = `${linePath} L${points[n - 1].x.toFixed(1)},${baseline} L${points[0].x.toFixed(1)},${baseline} Z`;
  const colWidth = innerWidth / n;
  const last = points[n - 1];

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const tooltipAnchor = hoverIndex === 0 ? "left" : hoverIndex === n - 1 ? "right" : "center";

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-neutral-900">Sales — last 7 days</p>
      <div className="relative mt-2">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Sales for the last 7 days">
          {yTicks.map((t) => (
            <g key={t}>
              <line
                x1={margin.left}
                x2={width - margin.right}
                y1={yAt(t)}
                y2={yAt(t)}
                stroke="#f0f0f0"
                strokeWidth="1"
              />
              <text x={margin.left - 10} y={yAt(t)} textAnchor="end" dominantBaseline="middle" className="fill-neutral-400 text-[10px]">
                {t >= 1000 ? `${(t / 1000).toFixed(t % 1000 === 0 ? 0 : 1)}k` : Math.round(t)}
              </text>
            </g>
          ))}

          <path d={areaPath} fill="#E5484D" opacity="0.1" />
          <path d={linePath} fill="none" stroke="#E5484D" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {hovered && (
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={margin.top}
              y2={baseline}
              stroke="#d4d4d4"
              strokeWidth="1"
            />
          )}

          {points.map((p, i) => {
            const isLast = i === n - 1;
            const isHovered = i === hoverIndex;
            if (!isLast && !isHovered) return null;
            return (
              <circle
                key={`dot-${p.day.date}`}
                cx={p.x}
                cy={p.y}
                r={isHovered ? 5 : 4}
                fill="#E5484D"
                stroke="white"
                strokeWidth="2"
              />
            );
          })}

          <text x={last.x} y={last.y - 12} textAnchor="middle" className="fill-neutral-900 text-[11px] font-semibold">
            {formatCurrency(last.day.sales)}
          </text>

          {days.map((d, i) => (
            <text
              key={d.date}
              x={xAt(i)}
              y={height - 6}
              textAnchor="middle"
              className={cn("text-[10px]", i === n - 1 ? "fill-neutral-700 font-medium" : "fill-neutral-400")}
            >
              {i === n - 1 ? "Today" : weekday(d.date)}
            </text>
          ))}

          {points.map((p, i) => (
            <rect
              key={`hit-${p.day.date}`}
              x={margin.left + i * colWidth}
              y={margin.top}
              width={colWidth}
              height={innerHeight}
              fill="transparent"
              tabIndex={0}
              role="img"
              aria-label={`${weekday(p.day.date)}: ${formatCurrency(p.day.sales)}, ${p.day.orders} order${p.day.orders === 1 ? "" : "s"}`}
              onMouseEnter={() => setHoverIndex(i)}
              onFocus={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onBlur={() => setHoverIndex(null)}
              className="outline-none"
            />
          ))}
        </svg>

        {hovered && (
          <div
            className={cn(
              "pointer-events-none absolute z-10 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-lg bg-neutral-900 px-2.5 py-1.5 text-xs shadow-lg",
              tooltipAnchor === "left" && "translate-x-0",
              tooltipAnchor === "right" && "-translate-x-full",
              tooltipAnchor === "center" && "-translate-x-1/2"
            )}
            style={{ left: `${(hovered.x / width) * 100}%`, top: `${(hovered.y / height) * 100}%` }}
          >
            <p className="font-semibold text-white">{formatCurrency(hovered.day.sales)}</p>
            <p className="text-neutral-300">
              {weekday(hovered.day.date)} · {hovered.day.orders} order{hovered.day.orders === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data: user } = useCurrentUser();
  const { data, isLoading } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary"],
    queryFn: async () => (await api.get("/dashboard/summary/")).data,
    refetchInterval: 30_000,
  });

  const trend = data?.last_7_days;

  const cards = [
    {
      label: "Today's sales",
      value: data ? formatCurrency(data.todays_sales) : "—",
      icon: <ChartIcon className="h-5 w-5" />,
      iconClass: "bg-emerald-50 text-emerald-600",
      accentColor: "#059669",
      trend: trend?.map((d) => d.sales),
    },
    {
      label: "Today's orders",
      value: String(data?.todays_orders ?? "—"),
      icon: <ReceiptIcon className="h-5 w-5" />,
      iconClass: "bg-sky-50 text-sky-600",
      accentColor: "#0284c7",
      trend: trend?.map((d) => d.orders),
    },
    {
      label: "Items sold",
      value: String(data?.items_sold ?? "—"),
      icon: <UtensilsIcon className="h-5 w-5" />,
      iconClass: "bg-violet-50 text-violet-600",
      accentColor: "#7c3aed",
      trend: trend?.map((d) => d.items_sold),
    },
    {
      label: "Pending credit",
      value: data ? formatCurrency(data.pending_credit) : "—",
      icon: <TagIcon className="h-5 w-5" />,
      iconClass: "bg-amber-50 text-amber-600",
    },
  ];

  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">
          {greeting()}{user?.first_name ? `, ${user.first_name}` : ""}
        </h1>
        <p className="mt-0.5 text-sm text-neutral-500">{today} · Here&apos;s how things are looking today.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {cards.map((c) => (
          <StatCard key={c.label} {...c} loading={isLoading} />
        ))}
      </div>

      <SalesTrendChart days={trend ?? []} loading={isLoading} />

      <div>
        <p className="mb-3 text-sm font-medium text-neutral-500">Quick actions</p>
        {/* Same set the sidebar always shows, regardless of business type
           (see app-shell.tsx's NAV — Kitchen/Rooms/Reservations aren't
           gated by store type there either, since a combined single-store
           business can run hotel features off a plain RESTAURANT-typed
           store — so this doesn't try to guess from store_type). */}
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          <QuickAction href="/pos" icon={<UtensilsIcon className="h-5 w-5" />} label="New order" />
          <QuickAction href="/pos/tables" icon={<TableIcon className="h-5 w-5" />} label="Tables" />
          <QuickAction href="/kds" icon={<MonitorIcon className="h-5 w-5" />} label="Kitchen" />
          <QuickAction href="/hotel/rooms" icon={<BedIcon className="h-5 w-5" />} label="Rooms" />
          <QuickAction href="/hotel/reservations" icon={<CalendarIcon className="h-5 w-5" />} label="Reservations" />
        </div>
      </div>
    </div>
  );
}
