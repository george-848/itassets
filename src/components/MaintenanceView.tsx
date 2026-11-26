import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowUpDown,
  BarChart3,
  CheckCircle2,
  Clock,
  DollarSign,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import { getWorkspaceCurrency } from '../lib/currency.ts';
import { useTheme } from '../lib/theme.tsx';
import {
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  type Asset,
  type MaintenanceLog,
  type MaintenanceStatus,
  type MaintenanceType,
  type UserRole,
} from '../types/itams.ts';
import type { Ticket } from '../types/saas.ts';
import { AttachmentsPanel } from './AttachmentsPanel.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { MaintenanceStatusIndicator, formatCurrencyExact } from './StatusText.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface MaintenanceViewProps {
  maintenanceLogs: MaintenanceLog[];
  assets: Asset[];
  tickets?: Ticket[];
  userRole: UserRole;
  tenantCtx?: ExtendedTenantContext | null;
  preselectedAsset: Asset | null;
  onClearPreselectedAsset: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

interface MaintenanceFormState {
  asset_id: string;
  issue_description: string;
  maintenance_type: MaintenanceType;
  vendor_or_technician: string;
  service_date: string;
  next_service_date: string;
  cost: string;
  status: MaintenanceStatus;
  notes: string;
  set_asset_under_maintenance: boolean;
  ticket_id: string;
  downtime_minutes: string;
}

type SortField = 'asset_tag' | 'service_date' | 'next_service_date' | 'cost';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function MaintenanceView({
  maintenanceLogs,
  assets,
  tickets = [],
  userRole,
  tenantCtx,
  preselectedAsset,
  onClearPreselectedAsset,
  onRefresh,
  onToast,
}: MaintenanceViewProps) {
  const { theme } = useTheme();
  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const canManage =
    !isReadOnly && (tenantCtx ? tenantCtx.permissions.includes('maintenance.manage') : true);
  const canDelete =
    !isReadOnly &&
    (tenantCtx
      ? tenantCtx.permissions.includes('maintenance.manage') && userRole === 'admin'
      : userRole === 'admin');
  const [chartMode, setChartMode] = useState<'category' | 'monthly'>('category');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('service_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingLog, setEditingLog] = useState<MaintenanceLog | null>(null);
  const [form, setForm] = useState<MaintenanceFormState>({
    asset_id: '',
    issue_description: '',
    maintenance_type: 'Repair',
    vendor_or_technician: '',
    service_date: new Date().toISOString().slice(0, 10),
    next_service_date: '',
    cost: '0',
    status: 'In Progress',
    notes: '',
    set_asset_under_maintenance: true,
    ticket_id: '',
    downtime_minutes: '0',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<MaintenanceLog | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openCreateModal = (targetAsset?: Asset | null) => {
    setEditingLog(null);
    setForm({
      asset_id: targetAsset?.id || assets[0]?.id || '',
      issue_description: '',
      maintenance_type: 'Repair',
      vendor_or_technician: '',
      service_date: new Date().toISOString().slice(0, 10),
      next_service_date: '',
      cost: '0',
      status: 'In Progress',
      notes: '',
      set_asset_under_maintenance: true,
      ticket_id: '',
      downtime_minutes: '0',
    });
    setFormError(null);
    setFormOpen(true);
  };

  useEffect(() => {
    if (preselectedAsset) {
      if (canManage) {
        openCreateModal(preselectedAsset);
      }
      onClearPreselectedAsset();
    }
  }, [preselectedAsset, canManage]);

  const openEditModal = (log: MaintenanceLog) => {
    setEditingLog(log);
    setForm({
      asset_id: log.asset_id,
      issue_description: log.issue_description,
      maintenance_type: log.maintenance_type,
      vendor_or_technician: log.vendor_or_technician,
      service_date: log.service_date,
      next_service_date: log.next_service_date || '',
      cost: String(log.cost),
      status: log.status,
      notes: log.notes,
      set_asset_under_maintenance: false,
      ticket_id: log.ticket_id || '',
      downtime_minutes: String(log.downtime_minutes ?? 0),
    });
    setFormError(null);
    setFormOpen(true);
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    const totalCost = maintenanceLogs.reduce((s, m) => s + Number(m.cost || 0), 0);
    const openCount = maintenanceLogs.filter((m) => m.status !== 'Completed').length;
    const overdueCount = maintenanceLogs.filter((m) => {
      if (m.status === 'Completed') return false;
      const target = m.next_service_date || m.service_date;
      return Boolean(target && target < todayStr);
    }).length;
    const completedCount = maintenanceLogs.filter(
      (m) => m.status === 'Completed'
    ).length;
    return { totalCost, openCount, overdueCount, completedCount };
  }, [maintenanceLogs, todayStr]);

  const sixMonthAnalytics = useMemo(() => {
    const categoryColors: Record<string, string> = {
      Laptops: '#3B66F6',
      Desktops: '#6366F1',
      Servers: '#1AB394',
      'Networking Equipment': '#0EA5E9',
      Printers: '#F59E0B',
      UPS: '#8B5CF6',
      Monitors: '#10B981',
      CCTV: '#EC4899',
      Accessories: '#64748B',
    };

    const now = new Date();
    const monthSlots: Array<{ key: string; label: string; fullLabel: string }> = [];
    for (let offset = 5; offset >= 0; offset--) {
      const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', {
        month: 'short',
        year: '2-digit',
      });
      const fullLabel = d.toLocaleDateString('en-US', {
        month: 'short',
        year: 'numeric',
      });
      monthSlots.push({ key, label, fullLabel });
    }

    const monthKeySet = new Set(monthSlots.map((m) => m.key));
    const assetCategoryMap = new Map<string, string>();
    for (const asset of assets) {
      assetCategoryMap.set(asset.id, asset.category);
    }

    const categoryTotals = new Map<
      string,
      { category: string; cost: number; tickets: number; color: string }
    >();
    const monthlyMap = new Map<string, Record<string, number | string>>();
    for (const slot of monthSlots) {
      monthlyMap.set(slot.key, {
        monthKey: slot.key,
        month: slot.label,
      });
    }

    let sixMonthCost = 0;
    let sixMonthTickets = 0;

    for (const log of maintenanceLogs) {
      const monthKey = (log.service_date || '').slice(0, 7);
      if (!monthKeySet.has(monthKey)) continue;

      const category =
        log.asset_category ||
        assetCategoryMap.get(log.asset_id) ||
        'Other';
      const cost = Number(log.cost || 0);

      sixMonthCost += cost;
      sixMonthTickets += 1;

      const existingCat = categoryTotals.get(category) ?? {
        category,
        cost: 0,
        tickets: 0,
        color: categoryColors[category] || '#3B66F6',
      };
      existingCat.cost += cost;
      existingCat.tickets += 1;
      categoryTotals.set(category, existingCat);

      const monthRow = monthlyMap.get(monthKey);
      if (monthRow) {
        monthRow[category] = Number(monthRow[category] || 0) + cost;
      }
    }

    const byCategory = Array.from(categoryTotals.values()).sort(
      (a, b) => b.cost - a.cost || b.tickets - a.tickets
    );
    const activeCategories = byCategory.map((c) => ({
      category: c.category,
      color: c.color,
      cost: c.cost,
    }));

    const monthlyTrend = monthSlots.map((slot) => {
      const row = monthlyMap.get(slot.key) || { month: slot.label };
      for (const cat of activeCategories) {
        if (row[cat.category] === undefined) {
          row[cat.category] = 0;
        }
      }
      return row;
    });

    const rangeLabel = `${monthSlots[0].fullLabel} – ${monthSlots[monthSlots.length - 1].fullLabel}`;

    return {
      byCategory,
      activeCategories,
      monthlyTrend,
      sixMonthCost,
      sixMonthTickets,
      rangeLabel,
    };
  }, [maintenanceLogs, assets]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = maintenanceLogs.filter((m) => {
      if (statusFilter !== 'ALL' && m.status !== statusFilter) return false;
      if (typeFilter !== 'ALL' && m.maintenance_type !== typeFilter) return false;
      if (!q) return true;
      return (
        (m.asset_tag || '').toLowerCase().includes(q) ||
        (m.asset_name || '').toLowerCase().includes(q) ||
        m.issue_description.toLowerCase().includes(q) ||
        m.vendor_or_technician.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'cost') {
        cmp = Number(a.cost || 0) - Number(b.cost || 0);
      } else if (sortField === 'next_service_date') {
        cmp = (a.next_service_date || '9999-12-31').localeCompare(
          b.next_service_date || '9999-12-31'
        );
      } else if (sortField === 'asset_tag') {
        cmp = (a.asset_tag || '').localeCompare(b.asset_tag || '');
      } else {
        cmp = (a.service_date || '').localeCompare(b.service_date || '');
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [maintenanceLogs, search, statusFilter, typeFilter, sortField, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, typeFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'service_date' ? 'desc' : 'asc');
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsedCost = Number(form.cost);
    if (
      !form.asset_id ||
      !form.issue_description.trim() ||
      !form.vendor_or_technician.trim()
    ) {
      setFormError('Asset, issue description, and technician/vendor are required.');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setFormError('Cost must be a valid non-negative number.');
      return;
    }

    const downtimeMinutes = Math.max(0, Number(form.downtime_minutes || 0));
    setSubmitting(true);
    try {
      if (editingLog) {
        await api.updateMaintenance(editingLog.id, {
          issue_description: form.issue_description,
          maintenance_type: form.maintenance_type,
          vendor_or_technician: form.vendor_or_technician,
          service_date: form.service_date,
          next_service_date: form.next_service_date || null,
          cost: parsedCost,
          status: form.status,
          notes: form.notes,
          ticket_id: form.ticket_id || null,
          downtime_minutes: downtimeMinutes,
        });
        onToast('success', 'Maintenance ticket updated.');
      } else {
        await api.createMaintenance({
          asset_id: form.asset_id,
          issue_description: form.issue_description,
          maintenance_type: form.maintenance_type,
          vendor_or_technician: form.vendor_or_technician,
          service_date: form.service_date,
          next_service_date: form.next_service_date || null,
          cost: parsedCost,
          status: form.status,
          notes: form.notes,
          set_asset_under_maintenance: form.set_asset_under_maintenance,
          ticket_id: form.ticket_id || null,
          downtime_minutes: downtimeMinutes,
        });
        onToast('success', 'Maintenance record logged.');
      }
      setFormOpen(false);
      await onRefresh();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Failed to save maintenance record.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const markCompleted = async (log: MaintenanceLog) => {
    try {
      await api.updateMaintenance(log.id, { status: 'Completed' });
      onToast('success', `Service for ${log.asset_tag} marked Completed.`);
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to update service status.'
      );
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteMaintenance(deleteTarget.id);
      onToast('success', 'Maintenance log deleted.');
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete maintenance log.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: 0 }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] hover:-translate-y-0.5 transition-transform"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--av-text-subtle)]">
              Total Maintenance Cost
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <DollarSign className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 font-display text-2xl font-bold text-[var(--av-text)] tabular-nums">
            {formatCurrencyExact(stats.totalCost)}
          </div>
          <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
            Cumulative service ledger
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: 0.03 }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] hover:-translate-y-0.5 transition-transform"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--av-text-subtle)]">
              Open Service Tickets
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <Wrench className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 font-display text-2xl font-bold text-amber-600 dark:text-amber-400 tabular-nums">
            {stats.openCount}
          </div>
          <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
            Scheduled or in repair
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: 0.06 }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] hover:-translate-y-0.5 transition-transform"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--av-text-subtle)]">
              Overdue Scheduled
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-50 dark:bg-red-500/15 text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 font-display text-2xl font-bold text-red-600 dark:text-red-400 tabular-nums">
            {stats.overdueCount}
          </div>
          <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
            Past target service window
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16, delay: 0.09 }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] hover:-translate-y-0.5 transition-transform"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--av-text-subtle)]">
              Completed Services
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-2.5 font-display text-2xl font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
            {stats.completedCount}
          </div>
          <p className="mt-1 text-xs text-[var(--av-text-subtle)]">
            Closed &amp; verified hardware
          </p>
        </motion.div>
      </div>

      {/* 6-Month Maintenance Cost per Asset Category Bar Chart */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, delay: 0.12 }}
        className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)]"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--av-border-subtle)] pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-500/15 text-[#3B66F6] dark:text-blue-400">
              <BarChart3 className="h-4.5 w-4.5" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-[var(--av-text)]">
                Maintenance Cost by Asset Category
              </h2>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                Last 6 months ({sixMonthAnalytics.rangeLabel}) ·{' '}
                {formatCurrencyExact(sixMonthAnalytics.sixMonthCost)} across{' '}
                {sixMonthAnalytics.sixMonthTickets}{' '}
                {sixMonthAnalytics.sixMonthTickets === 1 ? 'ticket' : 'tickets'}
              </p>
            </div>
          </div>

          <div
            className="inline-flex items-center rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] p-0.5 self-start sm:self-auto shrink-0"
            role="tablist"
            aria-label="Chart breakdown view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === 'category'}
              onClick={() => setChartMode('category')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'category'
                  ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                  : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
              }`}
            >
              By Category
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={chartMode === 'monthly'}
              onClick={() => setChartMode('monthly')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                chartMode === 'monthly'
                  ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                  : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
              }`}
            >
              Monthly Trend
            </button>
          </div>
        </div>

        {sixMonthAnalytics.sixMonthTickets === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-center px-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-200/70 dark:border-blue-500/25 bg-blue-50/70 dark:bg-blue-500/10 text-[#3B66F6] dark:text-blue-400">
              <BarChart3 className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-semibold text-[var(--av-text)]">
              No maintenance costs logged in the last 6 months
            </p>
            <p className="mt-1 text-xs text-[var(--av-text-subtle)] max-w-md">
              Log service tickets within {sixMonthAnalytics.rangeLabel} to compare
              maintenance spend across hardware categories.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-4 h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                {chartMode === 'category' ? (
                  <BarChart
                    data={sixMonthAnalytics.byCategory}
                    margin={{ top: 10, right: 12, left: 4, bottom: 18 }}
                    barSize={38}
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
                      angle={
                        sixMonthAnalytics.byCategory.length > 5 ? -14 : 0
                      }
                      textAnchor={
                        sixMonthAnalytics.byCategory.length > 5 ? 'end' : 'middle'
                      }
                      height={sixMonthAnalytics.byCategory.length > 5 ? 46 : 30}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: theme.tickColor }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) =>
                        Number(v) >= 1000
                          ? `$${(Number(v) / 1000).toFixed(1).replace(/\.0$/, '')}k`
                          : `$${v}`
                      }
                    />
                    <Tooltip
                      cursor={{
                        fill: theme.isDark
                          ? 'rgba(255, 255, 255, 0.04)'
                          : 'rgba(15, 23, 42, 0.04)',
                      }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) {
                          return null;
                        }
                        const row = payload[0].payload as {
                          cost: number;
                          tickets: number;
                          color: string;
                        };
                        return (
                          <div className="rounded-xl border border-white/10 bg-[#080D21]/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-md">
                            <div className="mb-1.5 flex items-center gap-2 font-display font-semibold text-slate-200 border-b border-white/10 pb-1">
                              <span
                                className="h-2.5 w-2.5 rounded-xs shrink-0"
                                style={{ backgroundColor: row.color }}
                              />
                              <span>{label}</span>
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-5">
                                <span className="text-slate-300">6-Mo Spend</span>
                                <span className="font-mono font-semibold text-white tabular-nums">
                                  {formatCurrencyExact(row.cost)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between gap-5">
                                <span className="text-slate-300">Tickets</span>
                                <span className="font-mono font-semibold text-slate-200 tabular-nums">
                                  {row.tickets}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar
                      dataKey="cost"
                      name="Maintenance Cost"
                      radius={[6, 6, 0, 0]}
                    >
                      {sixMonthAnalytics.byCategory.map((entry) => (
                        <Cell key={entry.category} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart
                    data={sixMonthAnalytics.monthlyTrend}
                    margin={{ top: 10, right: 12, left: 4, bottom: 8 }}
                    barSize={34}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={theme.gridStroke}
                      vertical={false}
                    />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 11, fill: theme.tickColor }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fontSize: 11, fill: theme.tickColor }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) =>
                        Number(v) >= 1000
                          ? `$${(Number(v) / 1000).toFixed(1).replace(/\.0$/, '')}k`
                          : `$${v}`
                      }
                    />
                    <Tooltip
                      cursor={{
                        fill: theme.isDark
                          ? 'rgba(255, 255, 255, 0.04)'
                          : 'rgba(15, 23, 42, 0.04)',
                      }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload || payload.length === 0) {
                          return null;
                        }
                        const nonZero = payload.filter(
                          (entry) => Number(entry.value || 0) > 0
                        );
                        const monthTotal = payload.reduce(
                          (sum, entry) => sum + Number(entry.value || 0),
                          0
                        );
                        return (
                          <div className="rounded-xl border border-white/10 bg-[#080D21]/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur-md">
                            <div className="mb-1.5 flex items-center justify-between gap-4 font-display font-semibold text-slate-200 border-b border-white/10 pb-1">
                              <span>{label}</span>
                              <span className="font-mono tabular-nums">
                                {formatCurrencyExact(monthTotal)}
                              </span>
                            </div>
                            {nonZero.length === 0 ? (
                              <div className="text-slate-400">
                                No maintenance cost recorded
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {nonZero.map((entry, idx) => (
                                  <div
                                    key={idx}
                                    className="flex items-center justify-between gap-4"
                                  >
                                    <span className="flex items-center gap-1.5 text-slate-300">
                                      <span
                                        className="h-2 w-2 rounded-xs shrink-0"
                                        style={{
                                          backgroundColor:
                                            entry.color || '#3B66F6',
                                        }}
                                      />
                                      <span>{entry.name}</span>
                                    </span>
                                    <span className="font-mono font-semibold text-white tabular-nums">
                                      {formatCurrencyExact(
                                        Number(entry.value || 0)
                                      )}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      }}
                    />
                    {sixMonthAnalytics.activeCategories.map((cat, idx) => (
                      <Bar
                        key={cat.category}
                        dataKey={cat.category}
                        name={cat.category}
                        stackId="maintCost"
                        fill={cat.color}
                        radius={
                          idx === sixMonthAnalytics.activeCategories.length - 1
                            ? [5, 5, 0, 0]
                            : [0, 0, 0, 0]
                        }
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>

            {/* Category Color Legend */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--av-border-subtle)] pt-3 text-xs">
              {sixMonthAnalytics.byCategory.map((cat) => (
                <div
                  key={cat.category}
                  className="inline-flex items-center gap-1.5 text-[var(--av-text-muted)]"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-xs shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="font-medium text-[var(--av-text)]">
                    {cat.category}
                  </span>
                  <span className="font-mono text-[11px] text-[var(--av-text-subtle)] tabular-nums">
                    {formatCurrencyExact(cat.cost)}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </motion.div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset tag, issue, technician..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by maintenance type"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Types</option>
            {MAINTENANCE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by maintenance status"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Statuses</option>
            {MAINTENANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between lg:justify-end gap-3">
          <span className="text-xs font-medium text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap">
            {filtered.length} of {maintenanceLogs.length} tickets
          </span>
          {canManage && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={() => openCreateModal(null)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Log Maintenance</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* Maintenance Ledger Table */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('asset_tag')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Asset</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Type &amp; Issue</th>
                <th className="py-3 px-4">Technician / Vendor</th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('service_date')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Service Date</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('next_service_date')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Next Due</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)] ml-auto"
                  >
                    <span>Cost</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-sm">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Wrench}
                      title="No maintenance records found"
                      description="Adjust filters or log a new hardware repair, upgrade, or scheduled inspection ticket."
                      actionLabel={
                        canManage && maintenanceLogs.length === 0 ? 'Log Maintenance' : undefined
                      }
                      onAction={
                        canManage && maintenanceLogs.length === 0
                          ? () => openCreateModal(null)
                          : undefined
                      }
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((m) => {
                  const dueDate = m.next_service_date || m.service_date;
                  const isOverdue = m.status !== 'Completed' && dueDate < todayStr;
                  return (
                    <tr
                      key={m.id}
                      className="hover:bg-[var(--av-surface-hover)] transition-colors"
                    >
                      <td className="py-3 px-4 min-w-[170px]">
                        <div className="font-mono text-xs font-semibold text-[var(--av-text)]">
                          {m.asset_tag}
                        </div>
                        <div className="text-xs text-[var(--av-text-subtle)]">
                          {m.asset_name}
                        </div>
                      </td>
                      <td className="py-3 px-4 max-w-xs">
                        <div className="text-xs font-semibold text-[var(--av-text)]">
                          {m.maintenance_type}
                          {m.downtime_minutes ? (
                            <span className="ml-1.5 font-mono text-[11px] font-normal text-[var(--av-text-subtle)] tabular-nums">
                              · {m.downtime_minutes}m downtime
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-[var(--av-text-muted)] truncate">
                          {m.issue_description}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--av-text-muted)]">
                        {m.vendor_or_technician}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[var(--av-text-muted)] tabular-nums whitespace-nowrap">
                        {m.service_date}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        {m.next_service_date ? (
                          <span
                            className={
                              isOverdue
                                ? 'text-red-600 dark:text-red-400 font-semibold'
                                : 'text-[var(--av-text-subtle)]'
                            }
                          >
                            {m.next_service_date}
                            {isOverdue ? ' · Overdue' : ''}
                          </span>
                        ) : (
                          <span className="text-[var(--av-text-subtle)] opacity-60">
                            —
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <MaintenanceStatusIndicator status={m.status} />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-[var(--av-text)] tabular-nums whitespace-nowrap">
                        {formatCurrencyExact(m.cost)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {canManage && m.status !== 'Completed' && (
                            <button
                              type="button"
                              onClick={() => markCompleted(m)}
                              title="Mark completed"
                              className="p-1.5 rounded-md text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/15 transition-colors"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditModal(m)}
                              title="Edit maintenance log"
                              className="p-1.5 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 transition-colors"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(m)}
                              title="Delete log"
                              className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                          {!canManage && !canDelete && (
                            <span className="text-[11px] text-[var(--av-text-subtle)]">View only</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <DataPagination
          totalItems={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="tickets"
        />
      </div>

      {/* Add / Edit Maintenance Modal */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    {editingLog
                      ? 'Update Maintenance Ticket'
                      : 'Log Repair or Maintenance'}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Track vendor work orders, spare part costs, and preventive follow-ups.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  aria-label="Close modal"
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 space-y-4">
                {formError && (
                  <div className="rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-300">
                    {formError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Equipment Asset *
                  </label>
                  <select
                    required
                    disabled={Boolean(editingLog)}
                    value={form.asset_id}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, asset_id: e.target.value }))
                    }
                    className={`${INPUT_CLASS} disabled:opacity-60`}
                  >
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.asset_tag} — {a.name} ({a.status})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Maintenance Type *
                    </label>
                    <select
                      value={form.maintenance_type}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          maintenance_type: e.target.value as MaintenanceType,
                        }))
                      }
                      className={INPUT_CLASS}
                    >
                      {MAINTENANCE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Ticket Status *
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as MaintenanceStatus,
                        }))
                      }
                      className={INPUT_CLASS}
                    >
                      {MAINTENANCE_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Issue / Service Description *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.issue_description}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, issue_description: e.target.value }))
                    }
                    placeholder="e.g. Replace battery module or troubleshoot NIC port"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Vendor or Technician *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.vendor_or_technician}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          vendor_or_technician: e.target.value,
                        }))
                      }
                      placeholder="e.g. Dell ProSupport / Internal IT"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Service Cost ({getWorkspaceCurrency()}) *
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      required
                      value={form.cost}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, cost: e.target.value }))
                      }
                      className={`${INPUT_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Service Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={form.service_date}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, service_date: e.target.value }))
                      }
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Next Scheduled Service Date
                    </label>
                    <input
                      type="date"
                      value={form.next_service_date}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          next_service_date: e.target.value,
                        }))
                      }
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                </div>

                {!editingLog && form.status !== 'Completed' && (
                  <label className="flex items-center gap-2.5 text-xs text-[var(--av-text-muted)] pt-1">
                    <input
                      type="checkbox"
                      checked={form.set_asset_under_maintenance}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          set_asset_under_maintenance: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-[var(--av-border)] accent-[var(--av-accent)]"
                    />
                    <span>
                      Automatically set asset status to Under Maintenance while ticket
                      is active
                    </span>
                  </label>
                )}

                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Notes
                    </label>
                    <textarea
                      rows={2}
                      value={form.notes}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, notes: e.target.value }))
                      }
                      placeholder="Diagnostic findings or parts replaced..."
                      className={INPUT_CLASS}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                        Linked Helpdesk Ticket (optional)
                      </label>
                      <select
                        value={form.ticket_id}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, ticket_id: e.target.value }))
                        }
                        className={INPUT_CLASS}
                      >
                        <option value="">None</option>
                        {tickets.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.ticketNumber} · {t.subject}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                        Asset Downtime (minutes)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={form.downtime_minutes}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            downtime_minutes: e.target.value,
                          }))
                        }
                        className={`${INPUT_CLASS} font-mono tabular-nums`}
                      />
                    </div>
                  </div>

                  {editingLog && (
                    <AttachmentsPanel
                      entityType="maintenance"
                      entityId={editingLog.id}
                      orgId={editingLog.org_id}
                      canWrite={canManage}
                      onToast={onToast}
                    />
                  )}

                <div className="flex items-center justify-end gap-2.5 border-t border-[var(--av-border-subtle)] pt-4">
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors disabled:opacity-60"
                  >
                    {submitting
                      ? 'Saving...'
                      : editingLog
                        ? 'Save Updates'
                        : 'Save Maintenance Log'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Maintenance Record"
        description={`Delete maintenance record for "${deleteTarget?.asset_tag} — ${deleteTarget?.issue_description}"?`}
        confirmLabel="Delete Record"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
