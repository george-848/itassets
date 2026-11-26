import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { NotificationType, SystemNotification } from '../types/itams.ts';
import type { NavSection } from './DashboardView.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface NotificationsViewProps {
  notifications: SystemNotification[];
  onRefresh: () => Promise<void>;
  onOpenAsset: (assetId: string) => void;
  onOpenMaintenance: () => void;
  onNavigate?: (section: NavSection) => void;
  canNavigate?: (section: NavSection) => boolean;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function NotificationsView({
  notifications,
  onRefresh,
  onOpenAsset,
  onOpenMaintenance,
  onNavigate,
  canNavigate,
  onToast,
}: NotificationsViewProps) {
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | NotificationType>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const unreadKeys = useMemo(
    () => notifications.filter((n) => !n.acknowledged).map((n) => n.id),
    [notifications]
  );

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (filter === 'UNREAD') return !n.acknowledged;
      if (filter !== 'ALL' && n.type !== filter) return false;
      return true;
    });
  }, [notifications, filter]);

  useEffect(() => {
    setPage(1);
  }, [filter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const handleAcknowledge = async (keys: string[], singleId?: string) => {
    if (keys.length === 0) return;
    setBusyId(singleId ?? 'ALL');
    try {
      await api.acknowledgeNotifications(keys);
      onToast(
        'success',
        keys.length === 1
          ? 'Alert acknowledged.'
          : `${keys.length} alerts acknowledged.`
      );
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to acknowledge alerts.'
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] p-1">
          {(
            [
              ['ALL', `All Alerts (${notifications.length})`],
              ['UNREAD', `Unacknowledged (${unreadKeys.length})`],
              ['expiring_warranty', 'Expiring Warranties'],
              ['overdue_maintenance', 'Overdue Maintenance'],
              ['replacement_due', 'Replacement Due'],
              ['sla_breach', 'SLA Breaches'],
              ['licence_expiry', 'Licence Renewals'],
              ['subscription_alert', 'Subscription'],
            ] as const
          ).map(([key, label]) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active
                    ? 'text-[var(--av-text)]'
                    : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="notifications-tab-indicator"
                    transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                    className="absolute inset-0 rounded-md bg-[var(--av-surface)] border border-[var(--av-border-subtle)] shadow-xs"
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>

        <motion.button
          whileTap={{ scale: 0.985 }}
          type="button"
          onClick={() => handleAcknowledge(unreadKeys)}
          disabled={unreadKeys.length === 0 || busyId === 'ALL'}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <CheckCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
          <span>Acknowledge All Unread</span>
        </motion.button>
      </div>

      {/* Alerts List */}
      <AnimatePresence mode="wait">
        <motion.div
          key={filter}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden"
        >
          {paginated.length === 0 ? (
            <EmptyState
              icon={Bell}
              title="No notifications in this view"
              description="Warranty expirations, SLA breaches, licence renewals, and overdue service alerts appear here automatically."
              actionLabel={filter !== 'ALL' ? 'Show All Alerts' : undefined}
              onAction={filter !== 'ALL' ? () => setFilter('ALL') : undefined}
            />
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)]">
              {paginated.map((n) => {
                const Icon =
                  n.type === 'overdue_maintenance'
                    ? Clock
                    : n.type === 'replacement_due'
                      ? RefreshCw
                      : AlertTriangle;

                const typeLabel =
                  n.type === 'expiring_warranty'
                    ? 'Warranty Alert'
                    : n.type === 'overdue_maintenance'
                      ? 'Overdue Maintenance'
                      : n.type === 'sla_breach'
                        ? 'Ticket SLA Breach'
                        : n.type === 'licence_expiry'
                          ? 'Licence Expiry'
                          : n.type === 'subscription_alert'
                            ? 'Subscription Alert'
                            : 'Replacement Review';

                const openTarget = () => {
                  if (n.entity_type === 'maintenance') onOpenMaintenance();
                  else if (n.entity_type === 'ticket' && onNavigate) onNavigate('tickets');
                  else if (n.entity_type === 'licence' && onNavigate) onNavigate('licences');
                  else if (n.entity_type === 'subscription' && onNavigate) onNavigate('billing');
                  else if (n.asset_id) onOpenAsset(n.asset_id);
                };

                const openLabel =
                  n.entity_type === 'maintenance'
                    ? 'Open Service Log'
                    : n.entity_type === 'ticket'
                      ? 'Open Helpdesk'
                      : n.entity_type === 'licence'
                        ? 'Open Licences'
                        : n.entity_type === 'subscription'
                          ? 'Open Billing'
                          : 'Inspect Asset';

                const targetSection: NavSection | null =
                  n.entity_type === 'maintenance'
                    ? 'maintenance'
                    : n.entity_type === 'ticket'
                      ? 'tickets'
                      : n.entity_type === 'licence'
                        ? 'licences'
                        : n.entity_type === 'subscription'
                          ? 'billing'
                          : n.asset_id
                            ? 'assets'
                            : null;
                const canOpenTarget = Boolean(
                  targetSection && (!canNavigate || canNavigate(targetSection))
                );

                return (
                  <div
                    key={n.id}
                    className={`p-4 sm:px-5 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                      n.acknowledged
                        ? 'bg-[var(--av-surface-muted)]/60 opacity-75'
                        : 'hover:bg-[var(--av-surface-hover)]'
                    }`}
                  >
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${
                          n.severity === 'critical'
                            ? 'border-red-200/80 dark:border-red-500/25 bg-red-50 dark:bg-red-500/15 text-red-700 dark:text-red-400'
                            : 'border-amber-200/80 dark:border-amber-500/25 bg-amber-50 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--av-text-muted)]">
                          <span
                            className={`font-semibold ${
                              n.severity === 'critical'
                                ? 'text-red-700 dark:text-red-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {typeLabel}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono font-medium text-[var(--av-text)]">
                            {n.asset_tag}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            Ref Date: {n.due_date}
                          </span>
                          {n.acknowledged && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                                Acknowledged
                              </span>
                            </>
                          )}
                        </div>
                        <h3 className="mt-1 text-sm font-semibold text-[var(--av-text)]">
                          {n.title}
                        </h3>
                        <p className="mt-0.5 text-xs text-[var(--av-text-muted)] leading-relaxed">
                          {n.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {canOpenTarget && (
                        <button
                          type="button"
                          onClick={openTarget}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-1.5 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap"
                        >
                          <span>{openLabel}</span>
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      )}

                      {!n.acknowledged && (
                        <motion.button
                          whileTap={{ scale: 0.97 }}
                          type="button"
                          onClick={() => handleAcknowledge([n.id], n.id)}
                          disabled={busyId === n.id}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>Acknowledge</span>
                        </motion.button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <DataPagination
            totalItems={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="alerts"
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
