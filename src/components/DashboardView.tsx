import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Archive,
  ArrowDownRight,
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  DollarSign,
  HardDrive,
  MoreHorizontal,
  Plus,
  ShieldAlert,
  UserCheck,
  Wrench,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTheme } from '../lib/theme.tsx';
import type { Asset, DashboardSummary } from '../types/itams.ts';
import { AnimatedNumber } from './AnimatedNumber.tsx';
import { formatCurrency } from './StatusText.tsx';

export type NavSection =
  | 'dashboard'
  | 'assets'
  | 'employees'
  | 'assignments'
  | 'maintenance'
  | 'reports'
  | 'notifications'
  | 'users';

interface DashboardViewProps {
  summary: DashboardSummary | null;
  assets: Asset[];
  loading: boolean;
  onNavigate: (section: NavSection) => void;
  onOpenAsset: (assetId: string) => void;
}

function ChartTooltipCard({
  active,
  payload,
  label,
  valueFormatter,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    color?: string;
  }>;
  label?: string;
  valueFormatter?: (val: number) => string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-[#080D21]/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-md">
      {label && (
        <div className="mb-1.5 font-display font-semibold text-slate-200 border-b border-white/10 pb-1">
          {label}
        </div>
      )}
      <div className="space-y-1">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-300">
              <span
                className="h-2 w-2 rounded-xs shrink-0"
                style={{ backgroundColor: entry.color || '#3B66F6' }}
              />
              <span>{entry.name}</span>
            </span>
            <span className="font-mono font-semibold text-white tabular-nums">
              {valueFormatter
                ? valueFormatter(Number(entry.value ?? 0))
                : Number(entry.value ?? 0)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniSparkline({
  data,
  stroke,
  gradientId,
}: {
  data: Array<{ value: number }>;
  stroke: string;
  gradientId: string;
}) {
  if (data.length < 2) {
    return (
      <div className="h-11 w-24 flex items-center justify-end">
        <div
          className="h-0.5 w-16 rounded-full opacity-50"
          style={{ backgroundColor: stroke }}
        />
      </div>
    );
  }

  return (
    <div className="h-11 w-24 shrink-0 pointer-events-none">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 2 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            isAnimationActive={true}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DashboardView({
  summary,
  assets,
  loading,
  onNavigate,
  onOpenAsset,
}: DashboardViewProps) {
  const { theme } = useTheme();
  const [acqMetric, setAcqMetric] = useState<'spend' | 'units'>('spend');

  const statusColors: Record<string, string> = {
    Assigned: '#3B66F6',
    Available: '#1AB394',
    'Under Maintenance': '#E9913A',
    Damaged: '#EF4444',
    Retired: '#64748B',
  };

  // Real live computations from loaded inventory
  const analytics = useMemo(() => {
    const retiredCount = assets.filter((a) => a.status === 'Retired').length;
    const damagedCount = assets.filter((a) => a.status === 'Damaged').length;

    // Asset allocation by department (from currently assigned assets)
    const deptMap = new Map<
      string,
      { department: string; count: number; value: number }
    >();
    for (const asset of assets) {
      if (asset.status === 'Assigned' && asset.assigned_employee_department) {
        const dept = asset.assigned_employee_department;
        const curr = deptMap.get(dept) ?? {
          department: dept,
          count: 0,
          value: 0,
        };
        curr.count += 1;
        curr.value += Number(asset.cost || 0);
        deptMap.set(dept, curr);
      }
    }
    const departmentBreakdown = Array.from(deptMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Asset acquisition trends grouped chronologically by quarter
    const acqMap = new Map<
      string,
      { period: string; sortKey: string; units: number; spend: number }
    >();
    for (const asset of assets) {
      if (!asset.purchase_date || asset.purchase_date.length < 7) continue;
      const year = asset.purchase_date.slice(0, 4);
      const monthNum = Number(asset.purchase_date.slice(5, 7));
      const quarter = Math.ceil(Math.max(1, Math.min(12, monthNum)) / 3);
      const sortKey = `${year}-Q${quarter}`;
      const curr = acqMap.get(sortKey) ?? {
        period: `Q${quarter} '${year.slice(2)}`,
        sortKey,
        units: 0,
        spend: 0,
      };
      curr.units += 1;
      curr.spend += Number(asset.cost || 0);
      acqMap.set(sortKey, curr);
    }
    const acquisitionTrend = Array.from(acqMap.values())
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .slice(-8);

    // Cumulative fleet growth series for real sparkline curves
    let runningUnits = 0;
    let runningSpend = 0;
    const cumulativeTrend = acquisitionTrend.map((pt) => {
      runningUnits += pt.units;
      runningSpend += pt.spend;
      return {
        period: pt.period,
        units: pt.units,
        cumulativeUnits: runningUnits,
        spend: pt.spend,
        cumulativeSpend: runningSpend,
      };
    });

    // Latest-period momentum delta
    const latestAcq = acquisitionTrend[acquisitionTrend.length - 1];
    const prevAcq = acquisitionTrend[acquisitionTrend.length - 2];
    const recentUnits = latestAcq?.units ?? 0;
    const acqDeltaPct =
      prevAcq && prevAcq.units > 0
        ? Math.round(((recentUnits - prevAcq.units) / prevAcq.units) * 100)
        : recentUnits > 0
          ? 100
          : 0;

    // Warranty & lifecycle compliance summary (active non-retired assets)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const dayMs = 1000 * 60 * 60 * 24;

    let warrantyHealthy = 0;
    let warrantyExpiring = 0;
    let warrantyExpired = 0;

    for (const asset of assets) {
      if (asset.status === 'Retired') continue;
      if (asset.warranty_expiry) {
        const expDays = Math.ceil(
          (new Date(`${asset.warranty_expiry}T00:00:00`).getTime() - todayMs) /
            dayMs
        );
        if (expDays < 0) warrantyExpired += 1;
        else if (expDays <= 45) warrantyExpiring += 1;
        else warrantyHealthy += 1;
      }
    }

    return {
      retiredCount,
      damagedCount,
      departmentBreakdown,
      acquisitionTrend,
      cumulativeTrend,
      recentUnits,
      acqDeltaPct,
      warrantyHealthy,
      warrantyExpiring,
      warrantyExpired,
    };
  }, [assets]);

  if (loading || !summary) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading dashboard">
        {/* Top Action Row Skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-2">
            <div className="h-6 w-48 rounded-lg av-shimmer" />
            <div className="h-3.5 w-72 rounded-md av-shimmer" />
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-32 rounded-xl av-shimmer" />
            <div className="h-9 w-32 rounded-xl av-shimmer" />
          </div>
        </div>

        {/* Bento Row 1 Skeleton */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          <div className="xl:col-span-7 flex flex-col gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-5"
                >
                  <div className="flex items-start justify-between">
                    <div className="h-10 w-10 rounded-xl av-shimmer" />
                    <div className="h-9 w-24 rounded-lg av-shimmer" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-24 rounded av-shimmer" />
                    <div className="h-7 w-28 rounded-md av-shimmer" />
                    <div className="h-3 w-36 rounded av-shimmer" />
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div
                  key={i}
                  className="h-20 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)] flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl av-shimmer" />
                    <div className="space-y-1.5">
                      <div className="h-3 w-24 rounded av-shimmer" />
                      <div className="h-2.5 w-32 rounded av-shimmer" />
                    </div>
                  </div>
                  <div className="h-7 w-10 rounded av-shimmer" />
                </div>
              ))}
            </div>
          </div>

          <div className="xl:col-span-5 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between min-h-[340px]">
            <div className="flex items-start justify-between">
              <div className="space-y-2">
                <div className="h-3.5 w-36 rounded av-shimmer" />
                <div className="h-7 w-32 rounded-md av-shimmer" />
              </div>
              <div className="h-7 w-24 rounded-lg av-shimmer" />
            </div>
            <div className="mt-6 h-56 w-full rounded-xl av-shimmer" />
          </div>
        </div>

        {/* Bento Row 2 Skeleton */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-5 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col items-center justify-between h-88">
            <div className="w-full flex justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-40 rounded av-shimmer" />
                <div className="h-3 w-28 rounded av-shimmer" />
              </div>
              <div className="h-6 w-6 rounded-md av-shimmer" />
            </div>
            <div className="h-44 w-44 rounded-full av-shimmer" />
            <div className="w-full grid grid-cols-4 gap-3 pt-3 border-t border-[var(--av-border-subtle)]">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 rounded-md av-shimmer" />
              ))}
            </div>
          </div>
          <div className="lg:col-span-7 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between h-88">
            <div className="space-y-1.5">
              <div className="h-4 w-48 rounded av-shimmer" />
              <div className="h-3 w-64 rounded av-shimmer" />
            </div>
            <div className="mt-4 h-64 w-full rounded-xl av-shimmer" />
          </div>
        </div>
      </div>
    );
  }

  const {
    counts,
    financials,
    categoryBreakdown,
    statusBreakdown,
    monthlyMaintenance,
  } = summary;

  const utilizationPct =
    counts.totalAssets > 0
      ? Math.round((counts.assignedAssets / counts.totalAssets) * 100)
      : 0;
  const availablePct =
    counts.totalAssets > 0
      ? Math.round((counts.availableAssets / counts.totalAssets) * 100)
      : 0;
  const avgAssetValue =
    counts.totalAssets > 0
      ? Math.round(financials.totalAssetValue / counts.totalAssets)
      : 0;

  // Real data series for the 4 sparkline KPI cards
  const totalAssetsSpark =
    analytics.cumulativeTrend.length >= 2
      ? analytics.cumulativeTrend.map((p) => ({ value: p.cumulativeUnits }))
      : categoryBreakdown.map((c) => ({ value: c.total }));

  const assignedSpark =
    categoryBreakdown.length >= 2
      ? categoryBreakdown.map((c) => ({ value: c.assigned }))
      : analytics.cumulativeTrend.map((p) => ({ value: p.units }));

  const availableSpark =
    categoryBreakdown.length >= 2
      ? categoryBreakdown.map((c) => ({ value: c.available }))
      : analytics.cumulativeTrend.map((p) => ({ value: p.units }));

  const valueSpark =
    analytics.cumulativeTrend.length >= 2
      ? analytics.cumulativeTrend.map((p) => ({ value: p.cumulativeSpend }))
      : categoryBreakdown.map((c) => ({ value: c.total }));

  const primaryKpis = [
    {
      label: 'Total Assets',
      value: counts.totalAssets,
      isCurrency: false,
      deltaPositive: true,
      deltaText: `${categoryBreakdown.length} hardware categories tracked`,
      icon: HardDrive,
      iconBg: 'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
      sparkData: totalAssetsSpark,
      sparkColor: '#F43F5E',
      sparkId: 'spark-total',
      target: 'assets' as NavSection,
    },
    {
      label: 'Assigned Assets',
      value: counts.assignedAssets,
      isCurrency: false,
      deltaPositive: true,
      deltaText: `${utilizationPct}% fleet utilization`,
      icon: UserCheck,
      iconBg: 'bg-blue-50 dark:bg-blue-500/15 text-[#3B66F6] dark:text-blue-400',
      sparkData: assignedSpark,
      sparkColor: '#1AB394',
      sparkId: 'spark-assigned',
      target: 'assignments' as NavSection,
    },
    {
      label: 'Available Assets',
      value: counts.availableAssets,
      isCurrency: false,
      deltaPositive: availablePct >= 15,
      deltaText: `${availablePct}% ready to deploy`,
      icon: CheckCircle2,
      iconBg: 'bg-emerald-50 dark:bg-emerald-500/15 text-[#1AB394] dark:text-emerald-400',
      sparkData: availableSpark,
      sparkColor: '#1AB394',
      sparkId: 'spark-available',
      target: 'assets' as NavSection,
    },
    {
      label: 'Total Asset Value',
      value: financials.totalAssetValue,
      isCurrency: true,
      deltaPositive: true,
      deltaText: `${formatCurrency(avgAssetValue)} avg per unit`,
      icon: DollarSign,
      iconBg: 'bg-violet-50 dark:bg-violet-500/15 text-violet-600 dark:text-violet-400',
      sparkData: valueSpark,
      sparkColor: '#3B66F6',
      sparkId: 'spark-value',
      target: 'reports' as NavSection,
    },
  ];

  const pieData = statusBreakdown.filter((item) => item.count > 0);
  const warrantyTotal =
    analytics.warrantyHealthy +
    analytics.warrantyExpiring +
    analytics.warrantyExpired;

  const maxDeptCount = Math.max(
    1,
    ...analytics.departmentBreakdown.map((d) => d.count)
  );

  const deptIconColors = [
    'bg-blue-50 dark:bg-blue-500/15 text-[#3B66F6]',
    'bg-teal-50 dark:bg-teal-500/15 text-[#1AB394]',
    'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400',
    'bg-indigo-50 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400',
    'bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400',
    'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  ];

  const renderDonutLabel = ({
    cx,
    cy,
    midAngle,
    innerRadius,
    outerRadius,
    percent,
  }: {
    cx?: number;
    cy?: number;
    midAngle?: number;
    innerRadius?: number;
    outerRadius?: number;
    percent?: number;
  }) => {
    if (
      cx === undefined ||
      cy === undefined ||
      midAngle === undefined ||
      innerRadius === undefined ||
      outerRadius === undefined ||
      percent === undefined ||
      percent < 0.08
    ) {
      return null;
    }
    const RADIAN = Math.PI / 180;
    const radius = innerRadius + (outerRadius - innerRadius) * 0.52;
    const x = cx + radius * Math.cos(-midAngle * RADIAN);
    const y = cy + radius * Math.sin(-midAngle * RADIAN);
    return (
      <text
        x={x}
        y={y}
        fill="#FFFFFF"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={11}
        fontWeight={600}
      >
        {`${Math.round(percent * 100)}%`}
      </text>
    );
  };

  return (
    <div className="space-y-6">
      {/* Compact Executive Title & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-[var(--av-text)]">
            IT Asset Overview
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[var(--av-text-subtle)] tabular-nums">
            Live portfolio across {counts.totalAssets} hardware units ·{' '}
            {counts.activeEmployees} active staff · {summary.unreadAlertsCount}{' '}
            open alerts
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => onNavigate('assignments')}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text-muted)] shadow-[var(--av-card-shadow)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--av-teal)]" />
            <span>New Handover</span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => onNavigate('assets')}
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white shadow-[0_6px_16px_-4px_var(--av-accent-shadow)] hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Register Asset</span>
          </motion.button>
        </div>
      </div>

      {/* BENTO ROW 1: 2x2 Sparkline KPI Grid + Secondary Status KPIs (7 cols) | Tall Acquisition Trend Chart (5 cols) */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-stretch">
        {/* Left 7 Columns: 2x2 Sparkline Cards + Maintenance/Retired Strip */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 flex-1">
            {primaryKpis.map((kpi, idx) => {
              const Icon = kpi.icon;
              return (
                <motion.div
                  key={kpi.label}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ y: -2 }}
                  transition={{
                    duration: 0.18,
                    delay: idx * 0.03,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                  onClick={() => onNavigate(kpi.target)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onNavigate(kpi.target);
                    }
                  }}
                  className="group cursor-pointer rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] hover:border-[var(--av-accent)]/40 transition-colors flex flex-col justify-between focus-visible:outline-2 focus-visible:outline-[var(--av-accent)]"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-transform duration-150 group-hover:scale-105 ${kpi.iconBg}`}
                    >
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex items-center gap-2">
                      <MiniSparkline
                        data={kpi.sparkData}
                        stroke={kpi.sparkColor}
                        gradientId={kpi.sparkId}
                      />
                      <span className="text-[var(--av-text-subtle)] group-hover:text-[var(--av-accent)] transition-colors">
                        <MoreHorizontal className="h-4 w-4" />
                      </span>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="text-xs font-medium text-[var(--av-text-subtle)]">
                      {kpi.label}
                    </div>
                    <div className="mt-1 font-display text-2xl sm:text-[26px] font-bold tracking-tight text-[var(--av-text)] tabular-nums">
                      <AnimatedNumber
                        value={kpi.value}
                        formatter={kpi.isCurrency ? formatCurrency : undefined}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-xs tabular-nums">
                      {kpi.deltaPositive ? (
                        <ArrowUpRight className="h-3.5 w-3.5 text-[#1AB394] shrink-0" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5 text-rose-500 shrink-0" />
                      )}
                      <span
                        className={`font-semibold ${
                          kpi.deltaPositive
                            ? 'text-[#1AB394]'
                            : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {kpi.deltaText}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Compact Bottom Pair for Maintenance & Retired Assets (completing all 6 executive KPIs) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onNavigate('maintenance')}
              className="group text-left rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] px-5 py-4 shadow-[var(--av-card-shadow)] hover:border-amber-500/40 transition-colors flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Wrench className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--av-text-subtle)]">
                    Under Maintenance
                  </div>
                  <div className="text-[11px] text-amber-600 dark:text-amber-400 font-medium mt-0.5 tabular-nums truncate">
                    {counts.openMaintenance} open service tickets
                  </div>
                </div>
              </div>
              <div className="font-display text-2xl font-bold text-[var(--av-text)] tabular-nums shrink-0">
                <AnimatedNumber value={counts.underMaintenance} />
              </div>
            </motion.button>

            <motion.button
              type="button"
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.99 }}
              onClick={() => onNavigate('assets')}
              className="group text-left rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] px-5 py-4 shadow-[var(--av-card-shadow)] hover:border-rose-500/40 transition-colors flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400">
                  <Archive className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-[var(--av-text-subtle)]">
                    Retired Assets
                  </div>
                  <div className="text-[11px] text-[var(--av-text-subtle)] mt-0.5 tabular-nums truncate">
                    {analytics.damagedCount > 0
                      ? `${analytics.damagedCount} damaged units`
                      : 'Decommissioned hardware'}
                  </div>
                </div>
              </div>
              <div className="font-display text-2xl font-bold text-[var(--av-text)] tabular-nums shrink-0">
                <AnimatedNumber value={analytics.retiredCount} />
              </div>
            </motion.button>
          </div>
        </div>

        {/* Right 5 Columns: Tall Primary Trend Card (Asset Acquisition Trends) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="xl:col-span-5 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between"
        >
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-[var(--av-text-subtle)]">
                  Asset Acquisition Trends
                </div>
                <div className="mt-1.5 flex items-baseline gap-2.5 flex-wrap">
                  <span className="font-display text-2xl sm:text-[28px] font-bold tracking-tight text-[var(--av-text)] tabular-nums">
                    {acqMetric === 'spend'
                      ? formatCurrency(financials.totalAssetValue)
                      : `${counts.totalAssets} Units`}
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-[#1AB394] tabular-nums">
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    {analytics.recentUnits} latest quarter
                  </span>
                </div>
              </div>

              <div className="inline-flex items-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] p-0.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setAcqMetric('spend')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    acqMetric === 'spend'
                      ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                      : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                  }`}
                >
                  Spend
                </button>
                <button
                  type="button"
                  onClick={() => setAcqMetric('units')}
                  className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                    acqMetric === 'units'
                      ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                      : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                  }`}
                >
                  Units
                </button>
              </div>
            </div>
          </div>

          <div className="mt-5 h-64 xl:h-[290px] w-full">
            {analytics.acquisitionTrend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--av-text-subtle)]">
                No purchase history available yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={analytics.acquisitionTrend}
                  margin={{ top: 10, right: 8, left: -12, bottom: 2 }}
                >
                  <defs>
                    <linearGradient id="acqBlueCurve" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B66F6" stopOpacity={0.26} />
                      <stop offset="95%" stopColor="#3B66F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={theme.gridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={acqMetric === 'spend'}
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) =>
                      acqMetric === 'spend'
                        ? `$${Math.round(Number(v) / 1000)}k`
                        : String(v)
                    }
                  />
                  <Tooltip
                    content={
                      <ChartTooltipCard
                        valueFormatter={(val) =>
                          acqMetric === 'spend'
                            ? formatCurrency(val)
                            : `${val} units`
                        }
                      />
                    }
                  />
                  <Area
                    type="monotone"
                    dataKey={acqMetric}
                    name={acqMetric === 'spend' ? 'Capital Spend' : 'Units Acquired'}
                    stroke="#3B66F6"
                    strokeWidth={2.5}
                    fillOpacity={1}
                    fill="url(#acqBlueCurve)"
                    activeDot={{
                      r: 5,
                      strokeWidth: 2,
                      stroke: '#FFFFFF',
                      fill: '#3B66F6',
                    }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      {/* BENTO ROW 2: Signature Rounded Segmented Donut (5 cols) | Asset Distribution by Category (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Signature Rounded Segmented Donut Card ("Asset Status Overview") */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-5 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                Asset Status Overview
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Live operational fleet readiness
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('assets')}
              aria-label="Inspect asset statuses"
              className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>

          <div className="relative h-64 w-full my-2">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--av-text-subtle)]">
                No status data available yet.
              </div>
            ) : (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="count"
                      nameKey="status"
                      cx="50%"
                      cy="50%"
                      innerRadius={64}
                      outerRadius={98}
                      cornerRadius={8}
                      paddingAngle={5}
                      stroke="none"
                      labelLine={false}
                      label={renderDonutLabel}
                    >
                      {pieData.map((entry) => (
                        <Cell
                          key={entry.status}
                          fill={statusColors[entry.status] || '#64748B'}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltipCard />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex h-26 w-26 flex-col items-center justify-center rounded-full bg-[var(--av-surface)] shadow-[0_6px_22px_rgba(15,23,42,0.08)]">
                    <span className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                      Total Assets
                    </span>
                    <span className="font-display text-2xl font-bold text-[var(--av-text)] tabular-nums mt-0.5">
                      <AnimatedNumber value={counts.totalAssets} />
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Horizontal Bottom Swatch Legend (matching reference "Uses Device" legend) */}
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 pt-3 border-t border-[var(--av-border-subtle)]">
            {statusBreakdown.map((item) => (
              <div key={item.status} className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-xs shrink-0"
                    style={{
                      backgroundColor: statusColors[item.status] || '#64748B',
                    }}
                  />
                  <span className="font-display text-sm font-bold text-[var(--av-text)] tabular-nums">
                    {item.count}
                  </span>
                </div>
                <div className="text-[11px] text-[var(--av-text-subtle)] truncate mt-0.5">
                  {item.status === 'Under Maintenance' ? 'Maint.' : item.status}
                </div>
              </div>
            ))}
          </div>
        </motion.div>

        {/* Asset Distribution by Category (7 cols) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-7 rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                Asset Distribution by Category
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Assigned, available, and maintenance units across hardware classes
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--av-text-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#3B66F6]" />
                <span>Assigned</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#1AB394]" />
                <span>Available</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#E9913A]" />
                <span>Maint.</span>
              </span>
            </div>
          </div>

          <div className="mt-4 h-72 w-full">
            {categoryBreakdown.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <p className="text-sm font-semibold text-[var(--av-text)]">
                  No IT equipment recorded yet
                </p>
                <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
                  Register assets in Asset Inventory to populate category analytics.
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryBreakdown}
                  margin={{ top: 8, right: 10, left: -18, bottom: 18 }}
                  barSize={26}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={theme.gridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={false}
                    tickLine={false}
                    interval={0}
                    angle={-14}
                    textAnchor="end"
                    height={46}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    cursor={{
                      fill: theme.isDark
                        ? 'rgba(255, 255, 255, 0.04)'
                        : 'rgba(15, 23, 42, 0.04)',
                    }}
                    content={<ChartTooltipCard />}
                  />
                  <Bar
                    dataKey="assigned"
                    name="Assigned"
                    stackId="a"
                    fill="#3B66F6"
                  />
                  <Bar
                    dataKey="available"
                    name="Available"
                    stackId="a"
                    fill="#1AB394"
                  />
                  <Bar
                    dataKey="maintenance"
                    name="Maintenance"
                    stackId="a"
                    fill="#E9913A"
                    radius={[5, 5, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      {/* BENTO ROW 3: Department Allocation (Ranked Icon List) + Maintenance & Warranty Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Department Allocation (styled after reference right-hand list card) */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                Asset Allocation by Department
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Active hardware custody and valuation per team
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('employees')}
              className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
              aria-label="Open employees directory"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 divide-y divide-[var(--av-border-subtle)]">
            {analytics.departmentBreakdown.length === 0 ? (
              <div className="py-12 text-center text-xs text-[var(--av-text-subtle)]">
                No department assignments recorded yet.
              </div>
            ) : (
              analytics.departmentBreakdown.map((dept, index) => {
                const widthPct = Math.max(
                  8,
                  Math.round((dept.count / maxDeptCount) * 100)
                );
                return (
                  <div
                    key={dept.department}
                    className="py-3 flex items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                          deptIconColors[index % deptIconColors.length]
                        }`}
                      >
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                          {dept.department}
                        </div>
                        <div className="mt-1.5 h-1.5 w-full max-w-[180px] rounded-full bg-[var(--av-surface-muted)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#3B66F6]"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0 tabular-nums">
                      <div className="font-mono text-xs font-bold text-[var(--av-text)]">
                        {dept.count} units
                      </div>
                      <div className="text-[11px] text-[var(--av-text-subtle)]">
                        {formatCurrency(dept.value)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>

        {/* Maintenance & Warranty Overview */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
              <div>
                <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Maintenance &amp; Warranty Overview
                </h2>
                <p className="text-xs text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                  {formatCurrency(financials.totalMaintenanceCost)} logged service
                  expenditure
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('maintenance')}
                className="text-xs font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
              >
                Service log
              </button>
            </div>

            <div className="mt-4 h-44 w-full">
              {monthlyMaintenance.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-[var(--av-text-subtle)]">
                  No maintenance spend logged yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={monthlyMaintenance}
                    margin={{ top: 8, right: 8, left: -16, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="maintMintGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#1AB394" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#1AB394" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={theme.gridStroke}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: theme.tickColor }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: theme.tickColor }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={
                        <ChartTooltipCard
                          valueFormatter={(val) => formatCurrency(val)}
                        />
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      name="Service Cost"
                      stroke="#1AB394"
                      strokeWidth={2.2}
                      fillOpacity={1}
                      fill="url(#maintMintGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-[var(--av-border-subtle)] pt-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-[var(--av-text-muted)]">
                <ShieldAlert className="h-3.5 w-3.5 text-[#1AB394]" />
                <span>Warranty Coverage Health</span>
              </span>
              <span className="font-mono text-[11px] text-[var(--av-text-subtle)] tabular-nums">
                {warrantyTotal} active units
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2.5 text-xs tabular-nums">
              <div className="rounded-xl bg-emerald-50 dark:bg-emerald-500/10 px-3 py-2.5">
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  Healthy
                </div>
                <div className="font-mono text-base font-bold text-emerald-800 dark:text-emerald-300 mt-0.5">
                  {analytics.warrantyHealthy}
                </div>
              </div>
              <div className="rounded-xl bg-amber-50 dark:bg-amber-500/10 px-3 py-2.5">
                <div className="text-[11px] text-amber-700 dark:text-amber-400">
                  Expiring
                </div>
                <div className="font-mono text-base font-bold text-amber-800 dark:text-amber-300 mt-0.5">
                  {analytics.warrantyExpiring}
                </div>
              </div>
              <div className="rounded-xl bg-rose-50 dark:bg-rose-500/10 px-3 py-2.5">
                <div className="text-[11px] text-rose-700 dark:text-rose-400">
                  Expired
                </div>
                <div className="font-mono text-base font-bold text-rose-800 dark:text-rose-300 mt-0.5">
                  {analytics.warrantyExpired}
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* BENTO ROW 4: Action Required Alerts + Recent Custody Handovers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Action Required Alerts */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                Action Required Alerts
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                {summary.unreadAlertsCount} unacknowledged alerts
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="text-xs font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
            >
              View all
            </button>
          </div>
          <div className="mt-1 divide-y divide-[var(--av-border-subtle)]">
            {summary.criticalAlerts.length === 0 ? (
              <p className="py-10 text-center text-xs text-[var(--av-text-subtle)]">
                No active warranty, maintenance, or replacement alerts.
              </p>
            ) : (
              summary.criticalAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="py-3.5 flex items-start gap-3.5 group"
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                      alert.severity === 'critical'
                        ? 'bg-rose-50 dark:bg-rose-500/15 text-rose-600 dark:text-rose-400'
                        : 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenAsset(alert.asset_id)}
                      className="text-left text-xs font-semibold text-[var(--av-text)] group-hover:text-[var(--av-accent)] truncate block w-full transition-colors"
                    >
                      {alert.title}
                    </button>
                    <p className="mt-0.5 text-xs text-[var(--av-text-subtle)] line-clamp-2 leading-relaxed">
                      {alert.description}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>

        {/* Recent Handovers */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.36, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                Recent Custody Handovers
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Latest equipment issues and returns
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('assignments')}
              className="text-xs font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
            >
              All handovers
            </button>
          </div>
          <div className="mt-1 divide-y divide-[var(--av-border-subtle)]">
            {summary.recentAssignments.length === 0 ? (
              <p className="py-10 text-center text-xs text-[var(--av-text-subtle)]">
                No asset handovers recorded yet.
              </p>
            ) : (
              summary.recentAssignments.map((asg) => (
                <div
                  key={asg.id}
                  className="py-3.5 flex items-center justify-between gap-3 group"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenAsset(asg.asset_id)}
                      className="text-xs font-semibold text-[var(--av-text)] group-hover:text-[var(--av-accent)] truncate block transition-colors text-left"
                    >
                      {asg.asset_tag} · {asg.asset_name}
                    </button>
                    <p className="mt-0.5 text-xs text-[var(--av-text-subtle)] truncate">
                      {asg.employee_name} · {asg.employee_department}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-xs font-semibold ${
                        asg.status === 'Active'
                          ? 'text-[var(--av-accent)]'
                          : 'text-[var(--av-text-subtle)]'
                      }`}
                    >
                      {asg.status}
                    </span>
                    <div className="text-[11px] font-mono text-[var(--av-text-subtle)] tabular-nums mt-0.5">
                      {asg.assigned_date}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
