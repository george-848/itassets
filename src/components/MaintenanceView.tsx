import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CheckCircle2,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import {
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  type Asset,
  type MaintenanceLog,
  type MaintenanceStatus,
  type MaintenanceType,
  type UserRole,
} from '../types/itams.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { MaintenanceStatusIndicator, formatCurrencyExact } from './StatusText.tsx';

interface MaintenanceViewProps {
  maintenanceLogs: MaintenanceLog[];
  assets: Asset[];
  userRole: UserRole;
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
}

export function MaintenanceView({
  maintenanceLogs,
  assets,
  userRole,
  preselectedAsset,
  onClearPreselectedAsset,
  onRefresh,
  onToast,
}: MaintenanceViewProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

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
    });
    setFormError(null);
    setFormOpen(true);
  };

  useEffect(() => {
    if (preselectedAsset) {
      openCreateModal(preselectedAsset);
      onClearPreselectedAsset();
    }
  }, [preselectedAsset]);

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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return maintenanceLogs.filter((m) => {
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
  }, [maintenanceLogs, search, statusFilter, typeFilter]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsedCost = Number(form.cost);
    if (!form.asset_id || !form.issue_description.trim() || !form.vendor_or_technician.trim()) {
      setFormError('Asset, issue description, and technician/vendor are required.');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setFormError('Cost must be a valid non-negative number.');
      return;
    }

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
    <div className="space-y-5">
      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Total Maintenance Cost
          </div>
          <div className="mt-1.5 font-display text-2xl font-bold text-slate-900 tabular-nums">
            {formatCurrencyExact(stats.totalCost)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Open Service Tickets
          </div>
          <div className="mt-1.5 font-display text-2xl font-bold text-amber-700 tabular-nums">
            {stats.openCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Overdue Scheduled
          </div>
          <div className="mt-1.5 font-display text-2xl font-bold text-red-700 tabular-nums">
            {stats.overdueCount}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">
            Completed Services
          </div>
          <div className="mt-1.5 font-display text-2xl font-bold text-emerald-700 tabular-nums">
            {stats.completedCount}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search asset tag, issue, technician..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by maintenance type"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none"
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
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            {MAINTENANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={() => openCreateModal(null)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="h-4 w-4" />
          <span>Log Maintenance</span>
        </button>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Asset</th>
                <th className="py-3 px-4">Type & Issue</th>
                <th className="py-3 px-4">Technician / Vendor</th>
                <th className="py-3 px-4">Service Date</th>
                <th className="py-3 px-4">Next Due</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Cost</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No maintenance records found
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((m) => {
                  const dueDate = m.next_service_date || m.service_date;
                  const isOverdue = m.status !== 'Completed' && dueDate < todayStr;
                  return (
                    <tr key={m.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-2.5 px-4 min-w-[170px]">
                        <div className="font-mono text-xs font-semibold text-slate-900">
                          {m.asset_tag}
                        </div>
                        <div className="text-xs text-slate-500">{m.asset_name}</div>
                      </td>
                      <td className="py-2.5 px-4 max-w-xs">
                        <div className="text-xs font-semibold text-slate-900">
                          {m.maintenance_type}
                        </div>
                        <div className="text-xs text-slate-600 truncate">
                          {m.issue_description}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700">
                        {m.vendor_or_technician}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                        {m.service_date}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        {m.next_service_date ? (
                          <span
                            className={
                              isOverdue
                                ? 'text-red-700 font-semibold'
                                : 'text-slate-600'
                            }
                          >
                            {m.next_service_date}
                            {isOverdue ? ' (Overdue)' : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4">
                        <MaintenanceStatusIndicator status={m.status} />
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                        {formatCurrencyExact(m.cost)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {m.status !== 'Completed' && (
                            <button
                              type="button"
                              onClick={() => markCompleted(m)}
                              title="Mark completed"
                              className="p-1.5 rounded-md text-emerald-700 hover:bg-emerald-50"
                            >
                              <CheckCircle2 className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openEditModal(m)}
                            title="Edit maintenance log"
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(m)}
                              title="Delete log"
                              className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
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
      </div>

      {/* Add / Edit Maintenance Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {editingLog ? 'Update Maintenance Ticket' : 'Log Repair or Maintenance'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Equipment Asset *
                </label>
                <select
                  required
                  disabled={Boolean(editingLog)}
                  value={form.asset_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, asset_id: e.target.value }))
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none disabled:bg-slate-50"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  >
                    {MAINTENANCE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Service Cost (USD) *
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Service Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.service_date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, service_date: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              {!editingLog && form.status !== 'Completed' && (
                <label className="flex items-center gap-2.5 text-xs text-slate-700 pt-1">
                  <input
                    type="checkbox"
                    checked={form.set_asset_under_maintenance}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        set_asset_under_maintenance: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-slate-300 text-blue-700 focus:ring-blue-600"
                  />
                  <span>
                    Automatically set asset status to Under Maintenance while ticket is
                    active
                  </span>
                </label>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  placeholder="Diagnostic findings or parts replaced..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {submitting
                    ? 'Saving...'
                    : editingLog
                      ? 'Save Updates'
                      : 'Save Maintenance Log'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
