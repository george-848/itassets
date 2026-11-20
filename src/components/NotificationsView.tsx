import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type { NotificationType, SystemNotification } from '../types/itams.ts';

interface NotificationsViewProps {
  notifications: SystemNotification[];
  onRefresh: () => Promise<void>;
  onOpenAsset: (assetId: string) => void;
  onOpenMaintenance: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function NotificationsView({
  notifications,
  onRefresh,
  onOpenAsset,
  onOpenMaintenance,
  onToast,
}: NotificationsViewProps) {
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | NotificationType>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

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
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {(
            [
              ['ALL', `All Alerts (${notifications.length})`],
              ['UNREAD', `Unacknowledged (${unreadKeys.length})`],
              ['expiring_warranty', 'Expiring Warranties'],
              ['overdue_maintenance', 'Overdue Maintenance'],
              ['replacement_due', 'Replacement Due'],
            ] as const
          ).map(([key, label]) => {
            const active = filter === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setFilter(key)}
                className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="notifications-tab-indicator"
                    transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-0 rounded-md bg-white shadow-xs"
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => handleAcknowledge(unreadKeys)}
          disabled={unreadKeys.length === 0 || busyId === 'ALL'}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
        >
          <CheckCheck className="h-4 w-4 text-emerald-700" />
          <span>Acknowledge All Unread</span>
        </button>
      </div>

      {/* Alerts List */}
      <AnimatePresence mode="wait">
        <motion.div
          key={filter}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100"
        >
        {filtered.length === 0 ? (
          <div className="py-14 text-center px-4">
            <p className="text-sm font-medium text-slate-800">
              No notifications in this view
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Warranty expirations, overdue service tickets, and lifecycle refresh
              alerts appear here automatically.
            </p>
          </div>
        ) : (
          filtered.map((n) => {
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
                  : 'Replacement Review';

            return (
              <div
                key={n.id}
                className={`p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                  n.acknowledged ? 'bg-slate-50/40 opacity-75' : 'bg-white'
                }`}
              >
                <div className="flex items-start gap-3.5 min-w-0">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      n.severity === 'critical'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span
                        className={`font-semibold ${
                          n.severity === 'critical'
                            ? 'text-red-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {typeLabel}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono text-slate-700">{n.asset_tag}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Ref Date: {n.due_date}
                      </span>
                      {n.acknowledged && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700 font-medium">
                            Acknowledged
                          </span>
                        </>
                      )}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-slate-900">
                      {n.title}
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
                      {n.description}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    onClick={() =>
                      n.entity_type === 'maintenance'
                        ? onOpenMaintenance()
                        : onOpenAsset(n.asset_id)
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                  >
                    <span>
                      {n.entity_type === 'maintenance'
                        ? 'Open Service Log'
                        : 'Inspect Asset'}
                    </span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>

                  {!n.acknowledged && (
                    <button
                      type="button"
                      onClick={() => handleAcknowledge([n.id], n.id)}
                      disabled={busyId === n.id}
                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Acknowledge</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
