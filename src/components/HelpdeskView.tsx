import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  LifeBuoy,
  Lock,
  MessageSquare,
  Plus,
  Search,
  Send,
  Star,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  type ExtendedTenantContext,
  type ExtendedUser,
} from '../lib/api.ts';
import type { Asset } from '../types/itams.ts';
import type {
  Ticket,
  TicketComment,
  TicketPriority,
  TicketStatus,
} from '../types/saas.ts';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface HelpdeskViewProps {
  assets: Asset[];
  users: ExtendedUser[];
  currentUserId: string;
  tenantCtx: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

const TICKET_CATEGORIES: Ticket['category'][] = [
  'Hardware',
  'Software',
  'Network',
  'Access',
  'Procurement',
  'General',
];
const TICKET_PRIORITIES: TicketPriority[] = ['Low', 'Medium', 'High', 'Urgent'];
const TICKET_STATUSES: TicketStatus[] = [
  'Open',
  'In Progress',
  'Waiting on User',
  'Escalated',
  'Resolved',
  'Closed',
];

function isBlockedErr(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'FEATURE_LOCKED' ||
      err.code === 'SUBSCRIPTION_READ_ONLY')
  );
}

function formatTimerRemaining(dueIso: string | null, resolvedAt: string | null): string {
  if (!dueIso) return '—';
  if (resolvedAt) return 'Met';
  const diffMin = Math.round((new Date(dueIso).getTime() - Date.now()) / 60000);
  if (diffMin < 0) return `Breached ${Math.abs(diffMin)}m ago`;
  if (diffMin < 60) return `${diffMin}m left`;
  const hrs = Math.floor(diffMin / 60);
  return `${hrs}h ${diffMin % 60}m left`;
}

