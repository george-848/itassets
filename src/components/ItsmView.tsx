import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertOctagon,
  BookOpenCheck,
  Check,
  GitPullRequestArrow,
  Layers,
  Plus,
  ShoppingBag,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type {
  ChangeRequest,
  Incident,
  ProblemRecord,
  ServiceCatalogueItem,
  ServiceRequest,
} from '../types/saas.ts';
import { formatGhsExact } from './StatusText.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface ItsmViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

type ItsmTab = 'incidents' | 'catalogue' | 'problems' | 'changes';

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

export function ItsmView({ tenantCtx, onToast, onPlanBlocked }: ItsmViewProps) {
  const [tab, setTab] = useState<ItsmTab>('incidents');
  const [loading, setLoading] = useState(true);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [problems, setProblems] = useState<ProblemRecord[]>([]);
  const [changes, setChanges] = useState<ChangeRequest[]>([]);
  const [catalogue, setCatalogue] = useState<ServiceCatalogueItem[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);

  // Modal state
  const [incOpen, setIncOpen] = useState(false);
  const [incTitle, setIncTitle] = useState('');
  const [incDesc, setIncDesc] = useState('');
  const [incSeverity, setIncSeverity] = useState<Incident['severity']>('SEV-3');
  const [incImpact, setIncImpact] = useState<Incident['impact']>('Medium');

  const [prbOpen, setPrbOpen] = useState(false);
  const [prbTitle, setPrbTitle] = useState('');
  const [prbSymptom, setPrbSymptom] = useState('');
  const [prbRootCause, setPrbRootCause] = useState('');
  const [prbWorkaround, setPrbWorkaround] = useState('');
  const [prbKnownError, setPrbKnownError] = useState(false);

  const [chgOpen, setChgOpen] = useState(false);
  const [chgTitle, setChgTitle] = useState('');
  const [chgType, setChgType] = useState<ChangeRequest['changeType']>('Normal');
  const [chgRisk, setChgRisk] = useState<ChangeRequest['riskLevel']>('Medium');
  const [chgPlan, setChgPlan] = useState('');
  const [chgRollback, setChgRollback] = useState('');

  const [srModalItem, setSrModalItem] = useState<ServiceCatalogueItem | null>(null);
  const [srJustification, setSrJustification] = useState('');

  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const perms = tenantCtx?.permissions ?? [];
  const canManage = !isReadOnly && perms.includes('itsm.manage');
  const canApprove = !isReadOnly && perms.includes('itsm.approve');
  const canRequestService = !isReadOnly && perms.includes('tickets.create');

  const loadItsm = async () => {
    setLoading(true);
    try {
      const res = await api.getItsm();
      setIncidents(res.incidents);
      setProblems(res.problems);
      setChanges(res.changes);
      setCatalogue(res.catalogue);
      setServiceRequests(res.serviceRequests);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load ITSM suite.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItsm();
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id, tenantCtx?.isAllOrgsView]);

  const handleBlocked = (err: unknown, fallback: string) => {
    if (isBlockedErr(err) && onPlanBlocked) {
      onPlanBlocked(err);
      return;
    }
    onToast('error', err instanceof ApiError ? err.message : fallback);
  };

  const handleCreateIncident = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createIncident({
        title: incTitle.trim(),
        description: incDesc.trim(),
        severity: incSeverity,
        impact: incImpact,
      });
      onToast('success', 'Incident logged.');
      setIncOpen(false);
      setIncTitle('');
      setIncDesc('');
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to create incident.');
    }
  };

  const handleUpdateIncidentStatus = async (id: string, status: Incident['status']) => {
    try {
      await api.updateIncident(id, { status });
      onToast('success', `Incident updated to ${status}.`);
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to update incident.');
    }
  };

  const handleCreateProblem = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createProblem({
        title: prbTitle.trim(),
        symptomSummary: prbSymptom.trim(),
        rootCause: prbRootCause.trim(),
        workaround: prbWorkaround.trim(),
        knownError: prbKnownError,
        status: prbKnownError ? 'Known Error' : 'Root Cause Analysis',
      });
      onToast('success', 'Problem record created.');
      setPrbOpen(false);
      setPrbTitle('');
      setPrbSymptom('');
      setPrbRootCause('');
      setPrbWorkaround('');
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to create problem record.');
    }
  };

  const handleCreateChange = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createChange({
        title: chgTitle.trim(),
        changeType: chgType,
        riskLevel: chgRisk,
        implementationPlan: chgPlan.trim(),
        rollbackPlan: chgRollback.trim(),
      });
      onToast('success', 'Change request submitted for CAB approval.');
      setChgOpen(false);
      setChgTitle('');
      setChgPlan('');
      setChgRollback('');
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to submit change request.');
    }
  };

  const handleApproveChange = async (id: string, decision: 'Approved' | 'Rejected') => {
    try {
      await api.approveChange(id, decision);
      onToast('success', `Change request ${decision.toLowerCase()}.`);
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to record CAB decision.');
    }
  };

  const handleRequestCatalogueItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!srModalItem) return;
    try {
      await api.createServiceRequest({
        catalogueItemId: srModalItem.id,
        justification: srJustification.trim(),
      });
      onToast('success', `Service request submitted for ${srModalItem.name}.`);
      setSrModalItem(null);
      setSrJustification('');
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to submit service request.');
    }
  };

  const handleApproveServiceRequest = async (
    id: string,
    status: 'Approved' | 'Rejected' | 'Fulfilled'
  ) => {
    try {
      await api.approveServiceRequest(id, status);
      onToast('success', `Service request marked ${status}.`);
      await loadItsm();
    } catch (err) {
      handleBlocked(err, 'Failed to update service request.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Sub-navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'incidents', label: `Incidents (${incidents.length})`, icon: AlertOctagon },
              { id: 'catalogue', label: `Service Catalogue (${catalogue.length})`, icon: ShoppingBag },
              { id: 'problems', label: `Problems & KEDB (${problems.length})`, icon: BookOpenCheck },
              { id: 'changes', label: `Change / CAB (${changes.length})`, icon: GitPullRequestArrow },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  active
                    ? 'bg-[var(--av-accent)] text-white'
                    : 'bg-[var(--av-surface-muted)] text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {canManage && tab !== 'catalogue' && (
          <button
            type="button"
            onClick={() => {
              if (tab === 'incidents') setIncOpen(true);
              if (tab === 'problems') setPrbOpen(true);
              if (tab === 'changes') setChgOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>
              {tab === 'incidents'
                ? 'Log Incident'
                : tab === 'problems'
                  ? 'New Problem'
                  : 'New Change Request'}
            </span>
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-10 text-center text-xs text-[var(--av-text-subtle)]">
          Loading ITIL Service Management workspace...
        </div>
      ) : tab === 'incidents' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {incidents.length === 0 ? (
            <EmptyState
              icon={AlertOctagon}
              title="No major incidents recorded"
              description="Track SEV-1 to SEV-4 service disruptions, commanders, and post-mortem root causes."
            />
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)]">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[var(--av-surface-hover)] transition-colors"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-bold text-[var(--av-accent)]">
                        {inc.incidentNumber}
                      </span>
                      <span
                        className={`font-mono font-semibold ${
                          inc.severity === 'SEV-1'
                            ? 'text-rose-600 dark:text-rose-400'
                            : inc.severity === 'SEV-2'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-blue-600 dark:text-blue-400'
                        }`}
                      >
                        {inc.severity}
                      </span>
                      <span className="text-[var(--av-text-subtle)]">· Impact: {inc.impact}</span>
                      <span className="text-[var(--av-text-subtle)]">· Commander: {inc.commanderName}</span>
                    </div>
                    <div className="font-semibold text-sm text-[var(--av-text)]">{inc.title}</div>
                    {inc.description && (
                      <p className="text-xs text-[var(--av-text-muted)]">{inc.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canManage ? (
                      <select
                        value={inc.status}
                        onChange={(e) =>
                          handleUpdateIncidentStatus(inc.id, e.target.value as Incident['status'])
                        }
                        className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--av-text)]"
                      >
                        {(['Detected', 'Investigating', 'Mitigated', 'Resolved', 'Post-Mortem'] as const).map(
                          (st) => (
                            <option key={st} value={st}>
                              {st}
                            </option>
                          )
                        )}
                      </select>
                    ) : (
                      <span className="text-xs font-semibold text-[var(--av-text-muted)]">
                        {inc.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : tab === 'catalogue' ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {catalogue.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-[var(--av-accent)]">{item.category}</span>
                    <span className="font-mono text-[var(--av-text-subtle)]">
                      ~{item.estimatedFulfilmentHours}h SLA
                    </span>
                  </div>
                  <h4 className="mt-1.5 font-display text-sm font-bold text-[var(--av-text)]">
                    {item.name}
                  </h4>
                  <p className="mt-1 text-xs text-[var(--av-text-muted)] leading-relaxed">
                    {item.description}
                  </p>
                </div>
                <div className="flex items-center justify-between border-t border-[var(--av-border-subtle)] pt-3">
                  <span className="font-mono text-xs font-semibold text-[var(--av-text)] tabular-nums">
                    {item.defaultCostGhs > 0 ? formatGhsExact(item.defaultCostGhs) : 'Standard IT'}
                  </span>
                  {canRequestService && (
                    <button
                      type="button"
                      onClick={() => setSrModalItem(item)}
                      className="rounded-lg bg-[var(--av-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                    >
                      Request Service
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
            <div className="border-b border-[var(--av-border-subtle)] px-5 py-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
              Submitted Service Requests ({serviceRequests.length})
            </div>
            {serviceRequests.length === 0 ? (
              <EmptyState
                icon={Layers}
                title="No service requests submitted"
                description="Use the Service Catalogue above to request hardware provisioning, software access, or onboarding."
              />
            ) : (
              <div className="divide-y divide-[var(--av-border-subtle)]">
                {serviceRequests.map((sr) => (
                  <div
                    key={sr.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[var(--av-accent)]">
                          {sr.requestNumber}
                        </span>
                        <span className="font-semibold text-[var(--av-text)]">{sr.itemName}</span>
                      </div>
                      <div className="text-[var(--av-text-subtle)] mt-0.5">
                        Requested by {sr.requesterName} · {sr.justification || 'No notes'}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-[var(--av-text-muted)]">{sr.status}</span>
                      {canApprove && sr.status === 'Pending Approval' && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleApproveServiceRequest(sr.id, 'Approved')}
                            className="rounded-md bg-emerald-600 px-2.5 py-1 text-white font-semibold hover:bg-emerald-700"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            onClick={() => handleApproveServiceRequest(sr.id, 'Rejected')}
                            className="rounded-md bg-rose-600 px-2.5 py-1 text-white font-semibold hover:bg-rose-700"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {canApprove && sr.status === 'Approved' && (
                        <button
                          type="button"
                          onClick={() => handleApproveServiceRequest(sr.id, 'Fulfilled')}
                          className="rounded-md bg-[var(--av-accent)] px-2.5 py-1 text-white font-semibold"
                        >
                          Mark Fulfilled
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : tab === 'problems' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {problems.length === 0 ? (
            <EmptyState
              icon={BookOpenCheck}
              title="No problem records logged"
              description="Document recurring incident root causes and known-error workarounds."
            />
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)]">
              {problems.map((p) => (
                <div key={p.id} className="p-4 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[var(--av-accent)]">
                        {p.problemNumber}
                      </span>
                      <span className="font-semibold text-sm text-[var(--av-text)]">{p.title}</span>
                      {p.knownError && (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          · Known Error (KEDB)
                        </span>
                      )}
                    </div>
                    <span className="font-medium text-[var(--av-text-muted)]">{p.status}</span>
                  </div>
                  {p.rootCause && (
                    <p className="text-[var(--av-text-muted)]">
                      <strong>Root Cause:</strong> {p.rootCause}
                    </p>
                  )}
                  {p.workaround && (
                    <p className="text-emerald-700 dark:text-emerald-400">
                      <strong>Workaround:</strong> {p.workaround}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {changes.length === 0 ? (
            <EmptyState
              icon={GitPullRequestArrow}
              title="No CAB change requests"
              description="Submit infrastructure, network, or firmware changes with implementation and rollback plans."
            />
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)]">
              {changes.map((c) => (
                <div
                  key={c.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-bold text-[var(--av-accent)]">
                        {c.changeNumber}
                      </span>
                      <span className="font-semibold text-sm text-[var(--av-text)]">{c.title}</span>
                      <span className="text-[var(--av-text-subtle)]">
                        · {c.changeType} · Risk: {c.riskLevel}
                      </span>
                    </div>
                    {c.implementationPlan && (
                      <p className="text-[var(--av-text-muted)]">
                        <strong>Plan:</strong> {c.implementationPlan}
                      </p>
                    )}
                    {c.rollbackPlan && (
                      <p className="text-[var(--av-text-subtle)]">
                        <strong>Rollback:</strong> {c.rollbackPlan}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-semibold ${
                        c.status === 'Approved'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : c.status === 'Rejected'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {c.status}
                    </span>
                    {canApprove && c.status === 'Pending CAB Approval' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApproveChange(c.id, 'Approved')}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-white font-semibold hover:bg-emerald-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Approve</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApproveChange(c.id, 'Rejected')}
                          className="rounded-md bg-rose-600 px-2.5 py-1.5 text-white font-semibold hover:bg-rose-700"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Incident Modal */}
      <AnimatePresence>
        {incOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Log Major Incident
                </h3>
                <button type="button" onClick={() => setIncOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateIncident} className="p-6 space-y-4">
                <input
                  type="text"
                  required
                  value={incTitle}
                  onChange={(e) => setIncTitle(e.target.value)}
                  placeholder="Incident title (e.g. Core Switch Outage)"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={incSeverity}
                    onChange={(e) => setIncSeverity(e.target.value as Incident['severity'])}
                    className={INPUT_CLASS}
                  >
                    <option value="SEV-1">SEV-1 (Critical)</option>
                    <option value="SEV-2">SEV-2 (High)</option>
                    <option value="SEV-3">SEV-3 (Medium)</option>
                    <option value="SEV-4">SEV-4 (Low)</option>
                  </select>
                  <select
                    value={incImpact}
                    onChange={(e) => setIncImpact(e.target.value as Incident['impact'])}
                    className={INPUT_CLASS}
                  >
                    <option value="Enterprise-Wide">Enterprise-Wide</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <textarea
                  rows={3}
                  value={incDesc}
                  onChange={(e) => setIncDesc(e.target.value)}
                  placeholder="Affected systems, initial symptoms..."
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setIncOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Create Incident
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Problem Modal */}
      <AnimatePresence>
        {prbOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Create Problem / Known Error
                </h3>
                <button type="button" onClick={() => setPrbOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateProblem} className="p-6 space-y-3">
                <input
                  type="text"
                  required
                  value={prbTitle}
                  onChange={(e) => setPrbTitle(e.target.value)}
                  placeholder="Problem title"
                  className={INPUT_CLASS}
                />
                <textarea
                  rows={2}
                  value={prbSymptom}
                  onChange={(e) => setPrbSymptom(e.target.value)}
                  placeholder="Recurring symptoms"
                  className={INPUT_CLASS}
                />
                <textarea
                  rows={2}
                  value={prbRootCause}
                  onChange={(e) => setPrbRootCause(e.target.value)}
                  placeholder="Root cause analysis"
                  className={INPUT_CLASS}
                />
                <textarea
                  rows={2}
                  value={prbWorkaround}
                  onChange={(e) => setPrbWorkaround(e.target.value)}
                  placeholder="Verified workaround"
                  className={INPUT_CLASS}
                />
                <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)]">
                  <input
                    type="checkbox"
                    checked={prbKnownError}
                    onChange={(e) => setPrbKnownError(e.target.checked)}
                  />
                  <span>Publish to Known Error Database (KEDB)</span>
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPrbOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Problem
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Change Modal */}
      <AnimatePresence>
        {chgOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Submit CAB Change Request
                </h3>
                <button type="button" onClick={() => setChgOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateChange} className="p-6 space-y-3">
                <input
                  type="text"
                  required
                  value={chgTitle}
                  onChange={(e) => setChgTitle(e.target.value)}
                  placeholder="Change summary (e.g. Core firewall OS upgrade)"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={chgType}
                    onChange={(e) =>
                      setChgType(e.target.value as ChangeRequest['changeType'])
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="Standard">Standard</option>
                    <option value="Normal">Normal</option>
                    <option value="Emergency">Emergency</option>
                  </select>
                  <select
                    value={chgRisk}
                    onChange={(e) =>
                      setChgRisk(e.target.value as ChangeRequest['riskLevel'])
                    }
                    className={INPUT_CLASS}
                  >
                    <option value="Low">Low Risk</option>
                    <option value="Medium">Medium Risk</option>
                    <option value="High">High Risk</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  required
                  value={chgPlan}
                  onChange={(e) => setChgPlan(e.target.value)}
                  placeholder="Implementation steps..."
                  className={INPUT_CLASS}
                />
                <textarea
                  rows={2}
                  required
                  value={chgRollback}
                  onChange={(e) => setChgRollback(e.target.value)}
                  placeholder="Rollback & recovery plan..."
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setChgOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Submit to CAB
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Service Request Modal */}
      <AnimatePresence>
        {srModalItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Request: {srModalItem.name}
                </h3>
                <button type="button" onClick={() => setSrModalItem(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleRequestCatalogueItem} className="p-6 space-y-4">
                <p className="text-xs text-[var(--av-text-muted)]">
                  {srModalItem.description}
                </p>
                <textarea
                  rows={3}
                  required
                  value={srJustification}
                  onChange={(e) => setSrJustification(e.target.value)}
                  placeholder="Business justification, department, or target user..."
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSrModalItem(null)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Submit Request
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
