import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowLeftRight,
  ArrowUpDown,
  FileDown,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import { generateHandoverPDF } from '../lib/exports.ts';
import type { Asset, AssetAssignment, Employee } from '../types/itams.ts';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface AssignmentsViewProps {
  assignments: AssetAssignment[];
  assets: Asset[];
  employees: Employee[];
  tenantCtx?: ExtendedTenantContext | null;
  preselectedAsset: Asset | null;
  preselectedEmployee: Employee | null;
  onClearPreselections: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

type SortField = 'handover_number' | 'assigned_date' | 'employee_name';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function AssignmentsView({
  assignments,
  assets,
  employees,
  tenantCtx,
  preselectedAsset,
  preselectedEmployee,
  onClearPreselections,
  onRefresh,
  onToast,
}: AssignmentsViewProps) {
  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const canManage =
    !isReadOnly && (tenantCtx ? tenantCtx.permissions.includes('assignments.manage') : true);
  const [statusTab, setStatusTab] = useState<'ALL' | 'Active' | 'Returned'>('ALL');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState<SortField>('assigned_date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Assign modal
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assetId, setAssetId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [assignedDate, setAssignedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [conditionOut, setConditionOut] = useState('New / Mint');
  const [assignNotes, setAssignNotes] = useState('');
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  // Return modal
  const [returnTarget, setReturnTarget] = useState<AssetAssignment | null>(null);
  const [returnedDate, setReturnedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [conditionIn, setConditionIn] = useState('Good');
  const [returnStatus, setReturnStatus] = useState<
    'Available' | 'Under Maintenance' | 'Damaged'
  >('Available');
  const [returnNotes, setReturnNotes] = useState('');
  const [returnError, setReturnError] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);

  const availableAssets = useMemo(
    () => assets.filter((a) => a.status === 'Available'),
    [assets]
  );
  const activeEmployees = useMemo(
    () => employees.filter((e) => e.status === 'active'),
    [employees]
  );

  useEffect(() => {
    if (preselectedAsset || preselectedEmployee) {
      if (canManage) {
        setAssetId(preselectedAsset?.id || availableAssets[0]?.id || '');
        setEmployeeId(preselectedEmployee?.id || activeEmployees[0]?.id || '');
        setAssignedDate(new Date().toISOString().slice(0, 10));
        setConditionOut('Good');
        setAssignNotes('');
        setAssignError(null);
        setAssignModalOpen(true);
      }
      onClearPreselections();
    }
  }, [preselectedAsset, preselectedEmployee, canManage]);

  const openAssignModal = () => {
    setAssetId(availableAssets[0]?.id || '');
    setEmployeeId(activeEmployees[0]?.id || '');
    setAssignedDate(new Date().toISOString().slice(0, 10));
    setConditionOut('Good');
    setAssignNotes('');
    setAssignError(null);
    setAssignModalOpen(true);
  };

  const openReturnModal = (asg: AssetAssignment) => {
    setReturnTarget(asg);
    setReturnedDate(new Date().toISOString().slice(0, 10));
    setConditionIn('Good');
    setReturnStatus('Available');
    setReturnNotes('');
    setReturnError(null);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = assignments.filter((a) => {
      if (statusTab !== 'ALL' && a.status !== statusTab) return false;
      if (!q) return true;
      return (
        a.handover_number.toLowerCase().includes(q) ||
        (a.asset_tag || '').toLowerCase().includes(q) ||
        (a.asset_name || '').toLowerCase().includes(q) ||
        (a.employee_name || '').toLowerCase().includes(q) ||
        (a.employee_department || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      const cmp = String(a[sortField] || '').localeCompare(
        String(b[sortField] || '')
      );
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [assignments, statusTab, search, sortField, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [statusTab, search]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleAssignSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setAssignError(null);
    if (!assetId || !employeeId) {
      setAssignError('Please select both an available asset and an active employee.');
      return;
    }
    setAssigning(true);
    try {
      const res = await api.assignAsset({
        asset_id: assetId,
        employee_id: employeeId,
        assigned_date: assignedDate,
        condition_out: conditionOut,
        notes: assignNotes,
      });
      onToast(
        'success',
        `Handover ${res.assignment.handover_number} recorded and asset assigned.`
      );
      setAssignModalOpen(false);
      await onRefresh();
    } catch (err) {
      setAssignError(
        err instanceof ApiError ? err.message : 'Failed to assign asset.'
      );
    } finally {
      setAssigning(false);
    }
  };

  const handleReturnSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!returnTarget) return;
    setReturnError(null);
    setReturning(true);
    try {
      await api.returnAsset(returnTarget.id, {
        returned_date: returnedDate,
        condition_in: conditionIn,
        return_status: returnStatus,
        notes: returnNotes,
      });
      onToast(
        'success',
        `Asset ${returnTarget.asset_tag} returned and marked ${returnStatus}.`
      );
      setReturnTarget(null);
      await onRefresh();
    } catch (err) {
      setReturnError(
        err instanceof ApiError ? err.message : 'Failed to return asset.'
      );
    } finally {
      setReturning(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg bg-[var(--av-surface-muted)] border border-[var(--av-border-subtle)] p-1">
            {(['ALL', 'Active', 'Returned'] as const).map((tab) => {
              const active = statusTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusTab(tab)}
                  className={`relative px-3 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-[var(--av-text)]'
                      : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="assignments-tab-indicator"
                      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-md bg-[var(--av-surface)] border border-[var(--av-border-subtle)] shadow-xs"
                    />
                  )}
                  <span className="relative z-10">
                    {tab === 'ALL' ? 'All Handovers' : tab}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[230px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search handover #, asset, employee..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
            />
          </div>
        </div>

        {canManage && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={openAssignModal}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
          >
            <UserPlus className="h-4 w-4" />
            <span>Assign Asset</span>
          </motion.button>
        )}
      </div>

      {/* Assignments Table */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('handover_number')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Handover #</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Asset</th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('employee_name')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Assigned Employee</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('assigned_date')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Issue Date</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Return Date</th>
                <th className="py-3 px-4">Condition</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-sm">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={ArrowLeftRight}
                      title="No asset assignment records match your filter"
                      description="Issue an available asset to an active employee to create an auditable custody handover."
                      actionLabel={canManage && assignments.length === 0 ? 'Assign First Asset' : undefined}
                      onAction={canManage && assignments.length === 0 ? openAssignModal : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((asg) => (
                  <tr
                    key={asg.id}
                    className="hover:bg-[var(--av-surface-hover)] transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-[var(--av-text)] whitespace-nowrap">
                      {asg.handover_number}
                    </td>
                    <td className="py-3 px-4 min-w-[190px]">
                      <div className="font-semibold text-[13px] text-[var(--av-text)]">
                        {asg.asset_name}
                      </div>
                      <div className="font-mono text-xs text-[var(--av-text-subtle)]">
                        {asg.asset_tag}
                      </div>
                    </td>
                    <td className="py-3 px-4 min-w-[170px]">
                      <div className="font-semibold text-[13px] text-[var(--av-text)]">
                        {asg.employee_name}
                      </div>
                      <div className="text-xs text-[var(--av-text-subtle)]">
                        {asg.employee_code} · {asg.employee_department}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[var(--av-text-muted)] tabular-nums whitespace-nowrap">
                      {asg.assigned_date}
                    </td>
                    <td className="py-3 px-4 font-mono text-xs text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap">
                      {asg.returned_date || '—'}
                    </td>
                    <td className="py-3 px-4 text-xs text-[var(--av-text-subtle)] whitespace-nowrap">
                      {asg.condition_out}
                      {asg.condition_in ? ` → ${asg.condition_in}` : ''}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                      <span
                        className={
                          asg.status === 'Active'
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        {asg.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => generateHandoverPDF(asg)}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                          title="Download Handover PDF"
                        >
                          <FileDown className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400" />
                          <span>Handover PDF</span>
                        </button>
                        {canManage && asg.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => openReturnModal(asg)}
                            className="inline-flex items-center gap-1 rounded-md bg-[var(--av-accent)] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            <span>Return</span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
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
          itemLabel="handovers"
        />
      </div>

      {/* Assign Asset Modal */}
      <AnimatePresence>
        {assignModalOpen && (
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
              className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Assign IT Asset to Employee
                </h3>
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleAssignSubmit} className="px-6 py-5 space-y-4">
                {assignError && (
                  <div className="rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-300">
                    {assignError}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Available Asset *
                  </label>
                  {availableAssets.length === 0 ? (
                    <p className="text-xs text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/30 rounded-lg p-3">
                      No assets currently have Available status.
                    </p>
                  ) : (
                    <select
                      required
                      value={assetId}
                      onChange={(e) => setAssetId(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      {availableAssets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.asset_tag} — {a.name} ({a.category})
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Recipient Employee *
                  </label>
                  <select
                    required
                    value={employeeId}
                    onChange={(e) => setEmployeeId(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.employee_code}) · {emp.department}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Assignment Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={assignedDate}
                      onChange={(e) => setAssignedDate(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Condition at Issue *
                    </label>
                    <select
                      value={conditionOut}
                      onChange={(e) => setConditionOut(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="New / Mint">New / Mint</option>
                      <option value="Good">Good</option>
                      <option value="Fair / Minor Wear">Fair / Minor Wear</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Handover Notes / Included Accessories
                  </label>
                  <textarea
                    rows={2}
                    value={assignNotes}
                    onChange={(e) => setAssignNotes(e.target.value)}
                    placeholder="e.g. Includes power adapter, USB-C dock, and sleeve."
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-[var(--av-border-subtle)] pt-4">
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={assigning || availableAssets.length === 0}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors disabled:opacity-50"
                  >
                    {assigning ? 'Assigning...' : 'Confirm Assignment'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Return Asset Modal */}
      <AnimatePresence>
        {returnTarget && (
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
              className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    Return Assigned Asset
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    {returnTarget.asset_tag} · {returnTarget.asset_name} (from{' '}
                    {returnTarget.employee_name})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleReturnSubmit} className="px-6 py-5 space-y-4">
                {returnError && (
                  <div className="rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-300">
                    {returnError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Return Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={returnedDate}
                      onChange={(e) => setReturnedDate(e.target.value)}
                      className={`${INPUT_CLASS} tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Condition Returned *
                    </label>
                    <select
                      value={conditionIn}
                      onChange={(e) => setConditionIn(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="Good">Good</option>
                      <option value="Fair">Fair / Normal Wear</option>
                      <option value="Needs Repair">Needs Repair</option>
                      <option value="Damaged">Damaged</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Post-Return Asset Status *
                  </label>
                  <select
                    value={returnStatus}
                    onChange={(e) =>
                      setReturnStatus(
                        e.target.value as
                          | 'Available'
                          | 'Under Maintenance'
                          | 'Damaged'
                      )
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="Available">Available (Ready for re-issue)</option>
                    <option value="Under Maintenance">
                      Under Maintenance (Needs servicing/re-imaging)
                    </option>
                    <option value="Damaged">Damaged (Quarantine)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Return Inspection Notes
                  </label>
                  <textarea
                    rows={2}
                    value={returnNotes}
                    onChange={(e) => setReturnNotes(e.target.value)}
                    placeholder="Inspection observations or missing accessories..."
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="flex items-center justify-end gap-2.5 border-t border-[var(--av-border-subtle)] pt-4">
                  <button
                    type="button"
                    onClick={() => setReturnTarget(null)}
                    className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={returning}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors disabled:opacity-60"
                  >
                    {returning ? 'Processing...' : 'Complete Return'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