export function HelpdeskView({
  assets,
  users,
  currentUserId,
  tenantCtx,
  onRefresh,
  onToast,
  onPlanBlocked,
}: HelpdeskViewProps) {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [createOpen, setCreateOpen] = useState(false);
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Ticket['category']>('Hardware');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [assetId, setAssetId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [creating, setCreating] = useState(false);

  const [detailTicket, setDetailTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [updatingTicket, setUpdatingTicket] = useState(false);

  const [csatHover, setCsatHover] = useState(0);
  const [csatFeedback, setCsatFeedback] = useState('');

  const perms = tenantCtx?.permissions ?? [];
  const canCreate = perms.includes('tickets.create');
  const canAssign = perms.includes('tickets.assign');
  const canResolve = perms.includes('tickets.resolve');
  const canInternalNotes = perms.includes('tickets.internal_notes');

  const loadTickets = async () => {
    setLoading(true);
    try {
      const res = await api.listTickets();
      setTickets(res.tickets);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load tickets.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTickets();
    if (tenantCtx?.activeOrg.id) {
      setOrgId(tenantCtx.activeOrg.id);
    }
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id, tenantCtx?.isAllOrgsView]);

  const openTicketDrawer = async (ticket: Ticket) => {
    setDetailTicket(ticket);
    setComments([]);
    setCommentBody('');
    setIsInternalNote(false);
    setCsatFeedback(ticket.csatFeedback || '');
    try {
      const res = await api.getTicketDetail(ticket.id);
      setDetailTicket(res.ticket);
      setComments(res.comments);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load ticket conversation.'
      );
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) return;
    setCreating(true);
    try {
      await api.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        assetId: assetId || null,
        orgId: orgId || undefined,
      });
      onToast('success', 'Support ticket opened with SLA tracking.');
      setCreateOpen(false);
      setSubject('');
      setDescription('');
      setAssetId('');
      await Promise.all([loadTickets(), onRefresh()]);
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        setCreateOpen(false);
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create ticket.'
      );
    } finally {
      setCreating(false);
    }
  };

  const handleUpdateTicket = async (
    patch: Partial<{ status: TicketStatus; priority: TicketPriority; assigneeId: string | null }>
  ) => {
    if (!detailTicket) return;
    setUpdatingTicket(true);
    try {
      const res = await api.updateTicket(detailTicket.id, patch);
      setDetailTicket(res.ticket);
      setTickets((prev) =>
        prev.map((t) => (t.id === res.ticket.id ? { ...t, ...res.ticket } : t))
      );
      onToast('success', `Ticket ${res.ticket.ticketNumber} updated.`);
      await onRefresh();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to update ticket.'
      );
    } finally {
      setUpdatingTicket(false);
    }
  };

  const handleSendComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailTicket || !commentBody.trim()) return;
    setSendingComment(true);
    try {
      const res = await api.addTicketComment(detailTicket.id, {
        body: commentBody.trim(),
        isInternal: canInternalNotes && isInternalNote,
      });
      setComments((prev) => [...prev, res.comment]);
      setCommentBody('');
      onToast(
        'success',
        res.comment.isInternal ? 'Internal technician note saved.' : 'Reply posted.'
      );
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to send reply.'
      );
    } finally {
      setSendingComment(false);
    }
  };

  const handleSubmitCsat = async (rating: number) => {
    if (!detailTicket) return;
    try {
      const res = await api.updateTicket(detailTicket.id, {
        csatRating: rating,
        csatFeedback: csatFeedback.trim(),
      });
      setDetailTicket(res.ticket);
      setTickets((prev) =>
        prev.map((t) => (t.id === res.ticket.id ? { ...t, ...res.ticket } : t))
      );
      onToast('success', 'Thank you for submitting your CSAT feedback.');
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to submit rating.'
      );
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
      if (priorityFilter !== 'ALL' && t.priority !== priorityFilter) return false;
      if (!q) return true;
      return (
        t.ticketNumber.toLowerCase().includes(q) ||
        t.subject.toLowerCase().includes(q) ||
        t.requesterName.toLowerCase().includes(q) ||
        (t.assetTag || '').toLowerCase().includes(q) ||
        (t.orgName || '').toLowerCase().includes(q)
      );
    });
  }, [tickets, search, statusFilter, priorityFilter]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, priorityFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const openCount = tickets.filter((t) => t.status !== 'Resolved' && t.status !== 'Closed').length;
  const breachedCount = tickets.filter((t) => t.slaBreached).length;
  const csatList = tickets.filter((t) => typeof t.csatRating === 'number');
  const avgCsat =
    csatList.length > 0
      ? (csatList.reduce((s, t) => s + (t.csatRating ?? 0), 0) / csatList.length).toFixed(1)
      : '—';

  return (
    <div className="space-y-4">
      {/* Compact KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
          <div className="text-xs font-medium text-[var(--av-text-subtle)]">Total Tickets</div>
          <div className="mt-1 font-display text-2xl font-bold text-[var(--av-text)] tabular-nums">
            {tickets.length}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
          <div className="text-xs font-medium text-[var(--av-text-subtle)]">Active Queue</div>
          <div className="mt-1 font-display text-2xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
            {openCount}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
          <div className="text-xs font-medium text-[var(--av-text-subtle)]">SLA Breached</div>
          <div className="mt-1 font-display text-2xl font-bold text-rose-600 dark:text-rose-400 tabular-nums">
            {breachedCount}
          </div>
        </div>
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
          <div className="text-xs font-medium text-[var(--av-text-subtle)]">Avg CSAT Score</div>
          <div className="mt-1 font-display text-2xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {avgCsat === '—' ? '—' : `${avgCsat} / 5`}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search ticket #, subject, requester, asset..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by ticket status"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)]"
          >
            <option value="ALL">All Statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            aria-label="Filter by priority"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)]"
          >
            <option value="ALL">All Priorities</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {canCreate && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={() => setCreateOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>New Ticket</span>
          </motion.button>
        )}
      </div>

      {/* Tickets Table */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">Ticket #</th>
                <th className="py-3 px-4">Subject &amp; Category</th>
                <th className="py-3 px-4">Requester</th>
                <th className="py-3 px-4">Priority</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assignee</th>
                <th className="py-3 px-4">SLA Timer</th>
                <th className="py-3 px-4 text-right">Asset</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-sm">
              {loading ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-xs text-[var(--av-text-subtle)]">
                    Loading helpdesk queue...
                  </td>
                </tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={LifeBuoy}
                      title="No helpdesk tickets found"
                      description="Open a support ticket to track hardware issues, access requests, and SLA timers."
                      actionLabel={canCreate && tickets.length === 0 ? 'Open Support Ticket' : undefined}
                      onAction={canCreate && tickets.length === 0 ? () => setCreateOpen(true) : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((t) => {
                  const slaText = formatTimerRemaining(t.resolutionDueAt, t.resolvedAt);
                  return (
                    <tr
                      key={t.id}
                      onClick={() => openTicketDrawer(t)}
                      className="cursor-pointer hover:bg-[var(--av-surface-hover)] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold text-[var(--av-accent)] whitespace-nowrap">
                        {t.ticketNumber}
                      </td>
                      <td className="py-3 px-4 min-w-[220px]">
                        <div className="font-semibold text-[var(--av-text)] text-[13px]">
                          {t.subject}
                        </div>
                        <div className="text-[11px] text-[var(--av-text-subtle)]">
                          {t.category}
                          {t.orgName ? ` · ${t.orgName}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                        {t.requesterName}
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <span
                          className={`font-semibold ${
                            t.priority === 'Urgent'
                              ? 'text-rose-600 dark:text-rose-400'
                              : t.priority === 'High'
                                ? 'text-amber-600 dark:text-amber-400'
                                : t.priority === 'Medium'
                                  ? 'text-blue-600 dark:text-blue-400'
                                  : 'text-[var(--av-text-muted)]'
                          }`}
                        >
                          {t.priority}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 font-medium ${
                            t.status === 'Resolved' || t.status === 'Closed'
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : t.status === 'Escalated'
                                ? 'text-rose-600 dark:text-rose-400'
                                : 'text-blue-600 dark:text-blue-400'
                          }`}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                        {t.assigneeName || <span className="opacity-65">Unassigned</span>}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 ${
                            t.slaBreached
                              ? 'text-rose-600 dark:text-rose-400 font-semibold'
                              : t.resolvedAt
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-[var(--av-text-muted)]'
                          }`}
                        >
                          {t.slaBreached ? (
                            <AlertTriangle className="h-3.5 w-3.5" />
                          ) : t.resolvedAt ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          <span>{slaText}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-[var(--av-text-subtle)] whitespace-nowrap">
                        {t.assetTag || '—'}
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

      {/* Create Ticket Modal */}
      <AnimatePresence>
        {createOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Open Support Ticket
                </h3>
                <button
                  type="button"
                  onClick={() => setCreateOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Subject *
                  </label>
                  <input
                    type="text"
                    required
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="e.g. VPN client failing to authenticate on MacBook"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as Ticket['category'])}
                      className={INPUT_CLASS}
                    >
                      {TICKET_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Priority
                    </label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value as TicketPriority)}
                      className={INPUT_CLASS}
                    >
                      {TICKET_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Affected Asset (Optional)
                    </label>
                    <select
                      value={assetId}
                      onChange={(e) => setAssetId(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">None / General Inquiry</option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.asset_tag} — {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(tenantCtx?.availableOrgs.length ?? 0) > 1 && (
                    <div>
                      <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                        Client Organisation
                      </label>
                      <select
                        value={orgId}
                        onChange={(e) => setOrgId(e.target.value)}
                        className={INPUT_CLASS}
                      >
                        {tenantCtx!.availableOrgs.map((org) => (
                          <option key={org.id} value={org.id}>
                            {org.name} ({org.code})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Issue Description *
                  </label>
                  <textarea
                    rows={3}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Steps to reproduce, error details, or user impact..."
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creating}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                  >
                    {creating ? 'Submitting...' : 'Submit Ticket'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ticket Detail Slide-Over Drawer */}
      <AnimatePresence>
        {detailTicket && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setDetailTicket(null)}
            className="fixed inset-0 z-40 flex justify-end bg-slate-950/55 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl bg-[var(--av-surface)] h-full border-l border-[var(--av-border)] flex flex-col shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] px-6 py-5">
                <div>
                  <div className="flex items-center gap-2 font-mono text-xs font-semibold text-[var(--av-accent)]">
                    <span>{detailTicket.ticketNumber}</span>
                    {detailTicket.slaBreached && (
                      <span className="text-rose-600 dark:text-rose-400">· SLA BREACHED</span>
                    )}
                  </div>
                  <h3 className="font-display text-lg font-bold text-[var(--av-text)] mt-0.5">
                    {detailTicket.subject}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-1">
                    {detailTicket.requesterName} ({detailTicket.requesterEmail}) · {detailTicket.category}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailTicket(null)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Description & SLA */}
                <div className="rounded-xl border border-[var(--av-border)] p-4 space-y-3">
                  <p className="text-xs leading-relaxed text-[var(--av-text)]">
                    {detailTicket.description}
                  </p>
                  <div className="flex flex-wrap gap-4 border-t border-[var(--av-border-subtle)] pt-3 text-[11px] text-[var(--av-text-subtle)] tabular-nums">
                    <span>
                      Response Due:{' '}
                      <strong className="text-[var(--av-text)]">
                        {detailTicket.firstResponseDueAt?.slice(0, 16).replace('T', ' ') || '—'}
                      </strong>
                    </span>
                    <span>
                      Resolution Due:{' '}
                      <strong className="text-[var(--av-text)]">
                        {detailTicket.resolutionDueAt?.slice(0, 16).replace('T', ' ') || '—'}
                      </strong>
                    </span>
                    {detailTicket.assetTag && (
                      <span>
                        Asset: <strong className="font-mono text-[var(--av-accent)]">{detailTicket.assetTag}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Staff Workflow Controls */}
                {(canAssign || canResolve) && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface-muted)]/60 p-4">
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--av-text-subtle)] mb-1">
                        Status
                      </label>
                      <select
                        disabled={updatingTicket}
                        value={detailTicket.status}
                        onChange={(e) =>
                          handleUpdateTicket({ status: e.target.value as TicketStatus })
                        }
                        className={INPUT_CLASS}
                      >
                        {TICKET_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--av-text-subtle)] mb-1">
                        Priority
                      </label>
                      <select
                        disabled={updatingTicket}
                        value={detailTicket.priority}
                        onChange={(e) =>
                          handleUpdateTicket({ priority: e.target.value as TicketPriority })
                        }
                        className={INPUT_CLASS}
                      >
                        {TICKET_PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-[var(--av-text-subtle)] mb-1">
                        Assigned Technician
                      </label>
                      <select
                        disabled={updatingTicket || !canAssign}
                        value={detailTicket.assigneeId || ''}
                        onChange={(e) =>
                          handleUpdateTicket({ assigneeId: e.target.value || null })
                        }
                        className={INPUT_CLASS}
                      >
                        <option value="">Unassigned</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}

                {/* CSAT Rating (when Resolved/Closed) */}
                {(detailTicket.status === 'Resolved' || detailTicket.status === 'Closed') &&
                  (detailTicket.requesterId === currentUserId || canResolve) && (
                    <div className="rounded-xl border border-[var(--av-border)] p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-[var(--av-text)]">
                          Customer Satisfaction (CSAT)
                        </span>
                        {detailTicket.csatRating && (
                          <span className="text-xs font-semibold text-amber-500">
                            Rated {detailTicket.csatRating} / 5
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {[1, 2, 3, 4, 5].map((star) => {
                          const active = (csatHover || detailTicket.csatRating || 0) >= star;
                          return (
                            <button
                              key={star}
                              type="button"
                              onMouseEnter={() => setCsatHover(star)}
                              onMouseLeave={() => setCsatHover(0)}
                              onClick={() => handleSubmitCsat(star)}
                              className="p-1 rounded hover:bg-[var(--av-surface-hover)] transition-colors"
                              aria-label={`Rate ${star} stars`}
                            >
                              <Star
                                className={`h-5 w-5 ${
                                  active
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-[var(--av-text-subtle)]'
                                }`}
                              />
                            </button>
                          );
                        })}
                        <input
                          type="text"
                          value={csatFeedback}
                          onChange={(e) => setCsatFeedback(e.target.value)}
                          placeholder="Optional feedback comment..."
                          className={`${INPUT_CLASS} ml-2`}
                        />
                      </div>
                    </div>
                  )}

                {/* Conversation Thread */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-[var(--av-text)]">
                    <MessageSquare className="h-4 w-4 text-[var(--av-accent)]" />
                    <span>Activity &amp; Comments ({comments.length})</span>
                  </div>

                  <div className="space-y-2.5">
                    {comments.length === 0 ? (
                      <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                        No comments recorded yet.
                      </p>
                    ) : (
                      comments.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-xl border p-3.5 text-xs ${
                            c.isInternal
                              ? 'border-amber-300/70 dark:border-amber-500/30 bg-amber-50/60 dark:bg-amber-500/10'
                              : 'border-[var(--av-border)] bg-[var(--av-surface-muted)]/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-semibold text-[var(--av-text)] flex items-center gap-1.5">
                              {c.isInternal && (
                                <Lock className="h-3 w-3 text-amber-600 dark:text-amber-400" />
                              )}
                              <span>{c.authorName}</span>
                              {c.isInternal && (
                                <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                                  Internal Note
                                </span>
                              )}
                            </span>
                            <span className="font-mono text-[10px] text-[var(--av-text-subtle)] tabular-nums">
                              {c.createdAt.slice(0, 16).replace('T', ' ')}
                            </span>
                          </div>
                          <p className="text-[var(--av-text-muted)] leading-relaxed">{c.body}</p>
                        </div>
                      ))
                    )}
                  </div>

                  <form onSubmit={handleSendComment} className="space-y-2.5 pt-2 border-t border-[var(--av-border-subtle)]">
                    <textarea
                      rows={2}
                      required
                      value={commentBody}
                      onChange={(e) => setCommentBody(e.target.value)}
                      placeholder={
                        isInternalNote
                          ? 'Write an internal technician note (hidden from employees)...'
                          : 'Write a reply to the requester...'
                      }
                      className={INPUT_CLASS}
                    />
                    <div className="flex items-center justify-between gap-3">
                      {canInternalNotes ? (
                        <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isInternalNote}
                            onChange={(e) => setIsInternalNote(e.target.checked)}
                            className="rounded border-[var(--av-border)]"
                          />
                          <Lock className="h-3.5 w-3.5 text-amber-500" />
                          <span>Internal technician note</span>
                        </label>
                      ) : (
                        <span />
                      )}
                      <button
                        type="submit"
                        disabled={sendingComment}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" />
                        <span>{sendingComment ? 'Posting...' : 'Post Comment'}</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
