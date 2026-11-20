import { motion } from 'motion/react';
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  HardDrive,
  UserCheck,
  Wrench,
} from 'lucide-react';
import {
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
import type { DashboardSummary } from '../types/itams.ts';
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
  loading: boolean;
  onNavigate: (section: NavSection) => void;
  onOpenAsset: (assetId: string) => void;
}

const STATUS_COLORS: Record<string, string> = {
  Assigned: '#1D4ED8',
  Available: '#15803D',
  'Under Maintenance': '#D97706',
  Damaged: '#DC2626',
  Retired: '#64748B',
};

export function DashboardView({
  summary,
  loading,
  onNavigate,
  onOpenAsset,
}: DashboardViewProps) {
  if (loading || !summary) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-slate-200 bg-white p-5 animate-pulse"
            >
              <div className="h-3 w-24 bg-slate-100 rounded" />
              <div className="mt-4 h-7 w-16 bg-slate-100 rounded" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 h-80 rounded-xl border border-slate-200 bg-white animate-pulse" />
          <div className="h-80 rounded-xl border border-slate-200 bg-white animate-pulse" />
        </div>
      </div>
    );
  }

  const { counts, financials, categoryBreakdown, statusBreakdown, monthlyMaintenance } =
    summary;

  const kpis = [
    {
      label: 'Total Assets',
      value: counts.totalAssets,
      sub: `${formatCurrency(financials.totalAssetValue)} total value`,
      icon: HardDrive,
      iconColor: 'text-slate-700',
      iconBg: 'bg-slate-100',
    },
    {
      label: 'Assigned Assets',
      value: counts.assignedAssets,
      sub: `${
        counts.totalAssets > 0
          ? Math.round((counts.assignedAssets / counts.totalAssets) * 100)
          : 0
      }% utilization rate`,
      icon: UserCheck,
      iconColor: 'text-blue-700',
      iconBg: 'bg-blue-50',
    },
    {
      label: 'Available Assets',
      value: counts.availableAssets,
      sub: 'Ready for deployment',
      icon: CheckCircle2,
      iconColor: 'text-emerald-700',
      iconBg: 'bg-emerald-50',
    },
    {
      label: 'Under Maintenance',
      value: counts.underMaintenance,
      sub: `${counts.openMaintenance} open service tickets`,
      icon: Wrench,
      iconColor: 'text-amber-700',
      iconBg: 'bg-amber-50',
    },
    {
      label: 'Retired / Damaged',
      value: counts.retiredOrDamaged,
      sub: 'Pending write-off or audit',
      icon: Archive,
      iconColor: 'text-red-700',
      iconBg: 'bg-red-50',
    },
  ];

  const pieData = statusBreakdown.filter((item) => item.count > 0);

  return (
    <div className="space-y-6">
      {/* KPI Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.18,
                delay: idx * 0.03,
                ease: [0.16, 1, 0.3, 1],
              }}
              className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-500">
                  {kpi.label}
                </span>
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg ${kpi.iconBg} ${kpi.iconColor}`}
                >
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <div className="font-display text-2xl font-bold text-slate-900 tabular-nums">
                  {kpi.value}
                </div>
                <div className="mt-1 text-xs text-slate-500 tabular-nums">
                  {kpi.sub}
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Primary Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Category Inventory Chart */}
        <div className="lg:col-span-2 rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Inventory by Equipment Category
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Distribution of assigned, available, and in-maintenance units across
                hardware classes
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('assets')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              <span>Manage inventory</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-4 h-72 w-full">
            {categoryBreakdown.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-4">
                <p className="text-sm font-medium text-slate-700">
                  No IT equipment recorded yet
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Add your first asset in Asset Inventory to populate category distribution.
                </p>
                <button
                  type="button"
                  onClick={() => onNavigate('assets')}
                  className="mt-3 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800"
                >
                  Add First Asset
                </button>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={categoryBreakdown}
                  margin={{ top: 8, right: 12, left: -16, bottom: 20 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="category"
                    tick={{ fontSize: 11, fill: '#475569' }}
                    interval={0}
                    angle={-18}
                    textAnchor="end"
                    height={48}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11, fill: '#475569' }}
                  />
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="assigned"
                    name="Assigned"
                    stackId="a"
                    fill="#1D4ED8"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="available"
                    name="Available"
                    stackId="a"
                    fill="#15803D"
                    radius={[0, 0, 0, 0]}
                  />
                  <Bar
                    dataKey="maintenance"
                    name="Maintenance"
                    stackId="a"
                    fill="#D97706"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Status Breakdown Donut */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 flex flex-col justify-between">
          <div className="border-b border-slate-100 pb-3.5">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Asset Status Allocation
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live operational availability breakdown
            </p>
          </div>
          <div className="h-52 w-full mt-2">
            {pieData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No status data available yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="count"
                    nameKey="status"
                    cx="50%"
                    cy="50%"
                    innerRadius={52}
                    outerRadius={78}
                    paddingAngle={2}
                  >
                    {pieData.map((entry) => (
                      <Cell
                        key={entry.status}
                        fill={STATUS_COLORS[entry.status] || '#64748B'}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="mt-2 space-y-2 border-t border-slate-100 pt-3">
            {statusBreakdown.map((item) => (
              <div
                key={item.status}
                className="flex items-center justify-between text-xs"
              >
                <div className="flex items-center gap-2 text-slate-700">
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{
                      backgroundColor: STATUS_COLORS[item.status] || '#64748B',
                    }}
                  />
                  <span>{item.status}</span>
                </div>
                <span className="font-mono font-medium text-slate-900 tabular-nums">
                  {item.count}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom Row: Priority Alerts + Maintenance Spend & Recent Assignments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Priority System Alerts */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Action Required Alerts
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                {summary.unreadAlertsCount} unacknowledged alerts
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('notifications')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              View all
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {summary.criticalAlerts.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                No active warranty, maintenance, or replacement alerts.
              </p>
            ) : (
              summary.criticalAlerts.map((alert) => (
                <div key={alert.id} className="py-3 flex items-start gap-3">
                  <AlertTriangle
                    className={`h-4 w-4 shrink-0 mt-0.5 ${
                      alert.severity === 'critical'
                        ? 'text-red-600'
                        : 'text-amber-600'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      onClick={() => onOpenAsset(alert.asset_id)}
                      className="text-left text-xs font-semibold text-slate-900 hover:text-blue-700 truncate block w-full"
                    >
                      {alert.title}
                    </button>
                    <p className="mt-0.5 text-xs text-slate-500 line-clamp-2">
                      {alert.description}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Monthly Maintenance Expenditure Chart */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Maintenance Spend
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                Total logged: {formatCurrency(financials.totalMaintenanceCost)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('maintenance')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              Service log
            </button>
          </div>
          <div className="mt-4 h-56 w-full">
            {monthlyMaintenance.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No maintenance cost history yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyMaintenance}
                  margin={{ top: 8, right: 8, left: -12, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#475569' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#475569' }} />
                  <Tooltip
                    formatter={(val) => [`$${Number(val ?? 0)}`, 'Service Cost']}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid #E2E8F0',
                      fontSize: '12px',
                    }}
                  />
                  <Bar
                    dataKey="cost"
                    name="Cost ($)"
                    fill="#0F172A"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Recent Handovers */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3.5">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900">
                Recent Custody Handovers
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Latest equipment issues and returns
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('assignments')}
              className="text-xs font-medium text-blue-700 hover:text-blue-800 whitespace-nowrap shrink-0"
            >
              All handovers
            </button>
          </div>
          <div className="mt-3 divide-y divide-slate-100">
            {summary.recentAssignments.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">
                No asset handovers recorded yet.
              </p>
            ) : (
              summary.recentAssignments.map((asg) => (
                <div
                  key={asg.id}
                  className="py-3 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenAsset(asg.asset_id)}
                      className="text-xs font-semibold text-slate-900 hover:text-blue-700 truncate block"
                    >
                      {asg.asset_tag} · {asg.asset_name}
                    </button>
                    <p className="mt-0.5 text-xs text-slate-500 truncate">
                      {asg.employee_name} · {asg.employee_department}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span
                      className={`text-xs font-medium ${
                        asg.status === 'Active'
                          ? 'text-blue-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {asg.status}
                    </span>
                    <div className="text-[11px] font-mono text-slate-400 tabular-nums">
                      {asg.assigned_date}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
