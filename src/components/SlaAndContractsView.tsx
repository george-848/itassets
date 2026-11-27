import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, FileCheck2, Paperclip, Play, Plus, ShieldCheck, X } from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type { ServiceContract, SlaPolicy, TicketPriority } from '../types/saas.ts';
import { AttachmentsPanel } from './AttachmentsPanel.tsx';
import { formatGhsExact } from './StatusText.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface SlaAndContractsViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

function isBlockedErr(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'FEATURE_LOCKED' ||
      err.code === 'SUBSCRIPTION_READ_ONLY')
  );
}

export function SlaAndContractsView({
  tenantCtx,
  onRefresh,
  onToast,
  onPlanBlocked,
}: SlaAndContractsViewProps) {
  const cachedSla = api.peekCache<{ policies: SlaPolicy[] }>('/api/sla-policies');
  const cachedCtr = api.peekCache<{ contracts: ServiceContract[] }>('/api/contracts');
  const [policies, setPolicies] = useState<SlaPolicy[]>(() => cachedSla?.policies ?? []);
  const [contracts, setContracts] = useState<ServiceContract[]>(
    () => cachedCtr?.contracts ?? []
  );
  const [loading, setLoading] = useState(!cachedSla || !cachedCtr);
  const [sweeping, setSweeping] = useState(false);

  const [slaOpen, setSlaOpen] = useState(false);
  const [slaName, setSlaName] = useState('');
  const [slaPriority, setSlaPriority] = useState<TicketPriority>('High');
  const [firstRespMin, setFirstRespMin] = useState('30');
  const [resolutionMin, setResolutionMin] = useState('240');
  const [escMin, setEscMin] = useState('30');
  const [bizHoursOnly, setBizHoursOnly] = useState(true);

  const [ctrOpen, setCtrOpen] = useState(false);
  const [ctrTitle, setCtrTitle] = useState('');
  const [ctrType, setCtrType] =
    useState<ServiceContract['contractType']>('MSP Retainer');
  const [ctrVendor, setCtrVendor] = useState('');
  const [ctrValue, setCtrValue] = useState('12000');
  const [ctrStart, setCtrStart] = useState(new Date().toISOString().slice(0, 10));
  const [ctrEnd, setCtrEnd] = useState(
    new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)
  );
  const [ctrAutoRenew, setCtrAutoRenew] = useState(true);
  const [ctrAttachmentsTarget, setCtrAttachmentsTarget] =
    useState<ServiceContract | null>(null);

  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const perms = tenantCtx?.permissions ?? [];
  const canManageSla = !isReadOnly && perms.includes('sla.manage');
  const canManageContracts = !isReadOnly && perms.includes('contracts.manage');

  const loadAll = async () => {
    try {
      const [slaRes, ctrRes] = await Promise.all([
        api.listSlaPolicies(),
        api.listContracts(),
      ]);
      setPolicies(slaRes.policies);
      setContracts(ctrRes.contracts);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load SLA & Contracts.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const cSla = api.peekCache<{ policies: SlaPolicy[] }>('/api/sla-policies');
    const cCtr = api.peekCache<{ contracts: ServiceContract[] }>('/api/contracts');
    if (cSla) setPolicies(cSla.policies);
    if (cCtr) setContracts(cCtr.contracts);
    if (cSla && cCtr) setLoading(false);
    loadAll();
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id, tenantCtx?.isAllOrgsView]);

  const handleRunSweep = async () => {
    setSweeping(true);
    try {
      const res = await api.runComplianceJobs();
      onToast(
        'success',
        `Compliance sweep complete: ${res.escalatedCount} SLA escalations, ${res.alertsRecorded} alerts logged.`
      );
      await Promise.all([loadAll(), onRefresh()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Compliance sweep failed.'
      );
    } finally {
      setSweeping(false);
    }
  };

  const handleCreateSla = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createSlaPolicy({
        name: slaName.trim(),
        priority: slaPriority,
        firstResponseMinutes: Math.max(5, Number(firstRespMin) || 30),
        resolutionMinutes: Math.max(15, Number(resolutionMin) || 240),
        escalationMinutesBeforeBreach: Math.max(5, Number(escMin) || 30),
        businessHoursOnly: bizHoursOnly,
      });
      onToast('success', 'SLA policy created.');
      setSlaOpen(false);
      setSlaName('');
      await loadAll();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        setSlaOpen(false);
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create SLA policy.'
      );
    }
  };

  const handleCreateContract = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createContract({
        title: ctrTitle.trim(),
        contractType: ctrType,
        vendorOrProvider: ctrVendor.trim() || tenantCtx?.tenant.name || 'AssetVault',
        clientOrgName: tenantCtx?.activeOrg.name || 'Primary Org',
        annualValueGhs: Math.max(0, Number(ctrValue) || 0),
        startDate: ctrStart,
        endDate: ctrEnd,
        autoRenew: ctrAutoRenew,
      });
      onToast('success', 'Service contract added.');
      setCtrOpen(false);
      setCtrTitle('');
      await loadAll();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        setCtrOpen(false);
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create contract.'
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div>
          <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
            SLA Automation &amp; Service Retainers
          </h3>
          <p className="text-xs text-[var(--av-text-subtle)]">
            Configure response/resolution targets and track active vendor or client retainer contracts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isReadOnly && (canManageSla || canManageContracts) && (
            <button
              type="button"
              disabled={sweeping}
              onClick={handleRunSweep}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] disabled:opacity-60"
            >
              <Play className="h-3.5 w-3.5 text-emerald-500" />
              <span>{sweeping ? 'Sweeping...' : 'Run SLA & Expiry Sweep'}</span>
            </button>
          )}
          {canManageSla && (
            <button
              type="button"
              onClick={() => setSlaOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add SLA Policy</span>
            </button>
          )}
          {canManageContracts && (
            <button
              type="button"
              onClick={() => setCtrOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-accent)]/40 bg-[var(--av-accent-soft)] px-3.5 py-2 text-xs font-semibold text-[var(--av-accent)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Contract</span>
            </button>
          )}
        </div>
      </div>

      {/* SLA Policies */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--av-border-subtle)] px-5 py-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
          <Clock className="h-4 w-4 text-sky-500" />
          <span>SLA Policies ({policies.length})</span>
        </div>
        {policies.length === 0 && !loading ? (
          <EmptyState
            icon={ShieldCheck}
            title="No custom SLA policies"
            description="Define automated first-response and resolution SLAs per ticket priority."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                  <th className="py-3 px-4">Policy Name</th>
                  <th className="py-3 px-4">Priority</th>
                  <th className="py-3 px-4">First Response</th>
                  <th className="py-3 px-4">Resolution Target</th>
                  <th className="py-3 px-4">Escalation Lead</th>
                  <th className="py-3 px-4">Schedule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                {policies.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--av-surface-hover)]">
                    <td className="py-3 px-4 font-semibold text-[var(--av-text)]">{p.name}</td>
                    <td className="py-3 px-4 font-semibold text-blue-600 dark:text-blue-400">
                      {p.priority}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-muted)]">
                      {p.firstResponseMinutes} min
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-muted)]">
                      {p.resolutionMinutes} min
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-muted)]">
                      -{p.escalationMinutesBeforeBreach} min
                    </td>
                    <td className="py-3 px-4 text-[var(--av-text-subtle)]">
                      {p.businessHoursOnly ? 'Business Hours' : '24×7 Support'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Service Contracts */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="flex items-center gap-2 border-b border-[var(--av-border-subtle)] px-5 py-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
          <FileCheck2 className="h-4 w-4 text-emerald-500" />
          <span>Service Contracts &amp; Client Retainers ({contracts.length})</span>
        </div>
        {contracts.length === 0 && !loading ? (
          <EmptyState
            icon={FileCheck2}
            title="No service contracts recorded"
            description="Track MSP client retainers, hardware warranties, and annual maintenance SLAs."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                  <th className="py-3 px-4">Contract #</th>
                  <th className="py-3 px-4">Title &amp; Type</th>
                  <th className="py-3 px-4">Client / Provider</th>
                  <th className="py-3 px-4">Term</th>
                  <th className="py-3 px-4 text-right">Annual Value</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Documents</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                {contracts.map((c) => (
                  <tr key={c.id} className="hover:bg-[var(--av-surface-hover)]">
                    <td className="py-3 px-4 font-mono font-semibold text-[var(--av-accent)]">
                      {c.contractNumber}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--av-text)]">{c.title}</div>
                      <div className="text-[11px] text-[var(--av-text-subtle)]">{c.contractType}</div>
                    </td>
                    <td className="py-3 px-4 text-[var(--av-text-muted)]">
                      {c.clientOrgName} · {c.vendorOrProvider}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-muted)]">
                      {c.startDate} → {c.endDate}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-[var(--av-text)]">
                      {formatGhsExact(c.annualValueGhs)}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          c.status === 'Active'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : c.status === 'Expiring Soon'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-rose-600 dark:text-rose-400'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => setCtrAttachmentsTarget(c)}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)]"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        <span>Docs</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add SLA Modal */}
      <AnimatePresence>
        {slaOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Create SLA Policy
                </h3>
                <button type="button" onClick={() => setSlaOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateSla} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={slaName}
                  onChange={(e) => setSlaName(e.target.value)}
                  placeholder="Policy name (e.g. Executive P1 SLA)"
                  className={INPUT_CLASS}
                />
                <select
                  value={slaPriority}
                  onChange={(e) => setSlaPriority(e.target.value as TicketPriority)}
                  className={INPUT_CLASS}
                >
                  {(['Urgent', 'High', 'Medium', 'Low'] as const).map((p) => (
                    <option key={p} value={p}>
                      {p} Priority
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Response (min)
                    </label>
                    <input
                      type="number"
                      min="5"
                      value={firstRespMin}
                      onChange={(e) => setFirstRespMin(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Resolve (min)
                    </label>
                    <input
                      type="number"
                      min="15"
                      value={resolutionMin}
                      onChange={(e) => setResolutionMin(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Escalate (min)
                    </label>
                    <input
                      type="number"
                      min="5"
                      value={escMin}
                      onChange={(e) => setEscMin(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)]">
                  <input
                    type="checkbox"
                    checked={bizHoursOnly}
                    onChange={(e) => setBizHoursOnly(e.target.checked)}
                  />
                  <span>Count business hours only</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setSlaOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Policy
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Contract Modal */}
      <AnimatePresence>
        {ctrOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Add Service Contract
                </h3>
                <button type="button" onClick={() => setCtrOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateContract} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={ctrTitle}
                  onChange={(e) => setCtrTitle(e.target.value)}
                  placeholder="Contract title"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={ctrType}
                    onChange={(e) =>
                      setCtrType(e.target.value as ServiceContract['contractType'])
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="MSP Retainer">MSP Retainer</option>
                    <option value="Hardware Warranty">Hardware Warranty</option>
                    <option value="Maintenance SLA">Maintenance SLA</option>
                    <option value="Software Enterprise">Software Enterprise</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ctrValue}
                    onChange={(e) => setCtrValue(e.target.value)}
                    placeholder="Annual value (GH₵)"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </div>
                <input
                  type="text"
                  value={ctrVendor}
                  onChange={(e) => setCtrVendor(e.target.value)}
                  placeholder="Vendor or MSP Provider"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="date"
                    value={ctrStart}
                    onChange={(e) => setCtrStart(e.target.value)}
                    className={INPUT_CLASS}
                  />
                  <input
                    type="date"
                    value={ctrEnd}
                    onChange={(e) => setCtrEnd(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)]">
                  <input
                    type="checkbox"
                    checked={ctrAutoRenew}
                    onChange={(e) => setCtrAutoRenew(e.target.checked)}
                  />
                  <span>Auto-renew annually</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setCtrOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Contract
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contract Attachments Modal */}
      <AnimatePresence>
        {ctrAttachmentsTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setCtrAttachmentsTarget(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    Contract Documents · {ctrAttachmentsTarget.contractNumber}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)]">
                    {ctrAttachmentsTarget.title} · {ctrAttachmentsTarget.vendorOrProvider}
                  </p>
                </div>
                <button type="button" onClick={() => setCtrAttachmentsTarget(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <div className="p-6">
                <AttachmentsPanel
                  entityType="contract"
                  entityId={ctrAttachmentsTarget.id}
                  canWrite={canManageContracts}
                  onToast={onToast}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
