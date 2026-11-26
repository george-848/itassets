import { useMemo } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Database, HardDrive, Users } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { ExtendedTenantContext } from '../lib/api.ts';
import { useTheme } from '../lib/theme.tsx';
import type { NavSection } from './DashboardView.tsx';

interface UsageAnalyticsWidgetProps {
  tenantCtx: ExtendedTenantContext;
  onNavigate: (section: NavSection) => void;
}

interface QuotaRowData {
  key: 'assets' | 'users' | 'storage';
  label: string;
  usedDisplay: string;
  limitDisplay: string;
  remainingDisplay: string;
  pct: number | null;
  chartPct: number;
  statusLabel: string;
  barColor: string;
  statusTextColor: string;
  targetSection?: NavSection;
  actionLabel?: string;
}

function formatStorageBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatStorageLimitMb(limitMb: number | null | undefined): string {
  if (limitMb === null || limitMb === undefined) return 'Unlimited';
  if (limitMb >= 1024) {
    const gb = limitMb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${limitMb} MB`;
}

function getQuotaStatus(pct: number | null): {
  statusLabel: string;
  barColor: string;
  statusTextColor: string;
} {
  if (pct === null) {
    return {
      statusLabel: 'Unlimited',
      barColor: '#1AB394',
      statusTextColor: 'text-[#1AB394]',
    };
  }
  if (pct >= 90) {
    return {
      statusLabel: pct >= 100 ? 'Quota reached' : 'Critical',
      barColor: '#DC2626',
      statusTextColor: 'text-rose-600 dark:text-rose-400',
    };
  }
  if (pct >= 75) {
    return {
      statusLabel: 'Approaching limit',
      barColor: '#D97706',
      statusTextColor: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    statusLabel: 'Nominal',
    barColor: '#3B66F6',
    statusTextColor: 'text-[var(--av-text-subtle)]',
  };
}

function QuotaTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    payload?: {
      label: string;
      usedDisplay: string;
      limitDisplay: string;
      pct: number | null;
      statusLabel: string;
    };
  }>;
}) {
  if (!active || !payload || payload.length === 0 || !payload[0]?.payload) {
    return null;
  }
  const item = payload[0].payload;
  return (
    <div className="rounded-xl border border-white/10 bg-[#080D21]/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-md">
      <div className="mb-1 font-display font-semibold text-slate-200 border-b border-white/10 pb-1">
        {item.label}
      </div>
      <div className="space-y-0.5 tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-300">Consumed</span>
          <span className="font-mono font-semibold text-white">
            {item.usedDisplay} / {item.limitDisplay}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-300">Utilization</span>
          <span className="font-mono font-semibold text-white">
            {item.pct === null ? 'Unlimited' : `${item.pct}%`} · {item.statusLabel}
          </span>
        </div>
      </div>
    </div>
  );
}

export function UsageAnalyticsWidget({
  tenantCtx,
  onNavigate,
}: UsageAnalyticsWidgetProps) {
  const { theme } = useTheme();
  const { plan, subscription, effectiveLimits, usage, permissions } = tenantCtx;

  const canReadBilling = permissions.includes('billing.read');
  const canReadAssets = permissions.includes('assets.read');
  const canReadUsers = permissions.includes('users.manage');

  const rows = useMemo<QuotaRowData[]>(() => {
    // 1. Assets quota
    const maxAssets = effectiveLimits.maxAssets ?? null;
    const assetsPct =
      maxAssets === null
        ? null
        : Math.min(100, Math.round((usage.assetsCount / Math.max(1, maxAssets)) * 100));
    const assetsStatus = getQuotaStatus(assetsPct);
    const assetsRemaining =
      maxAssets === null ? null : Math.max(0, maxAssets - usage.assetsCount);

    // 2. Users quota
    const maxUsers = effectiveLimits.maxUsers ?? null;
    const usersPct =
      maxUsers === null
        ? null
        : Math.min(100, Math.round((usage.usersCount / Math.max(1, maxUsers)) * 100));
    const usersStatus = getQuotaStatus(usersPct);
    const usersRemaining =
      maxUsers === null ? null : Math.max(0, maxUsers - usage.usersCount);

    // 3. Storage quota
    const storageUsedBytes = usage.storageUsedBytes ?? 0;
    const maxStorageMb = effectiveLimits.maxStorageMb ?? null;
    const maxStorageBytes =
      maxStorageMb === null ? null : maxStorageMb * 1024 * 1024;
    const storagePct =
      maxStorageBytes === null
        ? null
        : Math.min(
            100,
            Math.round((storageUsedBytes / Math.max(1, maxStorageBytes)) * 100)
          );
    const storageStatus = getQuotaStatus(storagePct);
    const storageRemainingBytes =
      maxStorageBytes === null ? null : Math.max(0, maxStorageBytes - storageUsedBytes);

    return [
      {
        key: 'assets',
        label: 'Assets',
        usedDisplay: usage.assetsCount.toLocaleString(),
        limitDisplay: maxAssets === null ? 'Unlimited' : maxAssets.toLocaleString(),
        remainingDisplay:
          assetsRemaining === null
            ? 'No asset ceiling on this plan'
            : `${assetsRemaining.toLocaleString()} remaining`,
        pct: assetsPct,
        chartPct: assetsPct ?? 12,
        ...assetsStatus,
        targetSection: canReadAssets ? 'assets' : undefined,
        actionLabel: canReadAssets ? 'Inventory' : undefined,
      },
      {
        key: 'users',
        label: 'Users',
        usedDisplay: usage.usersCount.toLocaleString(),
        limitDisplay: maxUsers === null ? 'Unlimited' : maxUsers.toLocaleString(),
        remainingDisplay:
          usersRemaining === null
            ? 'No seat ceiling on this plan'
            : `${usersRemaining.toLocaleString()} seats remaining`,
        pct: usersPct,
        chartPct: usersPct ?? 12,
        ...usersStatus,
        targetSection: canReadUsers ? 'users' : undefined,
        actionLabel: canReadUsers ? 'Team' : undefined,
      },
      {
        key: 'storage',
        label: 'Storage',
        usedDisplay: formatStorageBytes(storageUsedBytes),
        limitDisplay: formatStorageLimitMb(maxStorageMb),
        remainingDisplay:
          storageRemainingBytes === null
            ? 'No attachment storage ceiling'
            : `${formatStorageBytes(storageRemainingBytes)} available`,
        pct: storagePct,
        chartPct: storagePct ?? 12,
        ...storageStatus,
        targetSection: canReadBilling ? 'billing' : undefined,
        actionLabel: canReadBilling ? 'Quotas' : undefined,
      },
    ];
  }, [
    canReadAssets,
    canReadBilling,
    canReadUsers,
    effectiveLimits.maxAssets,
    effectiveLimits.maxStorageMb,
    effectiveLimits.maxUsers,
    usage.assetsCount,
    usage.storageUsedBytes,
    usage.usersCount,
  ]);

  const anyLimitedQuota = rows.some((r) => r.pct !== null);
  const highestPressure = rows.reduce<QuotaRowData | null>((highest, row) => {
    if (row.pct === null) return highest;
    if (!highest || highest.pct === null || row.pct > highest.pct) return row;
    return highest;
  }, null);

  const subscriptionStatusLabel = subscription.status.replace('_', ' ');
  const billingCycleLabel =
    subscription.billingCycle === 'annual' ? 'Annual billing' : 'Monthly billing';

  const rowIcon = (key: QuotaRowData['key']) => {
    if (key === 'assets') return <HardDrive className="h-4 w-4 text-[#3B66F6]" />;
    if (key === 'users') return <Users className="h-4 w-4 text-[#1AB394]" />;
    return <Database className="h-4 w-4 text-indigo-500" />;
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
      aria-labelledby="usage-analytics-heading"
      className="rounded-2xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
    >
      {/* Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--av-border-subtle)] pb-4">
        <div>
          <h2
            id="usage-analytics-heading"
            className="font-display text-base font-semibold text-[var(--av-text)]"
          >
            Usage Analytics
          </h2>
          <p className="mt-0.5 text-xs text-[var(--av-text-subtle)] capitalize">
            {plan.name} plan · {billingCycleLabel.toLowerCase()} · {subscriptionStatusLabel}
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {highestPressure && highestPressure.pct !== null && (
            <div className="text-right tabular-nums hidden sm:block">
              <div className="text-[11px] text-[var(--av-text-subtle)]">
                Peak utilization
              </div>
              <div className="font-mono text-xs font-semibold text-[var(--av-text)]">
                {highestPressure.label} ({highestPressure.pct}%)
              </div>
            </div>
          )}

          {canReadBilling && (
            <button
              type="button"
              onClick={() => onNavigate('billing')}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text)] hover:border-[var(--av-accent)]/40 hover:text-[var(--av-accent)] transition-colors whitespace-nowrap shrink-0"
            >
              <span>
                {highestPressure && (highestPressure.pct ?? 0) >= 85
                  ? 'Upgrade Plan'
                  : 'Manage Plan'}
              </span>
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body Grid: Quota Consumption Meters (7 cols) | Plan Utilization Chart (5 cols) */}
      <div className="mt-5 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Left: Assets, Users, Storage Quota Rows */}
        <div className="lg:col-span-7 divide-y divide-[var(--av-border-subtle)]">
          {rows.map((row) => {
            const barWidthPct = row.pct === null ? 18 : Math.max(row.pct > 0 ? 3 : 0, row.pct);
            return (
              <div key={row.key} className="py-3.5 first:pt-0 last:pb-0 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--av-surface-muted)]">
                      {rowIcon(row.key)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--av-text)]">
                          {row.label}
                        </span>
                        <span className="text-[11px] text-[var(--av-text-subtle)]" aria-hidden="true">
                          ·
                        </span>
                        <span className={`text-[11px] font-medium ${row.statusTextColor}`}>
                          {row.statusLabel}
                        </span>
                      </div>
                      <div className="text-[11px] text-[var(--av-text-subtle)] tabular-nums truncate">
                        {row.remainingDisplay}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 tabular-nums">
                    <div className="font-mono text-sm font-bold text-[var(--av-text)]">
                      {row.usedDisplay}
                      <span className="text-xs font-normal text-[var(--av-text-subtle)]">
                        {' '}
                        / {row.limitDisplay}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-[var(--av-text-subtle)]">
                      {row.pct === null ? 'No cap' : `${row.pct}% of limit`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div
                    className="h-2 flex-1 rounded-full bg-[var(--av-surface-muted)] overflow-hidden"
                    role="progressbar"
                    aria-label={`${row.label} quota usage`}
                    aria-valuenow={row.pct ?? 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-300"
                      style={{
                        width: `${barWidthPct}%`,
                        backgroundColor: row.barColor,
                      }}
                    />
                  </div>

                  {row.targetSection && row.actionLabel && (
                    <button
                      type="button"
                      onClick={() => onNavigate(row.targetSection!)}
                      className="text-[11px] font-semibold text-[var(--av-accent)] hover:underline whitespace-nowrap shrink-0"
                    >
                      {row.actionLabel}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Right: Quota Consumption Chart & Secondary Workspace Footnotes */}
        <div className="lg:col-span-5 flex flex-col justify-between lg:border-l lg:border-[var(--av-border-subtle)] lg:pl-6">
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-[var(--av-text)]">
              Quota Consumption vs. Plan Ceiling
            </span>
            <span className="text-[11px] font-mono text-[var(--av-text-subtle)] tabular-nums">
              {anyLimitedQuota ? '0% – 100%' : 'Uncapped'}
            </span>
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 6, right: 16, left: 4, bottom: 4 }}
                barSize={18}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={theme.gridStroke}
                  horizontal={false}
                />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v) => `${v}%`}
                  tick={{ fontSize: 10, fill: theme.tickColor }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={56}
                  tick={{ fontSize: 11, fill: theme.tickColor }}
                  axisLine={false}
                  tickLine={false}
                />
                <ReferenceLine
                  x={100}
                  stroke={theme.isDark ? 'rgba(248, 113, 113, 0.45)' : 'rgba(220, 38, 38, 0.35)'}
                  strokeDasharray="3 3"
                />
                <Tooltip
                  cursor={{
                    fill: theme.isDark
                      ? 'rgba(255, 255, 255, 0.04)'
                      : 'rgba(15, 23, 42, 0.04)',
                  }}
                  content={<QuotaTooltip />}
                />
                <Bar dataKey="chartPct" radius={[0, 6, 6, 0]}>
                  {rows.map((row) => (
                    <Cell key={row.key} fill={row.barColor} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Clean unboxed secondary quota summary */}
          <div className="mt-3 pt-3 border-t border-[var(--av-border-subtle)] flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-[var(--av-text-subtle)] tabular-nums">
            <span>
              Locations:{' '}
              <strong className="font-mono text-[var(--av-text)]">
                {usage.locationsCount}/{effectiveLimits.maxLocations ?? '∞'}
              </strong>
            </span>
            <span>
              Orgs:{' '}
              <strong className="font-mono text-[var(--av-text)]">
                {usage.clientOrgsCount}/{effectiveLimits.maxClientOrgs ?? '∞'}
              </strong>
            </span>
            <span>
              Monthly tickets:{' '}
              <strong className="font-mono text-[var(--av-text)]">
                {usage.ticketsThisMonth}/{effectiveLimits.maxTicketsPerMonth ?? '∞'}
              </strong>
            </span>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
