import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { KeyRound, Lock, Plus, Search, X } from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type { SoftwareLicence } from '../types/saas.ts';
import { formatGhsExact } from './StatusText.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface SoftwareLicencesViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function SoftwareLicencesView({
  tenantCtx,
  onRefresh,
  onToast,
  onPlanBlocked,
}: SoftwareLicencesViewProps) {
  const cachedLicences = api.peekCache<{
    licences: SoftwareLicence[];
    canViewKeys: boolean;
  }>('/api/licences');
  const [licences, setLicences] = useState<SoftwareLicence[]>(
    () => cachedLicences?.licences ?? []
  );
  const [canViewKeys, setCanViewKeys] = useState(
    () => cachedLicences?.canViewKeys ?? false
  );
  const [loading, setLoading] = useState(!cachedLicences);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [createOpen, setCreateOpen] = useState(false);
  const [softwareName, setSoftwareName] = useState('');
  const [vendor, setVendor] = useState('');
  const [licenceType, setLicenceType] =
    useState<SoftwareLicence['licenceType']>('Per Seat');
  const [licenceKey, setLicenceKey] = useState('');
  const [totalSeats, setTotalSeats] = useState('25');
  const [assignedSeats, setAssignedSeats] = useState('0');
  const [costPerYearGhs, setCostPerYearGhs] = useState('4500');
  const [expiryDate, setExpiryDate] = useState(
    new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)
  );
  const [submitting, setSubmitting] = useState(false);

  const canManage =
    !tenantCtx?.isReadOnlyGraceOrExpired &&
    (tenantCtx?.permissions.includes('licences.manage') ?? false);

  const loadLicences = async () => {
    try {
      const res = await api.listLicences();
      setLicences(res.licences);
      setCanViewKeys(res.canViewKeys);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load software licences.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cached = api.peekCache<{
      licences: SoftwareLicence[];
      canViewKeys: boolean;
    }>('/api/licences');
    if (cached) {
      setLicences(cached.licences);
      setCanViewKeys(cached.canViewKeys);
      setLoading(false);
    }
    loadLicences();
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id, tenantCtx?.isAllOrgsView]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.createLicence({
        softwareName: softwareName.trim(),
        vendor: vendor.trim(),
        licenceType,
        licenceKey: licenceKey.trim(),
        totalSeats: Math.max(1, Number(totalSeats) || 1),
        assignedSeats: Math.max(0, Number(assignedSeats) || 0),
        costPerYearGhs: Math.max(0, Number(costPerYearGhs) || 0),
        expiryDate,
      });
      onToast('success', `${softwareName.trim()} licence added.`);
      setCreateOpen(false);
      setSoftwareName('');
      setVendor('');
      setLicenceKey('');
      await Promise.all([loadLicences(), onRefresh()]);
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        (err.code === 'QUOTA_EXCEEDED' ||
          err.code === 'FEATURE_LOCKED' ||
          err.code === 'SUBSCRIPTION_READ_ONLY')
      ) {
        setCreateOpen(false);
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create software licence.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return licences.filter((l) => {
      if (!q) return true;
      return (
        l.softwareName.toLowerCase().includes(q) ||
        l.vendor.toLowerCase().includes(q) ||
        l.licenceType.toLowerCase().includes(q)
      );
    });
  }, [licences, search]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const totalAnnualSpend = licences.reduce((s, l) => s + l.costPerYearGhs, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search software, vendor, licence type..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
            />
          </div>
          <div className="text-xs text-[var(--av-text-subtle)] tabular-nums">
            Annual Spend:{' '}
            <strong className="font-mono text-[var(--av-text)]">
              {formatGhsExact(totalAnnualSpend)}
            </strong>
          </div>
        </div>

        {canManage && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Add Software Licence</span>
          </motion.button>
        )}
      </div>

      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">Software &amp; Vendor</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">
                  Licence Key {!canViewKeys && <span className="text-[10px] opacity-75">(Masked)</span>}
                </th>
                <th className="py-3 px-4">Seat Utilization</th>
                <th className="py-3 px-4">Expiry</th>
                <th className="py-3 px-4 text-right">Annual Cost</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
              {paginated.length === 0 && !loading ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={KeyRound}
                      title="No software licences tracked"
                      description="Centralize Microsoft 365, endpoint security, and SaaS seat allocations with renewal alerts."
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((lic) => {
                  const pct = Math.min(
                    100,
                    Math.round((lic.assignedSeats / Math.max(1, lic.totalSeats)) * 100)
                  );
                  return (
                    <tr key={lic.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--av-text)] text-[13px]">
                          {lic.softwareName}
                        </div>
                        <div className="text-[11px] text-[var(--av-text-subtle)]">{lic.vendor}</div>
                      </td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">{lic.licenceType}</td>
                      <td className="py-3 px-4 font-mono text-[var(--av-text-muted)]">
                        <span className="inline-flex items-center gap-1.5">
                          {!canViewKeys && <Lock className="h-3 w-3 text-amber-500" />}
                          <span>{canViewKeys ? lic.licenceKey : lic.maskedKey || lic.licenceKey}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 min-w-[160px]">
                        <div className="flex items-center justify-between text-[11px] tabular-nums mb-1">
                          <span className="font-semibold text-[var(--av-text)]">
                            {lic.assignedSeats} / {lic.totalSeats} seats
                          </span>
                          <span className="text-[var(--av-text-subtle)]">{pct}%</span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-[var(--av-surface-muted)] overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              pct >= 90 ? 'bg-amber-500' : 'bg-[var(--av-accent)]'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-muted)]">
                        {lic.expiryDate}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-[var(--av-text)]">
                        {formatGhsExact(lic.costPerYearGhs)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold ${
                            lic.status === 'Active'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : lic.status === 'Expiring Soon'
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {lic.status}
                        </span>
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
          itemLabel="licences"
        />
      </div>

      {/* Create Licence Modal */}
      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Register Software Licence
                </h3>
                <button type="button" onClick={() => setCreateOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={softwareName}
                  onChange={(e) => setSoftwareName(e.target.value)}
                  placeholder="Software name (e.g. Microsoft 365 Business)"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value)}
                    placeholder="Vendor"
                    className={INPUT_CLASS}
                  />
                  <select
                    value={licenceType}
                    onChange={(e) =>
                      setLicenceType(e.target.value as SoftwareLicence['licenceType'])
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="Per Seat">Per Seat</option>
                    <option value="Subscription">Subscription</option>
                    <option value="Site">Site</option>
                    <option value="Enterprise">Enterprise</option>
                  </select>
                </div>
                <input
                  type="text"
                  value={licenceKey}
                  onChange={(e) => setLicenceKey(e.target.value)}
                  placeholder="Licence key / Tenant entitlement ID"
                  className={`${INPUT_CLASS} font-mono`}
                />
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Total Seats
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={totalSeats}
                      onChange={(e) => setTotalSeats(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Used Seats
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={assignedSeats}
                      onChange={(e) => setAssignedSeats(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Annual (GH₵)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={costPerYearGhs}
                      onChange={(e) => setCostPerYearGhs(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                    Renewal / Expiry Date
                  </label>
                  <input
                    type="date"
                    required
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    {submitting ? 'Saving...' : 'Save Licence'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
