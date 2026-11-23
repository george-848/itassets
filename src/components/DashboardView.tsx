import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  Archive,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  DollarSign,
  HardDrive,
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
    <div className="rounded-lg border border-white/10 bg-[#111827]/95 px-3 py-2 text-xs text-white shadow-lg backdrop-blur-md">
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
                style={{ backgroundColor: entry.color || '#3B82F6' }}
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

export function DashboardView({
  summary,
  assets,
  loading,
  onNavigate,
  onOpenAsset,
}: DashboardViewProps) {
  const { theme } = useTheme();

  const statusColors: Record<string, string> = {
    Assigned: '#3B82F6',
    Available: '#10B981',
    'Under Maintenance': '#F59E0B',
    Damaged: '#EF4444',
    Retired: '#64748B',
  };

  // Real live computations from loaded inventory
  const analytics = useMemo(() => {
    const retiredCount = assets.filter((a) => a.status === 'Retired').length;
    const damagedCount = assets.filter((a) => a.status === 'Damaged').length;

    // Asset allocation by department (from currently assigned assets)
    const deptMap = new Map<string, { department: string; count: number; value: number }>();
    for (const asset of assets) {
      if (asset.status === 'Assigned' && asset.assigned_employee_department) {
        const dept = asset.assigned_employee_department;
        const curr = deptMap.get(dept) ?? { department: dept, count: 0, value: 0 };
        curr.count += 1;
        curr.value += Number(asset.cost || 0);
        deptMap.set(dept, curr);
      }
    }
    const departmentBreakdown = Array.from(deptMap.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);

    // Asset acquisition trends (grouped by purchase quarter/year chronologically)
    const acqMap = new Map<string, { period: string; sortKey: string; units: number; spend: number }>();
    for (const asset of assets) {
      if (!asset.purchase_date || asset.purchase_date.length < 7) continue;
      const year = asset.purchase_date.slice(0, 4);
      const monthNum = Number(asset.purchase_date.slice(5, 7));
      const quarter = Math.ceil(Math.max(1, Math.min(12, monthNum)) / 3);
      const sortKey = `${year}-Q${quarter}`;
      const curr = acqMap.get(sortKey) ?? {
        period: `${year} Q${quarter}`,
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

    // Warranty & lifecycle compliance summary (active non-retired assets)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const dayMs = 1000 * 60 * 60 * 24;

    let warrantyHealthy = 0;
    let warrantyExpiring = 0;
    let warrantyExpired = 0;
    let refreshDue = 0;

    for (const asset of assets) {
      if (asset.status === 'Retired') continue;
      if (asset.warranty_expiry) {
        const expDays = Math.ceil(
          (new Date(`${asset.warranty_expiry}T00:00:00`).getTime() - todayMs) / dayMs
        );
        if (expDays < 0) warrantyExpired += 1;
        else if (expDays <= 45) warrantyExpiring += 1;
        else warrantyHealthy += 1;
      }
      if (asset.purchase_date) {
        const ageYears =
          (todayMs - new Date(`${asset.purchase_date}T00:00:00`).getTime()) /
          (dayMs * 365.25);
        if (ageYears >= 4 || asset.status === 'Damaged') refreshDue += 1;
      }
    }

    return {
      retiredCount,
      damagedCount,
      departmentBreakdown,
      acquisitionTrend,
      warrantyHealthy,
      warrantyExpiring,
      warrantyExpired,
      refreshDue,
    };
  }, [assets]);

  if (loading || !summary) {
    return (
      <div className="space-y-6">
        <div className="h-24 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 animate-pulse"
            >
              <div className="h-3 w-20 bg-[var(--av-surface-muted)] rounded" />
              <div className="mt-4 h-6 w-16 bg-[var(--av-surface-muted)] rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 h-80 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] animate-pulse" />
          <div className="h-80 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] animate-pulse" />
        </div>
      </div>
    );
  }

  const { counts, financials, categoryBreakdown, statusBreakdown, monthlyMaintenance } =
    summary;

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

  const kpis = [
    {
      label: 'Total Assets',
      value: counts.totalAssets,
      isCurrency: false,
      sub: `${categoryBreakdown.length} equipment classes`,
      icon: HardDrive,
      iconClass: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200',
      target: 'assets' as NavSection,
    },
    {
      label: 'Assigned Assets',
      value: counts.assignedAssets,
      isCurrency: false,
      sub: `${utilizationPct}% fleet utilization`,
      icon: UserCheck,
      iconClass: 'bg-blue-50 dark:bg-blue-500/15 text-blue-600 dark:text-blue-400',
      target: 'assignments' as NavSection,
    },
    {
      label: 'Available Assets',
      value: counts.availableAssets,
      isCurrency: false,
      sub: `${availablePct}% ready to deploy`,
      icon: CheckCircle2,
      iconClass: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      target: 'assets' as NavSection,
    },
    {
      label: 'Under Maintenance',
      value: counts.underMaintenance,
      isCurrency: false,
      sub: `${counts.openMaintenance} open service tickets`,
      icon: Wrench,
      iconClass: 'bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400',
      target: 'maintenance' as NavSection,
    },
    {
      label: 'Retired Assets',
      value: analytics.retiredCount,
      isCurrency: false,
      sub:
        analytics.damagedCount > 0
          ? `${analytics.damagedCount} damaged units`
          : 'Decommissioned inventory',
      icon: Archive,
      iconClass: 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400',
      target: 'assets' as NavSection,
    },
    {
      label: 'Total Asset Value',
      value: financials.totalAssetValue,
      isCurrency: true,
      sub: `${formatCurrency(avgAssetValue)} avg per unit`,
      icon: DollarSign,
      iconClass: 'bg-teal-50 dark:bg-teal-500/15 text-teal-600 dark:text-teal-400',
      target: 'reports' as NavSection,
    },
  ];

  const pieData = statusBreakdown.filter((item) => item.count > 0);
  const warrantyTotal =
    analytics.warrantyHealthy +
    analytics.warrantyExpiring +
    analytics.warrantyExpired;

  return (
    <div className="space-y-6">
      {/* Executive Header Strip */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] px-5 py-4 shadow-[var(--av-card-shadow)]"
      >
        <div>
          <h1 className="font-display text-lg sm:text-xl font-bold tracking-tight text-[var(--av-text)]">
            Executive IT Asset Overview
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-[var(--av-text-subtle)] tabular-nums">
            Live portfolio governance across {counts.totalAssets} hardware units,{' '}
            {counts.activeEmployees} active employees, and{' '}
            {summary.unreadAlertsCount} compliance alerts.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => onNavigate('assignments')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap shrink-0"
          >
            <ArrowLeftRight className="h-3.5 w-3.5 text-[var(--av-teal)]" />
            <span>New Handover</span>
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => onNavigate('assets')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Register Asset</span>
          </motion.button>
        </div>
      </motion.section>

      {/* 6 Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.button
              key={kpi.label}
              type="button"
              onClick={() => onNavigate(kpi.target)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.99 }}
              transition={{
                duration: 0.18,
                delay: idx * 0.03,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="group text-left rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 flex flex-col justify-between shadow-[var(--av-card-shadow)] hover:border-[var(--av-accent)]/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 w-full">
                <span className="text-xs font-medium text-[var(--av-text-subtle)] truncate">
                  {kpi.label}
                </span>
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-transform duration-150 group-hover:scale-105 ${kpi.iconClass}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3 w-full">
                <div className="flex items-baseline justify-between gap-1.5">
                  <div className="font-display text-xl sm:text-2xl font-bold text-[var(--av-text)] tabular-nums tracking-tight">
                    <AnimatedNumber
                      value={kpi.value}
                      formatter={kpi.isCurrency ? formatCurrency : undefined}
                    />
                  </div>
                  <ArrowUpRight className="h-3.5 w-3.5 text-[var(--av-text-subtle)] opacity-40 group-hover:opacity-100 group-hover:text-[var(--av-accent)] transition-all shrink-0" />
                </div>
                <div className="mt-1 text-[11px] text-[var(--av-text-subtle)] tabular-nums truncate">
                  {kpi.sub}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Row 1: Category Distribution + Status Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="lg:col-span-2 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
                Asset Distribution by Category
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Assigned, available, and in-maintenance units across hardware classes
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 text-xs text-[var(--av-text-muted)]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#3B82F6]" />
                  <span>Assigned</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#14B8A6]" />
                  <span>Available</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-xs bg-[#F59E0B]" />
                  <span>Maintenance</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('assets')}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
              >
                <span>View inventory</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
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
                  barSize={24}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={theme.gridStroke}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={{ stroke: theme.gridStroke }}
                    tickLine={false}
                    interval={0}
                    angle={-16}
                    textAnchor="end"
                    height={48}
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
                    fill="#3B82F6"
                  />
                  <Bar
                    dataKey="available"
                    name="Available"
                    stackId="a"
                    fill="#14B8A6"
                  />
                  <Bar
                    dataKey="maintenance"
                    name="Maintenance"
                    stackId="a"
                    fill="#F59E0B"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 flex flex-col justify-between shadow-[var(--av-card-shadow)]"
        >
          <div className="border-b border-[var(--av-border-subtle)] pb-4">
            <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
              Asset Status Overview
            </h2>
            <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
              Operational fleet readiness breakdown
            </p>
          </div>

          <div className="relative h-52 w-full mt-2">
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
                      innerRadius={58}
                      outerRadius={80}
                      cornerRadius={3}
                      paddingAngle={3}
                      stroke="none"
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
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-display text-2xl font-bold text-[var(--av-text)] tabular-nums">
                    <AnimatedNumber value={counts.totalAssets} />
                  </span>
                  <span className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                    Total Units
                  </span>
                </div>
              </>
            )}
          </div>

          <div className="mt-2 space-y-2 border-t border-[var(--av-border-subtle)] pt-3.5">
            {statusBreakdown.map((item) => {
              const pct =
                counts.totalAssets > 0
                  ? Math.round((item.count / counts.totalAssets) * 100)
                  : 0;
              return (
                <div
                  key={item.status}
                  className="flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-2 text-[var(--av-text-muted)]">
                    <span
                      className="h-2.5 w-2.5 rounded-xs shrink-0"
                      style={{
                        backgroundColor: statusColors[item.status] || '#64748B',
                      }}
                    />
                    <span>{item.status}</span>
                  </div>
                  <div className="flex items-center gap-2 tabular-nums">
                    <span className="text-[11px] text-[var(--av-text-subtle)]">
                      {pct}%
                    </span>
                    <span className="font-mono font-semibold text-[var(--av-text)] min-w-[1.5rem] text-right">
                      {item.count}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Row 2: Asset Allocation by Department + Asset Acquisition Trends */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
                Asset Allocation by Department
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Active hardware custody distribution across teams
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('employees')}
              className="text-xs font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
            >
              Departments
            </button>
          </div>

          <div className="mt-4 h-64 w-full">
            {analytics.departmentBreakdown.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--av-text-subtle)]">
                No department assignments recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={analytics.departmentBreakdown}
                  layout="vertical"
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  barSize={16}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={theme.gridStroke}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="department"
                    width={126}
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
                    dataKey="count"
                    name="Assigned Units"
                    fill="#3B82F6"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
                Asset Acquisition Trends
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                Quarterly procurement capital expenditure ({formatCurrency(financials.totalAssetValue)} total)
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('reports')}
              className="text-xs font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
            >
              Export audit
            </button>
          </div>

          <div className="mt-4 h-64 w-full">
            {analytics.acquisitionTrend.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-[var(--av-text-subtle)]">
                No purchase date history available yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={analytics.acquisitionTrend}
                  margin={{ top: 8, right: 10, left: -8, bottom: 4 }}
                >
                  <defs>
                    <linearGradient id="acqSpendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.28} />
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
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
                    axisLine={{ stroke: theme.gridStroke }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: theme.tickColor }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`}
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
                    dataKey="spend"
                    name="Acquisition Spend"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#acqSpendGrad)"
                    activeDot={{ r: 4, strokeWidth: 2, stroke: '#FFFFFF', fill: '#3B82F6' }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      </div>

      {/* Row 3: Maintenance & Warranty Overview + Alerts & Recent Handovers */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Maintenance & Warranty Overview */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between"
        >
          <div>
            <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
              <div>
                <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
                  Maintenance & Warranty Overview
                </h2>
                <p className="text-xs text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                  {formatCurrency(financials.totalMaintenanceCost)} logged service spend
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
                      <linearGradient id="maintTealGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#14B8A6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#14B8A6" stopOpacity={0} />
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
                      axisLine={{ stroke: theme.gridStroke }}
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
                      stroke="#14B8A6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#maintTealGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div className="mt-4 border-t border-[var(--av-border-subtle)] pt-3.5 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-medium text-[var(--av-text-muted)]">
                <ShieldAlert className="h-3.5 w-3.5 text-[var(--av-teal)]" />
                <span>Warranty Coverage Health</span>
              </span>
              <span className="font-mono text-[11px] text-[var(--av-text-subtle)] tabular-nums">
                {warrantyTotal} active units
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs tabular-nums">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-500/10 px-2.5 py-2">
                <div className="text-[11px] text-emerald-700 dark:text-emerald-400">
                  Healthy
                </div>
                <div className="font-mono font-bold text-emerald-800 dark:text-emerald-300 mt-0.5">
                  {analytics.warrantyHealthy}
                </div>
              </div>
              <div className="rounded-lg bg-amber-50 dark:bg-amber-500/10 px-2.5 py-2">
                <div className="text-[11px] text-amber-700 dark:text-amber-400">
                  Expiring
                </div>
                <div className="font-mono font-bold text-amber-800 dark:text-amber-300 mt-0.5">
                  {analytics.warrantyExpiring}
                </div>
              </div>
              <div className="rounded-lg bg-red-50 dark:bg-red-500/10 px-2.5 py-2">
                <div className="text-[11px] text-red-700 dark:text-red-400">
                  Expired
                </div>
                <div className="font-mono font-bold text-red-800 dark:text-red-300 mt-0.5">
                  {analytics.warrantyExpired}
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Action Required Alerts */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
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
              <p className="py-12 text-center text-xs text-[var(--av-text-subtle)]">
                No active warranty, maintenance, or replacement alerts.
              </p>
            ) : (
              summary.criticalAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="py-3.5 flex items-start gap-3 group"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      alert.severity === 'critical'
                        ? 'bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400'
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
          transition={{ duration: 0.2, delay: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--av-border-subtle)] pb-4">
            <div>
              <h2 className="font-display text-sm font-semibold text-[var(--av-text)]">
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
              <p className="py-12 text-center text-xs text-[var(--av-text-subtle)]">
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
