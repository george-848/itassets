import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import {
  FileDown,
  RotateCcw,
  Search,
  UserPlus,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { generateHandoverPDF } from '../lib/exports.ts';
import type { Asset, AssetAssignment, Employee } from '../types/itams.ts';

interface AssignmentsViewProps {
  assignments: AssetAssignment[];
  assets: Asset[];
  employees: Employee[];
  preselectedAsset: Asset | null;
  preselectedEmployee: Employee | null;
  onClearPreselections: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function AssignmentsView({
  assignments,
  assets,
  employees,
  preselectedAsset,
  preselectedEmployee,
  onClearPreselections,
  onRefresh,
  onToast,
}: AssignmentsViewProps) {
  const [statusTab, setStatusTab] = useState<'ALL' | 'Active' | 'Returned'>('ALL');
  const [search, setSearch] = useState('');

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
      setAssetId(preselectedAsset?.id || availableAssets[0]?.id || '');
      setEmployeeId(preselectedEmployee?.id || activeEmployees[0]?.id || '');
      setAssignedDate(new Date().toISOString().slice(0, 10));
      setConditionOut('Good');
      setAssignNotes('');
      setAssignError(null);
      setAssignModalOpen(true);
      onClearPreselections();
    }
  }, [preselectedAsset, preselectedEmployee]);

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
    return assignments.filter((a) => {
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
  }, [assignments, statusTab, search]);

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
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['ALL', 'Active', 'Returned'] as const).map((tab) => {
              const active = statusTab === tab;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setStatusTab(tab)}
                  className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="assignments-tab-indicator"
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-md bg-white shadow-xs"
                    />
                  )}
                  <span className="relative z-10">
                    {tab === 'ALL' ? 'All Handovers' : tab}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-w-[220px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search handover #, asset, employee..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={openAssignModal}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
        >
          <UserPlus className="h-4 w-4" />
          <span>Assign Asset</span>
        </button>
      </div>

      {/* Assignments Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Handover #</th>
                <th className="py-3 px-4">Asset</th>
                <th className="py-3 px-4">Assigned Employee</th>
                <th className="py-3 px-4">Issue Date</th>
                <th className="py-3 px-4">Return Date</th>
                <th className="py-3 px-4">Condition</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No asset assignment records match your filter
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((asg) => (
                  <tr key={asg.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {asg.handover_number}
                    </td>
                    <td className="py-2.5 px-4 min-w-[190px]">
                      <div className="font-medium text-slate-900">
                        {asg.asset_name}
                      </div>
                      <div className="font-mono text-xs text-slate-500">
                        {asg.asset_tag}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 min-w-[170px]">
                      <div className="font-medium text-slate-900">
                        {asg.employee_name}
                      </div>
                      <div className="text-xs text-slate-500">
                        {asg.employee_code} · {asg.employee_department}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                      {asg.assigned_date}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                      {asg.returned_date || '—'}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                      {asg.condition_out}
                      {asg.condition_in ? ` → ${asg.condition_in}` : ''}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-medium whitespace-nowrap">
                      <span
                        className={
                          asg.status === 'Active'
                            ? 'text-blue-700'
                            : 'text-slate-600'
                        }
                      >
                        {asg.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => generateHandoverPDF(asg)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          title="Download Handover PDF"
                        >
                          <FileDown className="h-3.5 w-3.5" />
                          <span>Handover PDF</span>
                        </button>
                        {asg.status === 'Active' && (
                          <button
                            type="button"
                            onClick={() => openReturnModal(asg)}
                            className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
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
      </div>

      {/* Assign Asset Modal */}
      {assignModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                Assign IT Asset to Employee
              </h3>
              <button
                type="button"
                onClick={() => setAssignModalOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleAssignSubmit} className="px-6 py-5 space-y-4">
              {assignError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                  {assignError}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Available Asset *
                </label>
                {availableAssets.length === 0 ? (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    No assets currently have Available status.
                  </p>
                ) : (
                  <select
                    required
                    value={assetId}
                    onChange={(e) => setAssetId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
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
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Recipient Employee *
                </label>
                <select
                  required
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Assignment Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={assignedDate}
                    onChange={(e) => setAssignedDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Condition at Issue *
                  </label>
                  <select
                    value={conditionOut}
                    onChange={(e) => setConditionOut(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  >
                    <option value="New / Mint">New / Mint</option>
                    <option value="Good">Good</option>
                    <option value="Fair / Minor Wear">Fair / Minor Wear</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Handover Notes / Included Accessories
                </label>
                <textarea
                  rows={2}
                  value={assignNotes}
                  onChange={(e) => setAssignNotes(e.target.value)}
                  placeholder="e.g. Includes power adapter, USB-C dock, and sleeve."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assigning || availableAssets.length === 0}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {assigning ? 'Assigning...' : 'Confirm Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Return Asset Modal */}
      {returnTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div>
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Return Assigned Asset
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {returnTarget.asset_tag} · {returnTarget.asset_name} (from{' '}
                  {returnTarget.employee_name})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleReturnSubmit} className="px-6 py-5 space-y-4">
              {returnError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                  {returnError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Return Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={returnedDate}
                    onChange={(e) => setReturnedDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Condition Returned *
                  </label>
                  <select
                    value={conditionIn}
                    onChange={(e) => setConditionIn(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  >
                    <option value="Good">Good</option>
                    <option value="Fair">Fair / Normal Wear</option>
                    <option value="Needs Repair">Needs Repair</option>
                    <option value="Damaged">Damaged</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                >
                  <option value="Available">Available (Ready for re-issue)</option>
                  <option value="Under Maintenance">
                    Under Maintenance (Needs servicing/re-imaging)
                  </option>
                  <option value="Damaged">Damaged (Quarantine)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Return Inspection Notes
                </label>
                <textarea
                  rows={2}
                  value={returnNotes}
                  onChange={(e) => setReturnNotes(e.target.value)}
                  placeholder="Inspection observations or missing accessories..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setReturnTarget(null)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={returning}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  {returning ? 'Processing...' : 'Complete Return'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
