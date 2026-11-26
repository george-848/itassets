import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  BookOpen,
  HardDrive,
  LifeBuoy,
  PackageCheck,
  Plus,
  Send,
  Star,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext, type ExtendedUser } from '../lib/api.ts';
import type { Asset } from '../types/itams.ts';
import type {
  KnowledgeArticle,
  ServiceCatalogueItem,
  ServiceRequest,
  Ticket,
  TicketComment,
  TicketPriority,
} from '../types/saas.ts';
import { formatGhs } from './StatusText.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface EmployeePortalViewProps {
  currentUser: ExtendedUser;
  tenantCtx: ExtendedTenantContext | null;
  assets: Asset[];
  tickets: Ticket[];
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

type PortalTab = 'equipment' | 'tickets' | 'requests' | 'kb';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function EmployeePortalView({
  currentUser,
  tenantCtx,
  assets,
  tickets,
  onRefresh,
  onToast,
}: EmployeePortalViewProps) {
  const [tab, setTab] = useState<PortalTab>('equipment');
  const [catalogue, setCatalogue] = useState<ServiceCatalogueItem[]>([]);
  const [serviceRequests, setServiceRequests] = useState<ServiceRequest[]>([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);

  // Quick ticket form
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Ticket['category']>('Hardware');
  const [priority, setPriority] = useState<TicketPriority>('Medium');
  const [assetId, setAssetId] = useState('');
  const [submittingTicket, setSubmittingTicket] = useState(false);

  // Selected ticket conversation
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [replyText, setReplyText] = useState('');
  const [csatHover, setCsatHover] = useState(0);

  // Catalogue request
  const [reqItem, setReqItem] = useState<ServiceCatalogueItem | null>(null);
  const [reqReason, setReqReason] = useState('');

  const myAssets = useMemo(() => {
    const emailLower = currentUser.email.toLowerCase();
    return assets.filter(
      (a) =>
        a.assigned_employee_name?.toLowerCase() === currentUser.name.toLowerCase() ||
        a.notes?.toLowerCase().includes(emailLower)
    );
  }, [assets, currentUser]);

  const features = tenantCtx?.effectiveFeatures ?? [];
  const hasHelpdesk = !tenantCtx || features.includes('helpdesk');
  const hasItsm = !tenantCtx || features.includes('itsm_suite');
  const hasKb = !tenantCtx || features.includes('knowledge_base');
  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);

  const myTickets = useMemo(
    () =>
      tickets.filter(
        (t) =>
          t.requesterId === currentUser.id ||
          t.requesterEmail.toLowerCase() === currentUser.email.toLowerCase()
      ),
    [tickets, currentUser]
  );

  useEffect(() => {
    if (tab === 'tickets' && !hasHelpdesk) setTab('equipment');
    if (tab === 'requests' && !hasItsm) setTab('equipment');
    if (tab === 'kb' && !hasKb) setTab('equipment');
  }, [tab, hasHelpdesk, hasItsm, hasKb]);

  useEffect(() => {
    Promise.all([
      hasItsm
        ? api.getItsm().catch(() => ({ catalogue: [], serviceRequests: [] }))
        : Promise.resolve({ catalogue: [], serviceRequests: [] }),
      hasKb
        ? api.listKb().catch(() => ({ articles: [] }))
        : Promise.resolve({ articles: [] }),
    ]).then(([catRes, kbRes]) => {
      setCatalogue(catRes.catalogue);
      setServiceRequests(
        catRes.serviceRequests.filter((r) => r.requesterId === currentUser.id)
      );
      setArticles(kbRes.articles.filter((a) => a.visibility === 'public_portal'));
    });
  }, [tenantCtx?.tenant.id, currentUser.id, hasItsm, hasKb]);

  const openTicketDetail = async (ticket: Ticket) => {
    setSelectedTicket(ticket);
    try {
      const res = await api.getTicketDetail(ticket.id);
      setComments(res.comments);
    } catch {
      setComments([]);
    }
  };

  const handleSubmitTicket = async (e: FormEvent) => {
    e.preventDefault();
    setSubmittingTicket(true);
    try {
      await api.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        category,
        priority,
        assetId: assetId || undefined,
      });
      setSubject('');
      setDescription('');
      setAssetId('');
      onToast('success', 'Support ticket submitted to IT Helpdesk.');
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to submit ticket.'
      );
    } finally {
      setSubmittingTicket(false);
    }
  };

  const handleSendReply = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyText.trim()) return;
    try {
      const res = await api.addTicketComment(selectedTicket.id, {
        body: replyText.trim(),
        isInternal: false,
      });
      setComments((prev) => [...prev, res.comment]);
      setReplyText('');
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to post reply.'
      );
    }
  };

  const handleRateCsat = async (rating: number) => {
    if (!selectedTicket) return;
    try {
      const res = await api.updateTicket(selectedTicket.id, { csatRating: rating });
      setSelectedTicket(res.ticket);
      onToast('success', `Thank you for rating your support ${rating}/5.`);
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Unable to save feedback.'
      );
    }
  };

  const handleSubmitServiceRequest = async (e: FormEvent) => {
    e.preventDefault();
    if (!reqItem) return;
    try {
      const res = await api.createServiceRequest({
        catalogueItemId: reqItem.id,
        justification: reqReason.trim(),
      });
      setServiceRequests((prev) => [res.serviceRequest, ...prev]);
      setReqItem(null);
      setReqReason('');
      onToast('success', `Submitted request ${res.serviceRequest.requestNumber}.`);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to submit request.'
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-[var(--av-accent)]">
            Employee Self-Service Portal
          </div>
          <h2 className="font-display text-lg font-bold text-[var(--av-text)] mt-0.5">
            Welcome, {currentUser.name}
          </h2>
          <p className="text-xs text-[var(--av-text-subtle)]">
            View equipment assigned to you, report technical issues, request standard hardware/software, and browse self-help guides.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface-muted)] p-1">
          {(
            [
              { id: 'equipment', label: 'My Equipment', icon: HardDrive, visible: true },
              { id: 'tickets', label: 'My Tickets', icon: LifeBuoy, visible: hasHelpdesk },
              { id: 'requests', label: 'Request Hardware/Access', icon: PackageCheck, visible: hasItsm },
              { id: 'kb', label: 'Help Guides', icon: BookOpen, visible: hasKb },
            ] as const
          )
            .filter((item) => item.visible)
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    tab === item.id
                      ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                      : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </div>
      </div>

      {/* My Equipment */}
      {tab === 'equipment' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className={`${hasHelpdesk && !isReadOnly ? 'lg:col-span-2' : 'lg:col-span-3'} rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4`}>
            <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
              Assigned Corporate Hardware ({myAssets.length})
            </h3>
            {myAssets.length === 0 ? (
              <EmptyState
                icon={HardDrive}
                title="No hardware currently matched to your profile"
                description="When IT issues a laptop, monitor, or peripheral to your name, it will appear here with its serial number and warranty status."
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {myAssets.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/40 p-4 space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-[var(--av-accent)]">
                        {a.asset_tag}
                      </span>
                      <span className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        {a.category}
                      </span>
                    </div>
                    <div className="text-sm font-semibold text-[var(--av-text)]">{a.name}</div>
                    <div className="text-xs text-[var(--av-text-subtle)] font-mono">
                      SN: {a.serial_number} · {a.location}
                    </div>
                    {hasHelpdesk && !isReadOnly && (
                      <button
                        type="button"
                        onClick={() => {
                          setAssetId(a.id);
                          setSubject(`Issue with ${a.asset_tag} (${a.name})`);
                          setTab('tickets');
                        }}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--av-accent)] hover:underline"
                      >
                        <LifeBuoy className="h-3.5 w-3.5" />
                        <span>Report an issue with this device</span>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Quick Ticket Card */}
          {hasHelpdesk && !isReadOnly && (
          <form
            onSubmit={handleSubmitTicket}
            className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3.5 h-fit"
          >
            <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
              Report an IT Issue
            </h3>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary (e.g. VPN disconnects)"
              className={INPUT_CLASS}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Ticket['category'])}
                className={INPUT_CLASS}
              >
                <option value="Hardware">Hardware</option>
                <option value="Software">Software</option>
                <option value="Network">Network</option>
                <option value="Access">Access</option>
                <option value="General">General</option>
              </select>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as TicketPriority)}
                className={INPUT_CLASS}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
                <option value="Urgent">Urgent</option>
              </select>
            </div>
            <textarea
              rows={3}
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happened..."
              className={INPUT_CLASS}
            />
            <button
              type="submit"
              disabled={submittingTicket}
              className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{submittingTicket ? 'Submitting...' : 'Submit Helpdesk Ticket'}</span>
            </button>
          </form>
          )}
        </div>
      )}

      {/* My Tickets */}
      {tab === 'tickets' && hasHelpdesk && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] overflow-hidden shadow-[var(--av-card-shadow)]">
            <div className="border-b border-[var(--av-border-subtle)] px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                My Support Tickets ({myTickets.length})
              </h3>
            </div>
            {myTickets.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={LifeBuoy}
                  title="No support tickets submitted"
                  description="Use the form on this page whenever you need help from IT Support."
                />
              </div>
            ) : (
              <div className="divide-y divide-[var(--av-border-subtle)]">
                {myTickets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => openTicketDetail(t)}
                    className="w-full text-left px-5 py-3.5 hover:bg-[var(--av-surface-hover)] flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[var(--av-text)] truncate">
                        <span className="font-mono text-[var(--av-accent)] mr-2">
                          {t.ticketNumber}
                        </span>
                        {t.subject}
                      </div>
                      <div className="text-[11px] text-[var(--av-text-subtle)] mt-0.5">
                        {t.category} · {t.priority} · Updated {t.updatedAt.slice(0, 10)}
                      </div>
                    </div>
                    <span className="text-xs font-semibold text-[var(--av-text-muted)] shrink-0">
                      {t.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4">
            {!selectedTicket ? (
              <div className="text-xs text-[var(--av-text-subtle)] py-6 text-center">
                Select a ticket to view updates, reply to IT, or rate resolved support.
              </div>
            ) : (
              <>
                <div>
                  <div className="font-mono text-xs font-bold text-[var(--av-accent)]">
                    {selectedTicket.ticketNumber}
                  </div>
                  <h4 className="font-display text-sm font-bold text-[var(--av-text)] mt-0.5">
                    {selectedTicket.subject}
                  </h4>
                  <p className="text-xs text-[var(--av-text-muted)] mt-1">
                    {selectedTicket.description}
                  </p>
                </div>

                {!isReadOnly &&
                  (selectedTicket.status === 'Resolved' ||
                    selectedTicket.status === 'Closed') && (
                    <div className="rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/40 p-3 space-y-1.5">
                      <div className="text-[11px] font-semibold text-[var(--av-text)]">
                        Rate Support Experience
                      </div>
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                          <button
                            key={star}
                            type="button"
                            onMouseEnter={() => setCsatHover(star)}
                            onMouseLeave={() => setCsatHover(0)}
                            onClick={() => handleRateCsat(star)}
                            className="p-0.5"
                          >
                            <Star
                              className={`h-4 w-4 ${
                                star <= (csatHover || selectedTicket.csatRating || 0)
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-[var(--av-text-subtle)]'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                <div className="space-y-2 max-h-56 overflow-y-auto border-t border-[var(--av-border-subtle)] pt-3">
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg bg-[var(--av-surface-muted)]/60 p-2.5 text-xs"
                    >
                      <div className="font-semibold text-[var(--av-text)]">
                        {c.authorName}{' '}
                        <span className="text-[10px] font-normal text-[var(--av-text-subtle)]">
                          {c.createdAt.slice(0, 16).replace('T', ' ')}
                        </span>
                      </div>
                      <p className="mt-1 text-[var(--av-text-muted)]">{c.body}</p>
                    </div>
                  ))}
                </div>

                {!isReadOnly && (
                  <form onSubmit={handleSendReply} className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Reply to technician..."
                      className={INPUT_CLASS}
                    />
                    <button
                      type="submit"
                      className="rounded-lg bg-[var(--av-accent)] px-3 py-2 text-xs font-semibold text-white"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Service Catalogue Requests */}
      {tab === 'requests' && hasItsm && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {catalogue.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="text-[11px] font-semibold text-[var(--av-accent)]">
                    {item.category} · Est. {item.estimatedFulfilmentHours}h
                  </div>
                  <h4 className="font-display text-sm font-bold text-[var(--av-text)] mt-1">
                    {item.name}
                  </h4>
                  <p className="text-xs text-[var(--av-text-muted)] mt-1">
                    {item.description}
                  </p>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-[var(--av-border-subtle)]">
                  <span className="text-xs font-mono text-[var(--av-text-subtle)]">
                    {item.defaultCostGhs > 0 ? formatGhs(item.defaultCostGhs) : 'Standard'}
                  </span>
                  {!isReadOnly && (
                    <button
                      type="button"
                      onClick={() => setReqItem(item)}
                      className="rounded-lg bg-[var(--av-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                    >
                      Request
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-4">
            {reqItem && (
              <form
                onSubmit={handleSubmitServiceRequest}
                className="rounded-xl border border-[var(--av-accent)] bg-[var(--av-surface)] p-5 space-y-3"
              >
                <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                  Request: {reqItem.name}
                </h4>
                <textarea
                  rows={3}
                  required
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  placeholder="Business justification..."
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setReqItem(null)}
                    className="rounded-lg border border-[var(--av-border)] px-3 py-1.5 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    Submit Request
                  </button>
                </div>
              </form>
            )}

            <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 space-y-3">
              <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                My Service Requests ({serviceRequests.length})
              </h4>
              {serviceRequests.length === 0 ? (
                <p className="text-xs text-[var(--av-text-subtle)]">
                  No service requests submitted yet.
                </p>
              ) : (
                <div className="space-y-2 text-xs">
                  {serviceRequests.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-lg border border-[var(--av-border-subtle)] p-3"
                    >
                      <div className="flex items-center justify-between font-semibold text-[var(--av-text)]">
                        <span>{r.itemName}</span>
                        <span className="text-[var(--av-accent)]">{r.status}</span>
                      </div>
                      <div className="text-[11px] font-mono text-[var(--av-text-subtle)] mt-0.5">
                        {r.requestNumber} · {r.createdAt.slice(0, 10)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Knowledge Base */}
      {tab === 'kb' && hasKb && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {articles.length === 0 ? (
            <div className="md:col-span-2">
              <EmptyState
                icon={BookOpen}
                title="No public self-help articles published"
                description="IT guides published for staff self-service will appear here."
              />
            </div>
          ) : (
            articles.map((art) => (
              <div
                key={art.id}
                className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-2"
              >
                <div className="text-[11px] font-semibold text-[var(--av-accent)]">
                  {art.category}
                </div>
                <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                  {art.title}
                </h4>
                <p className="text-xs text-[var(--av-text-muted)] leading-relaxed">
                  {art.content}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
