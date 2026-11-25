import { useMemo, useState } from 'react';
import {
  Archive,
  ArrowDownUp,
  ArrowRightLeft,
  Loader2,
  PackagePlus,
  RotateCcw,
  UserCheck,
  Wrench,
} from 'lucide-react';
import type { Asset, AssetAssignment, MaintenanceLog } from '../types/itams.ts';
import type { AssetTransfer } from '../types/saas.ts';
import { MaintenanceStatusIndicator, formatCurrencyExact } from './StatusText.tsx';

export type TimelineFilter = 'all' | 'assignments' | 'transfers' | 'maintenance';

interface TimelineEvent {
  id: string;
  category: 'assignments' | 'transfers' | 'maintenance' | 'lifecycle';
  kind:
    | 'assignment_issued'
    | 'assignment_returned'
    | 'transfer'
    | 'maintenance'
    | 'acquired'
    | 'disposed';
  date: string;
  sortKey: string;
  title: string;
  meta: string[];
  notes?: string;
  maintenanceStatus?: MaintenanceLog['status'];
  activeCustody?: boolean;
}

interface AssetTimelineProps {
  asset: Asset;
  assignments: AssetAssignment[];
  maintenanceLogs: MaintenanceLog[];
  transfers: AssetTransfer[];
  loading?: boolean;
  compactLimit?: number;
  onViewAll?: () => void;
}

function toTimestampScore(dateStr: string, fallbackCreated?: string): string {
  const datePart = (dateStr || '').slice(0, 10);
  const timePart =
    fallbackCreated && fallbackCreated.length > 10
      ? fallbackCreated.slice(10)
      : 'T00:00:00.000Z';
  return `${datePart}${timePart}`;
}

export function buildAssetTimelineEvents(
  asset: Asset,
  assignments: AssetAssignment[],
  maintenanceLogs: MaintenanceLog[],
  transfers: AssetTransfer[]
): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  for (const a of assignments) {
    const issuedMeta = [
      `Handover ${a.handover_number}`,
      a.employee_department || '',
      a.condition_out ? `Out: ${a.condition_out}` : '',
      a.assigned_by_name ? `Issued by ${a.assigned_by_name}` : '',
    ].filter(Boolean);

    events.push({
      id: `asg-out-${a.id}`,
      category: 'assignments',
      kind: 'assignment_issued',
      date: a.assigned_date,
      sortKey: toTimestampScore(a.assigned_date, a.created_at),
      title: `Assigned to ${a.employee_name || 'Employee'}`,
      meta: issuedMeta,
      notes: a.notes || undefined,
      activeCustody: !a.returned_date && a.status === 'Active',
    });

    if (a.returned_date) {
      events.push({
        id: `asg-in-${a.id}`,
        category: 'assignments',
        kind: 'assignment_returned',
        date: a.returned_date,
        sortKey: `${a.returned_date.slice(0, 10)}T23:59:00.000Z`,
        title: `Returned from ${a.employee_name || 'Employee'}`,
        meta: [
          `Handover ${a.handover_number}`,
          a.condition_in ? `Condition in: ${a.condition_in}` : 'Returned to inventory',
        ],
      });
    }
  }

  for (const tr of transfers) {
    const deptMoved =
      tr.fromDepartment &&
      tr.toDepartment &&
      tr.fromDepartment !== tr.toDepartment;
    events.push({
      id: `tr-${tr.id}`,
      category: 'transfers',
      kind: 'transfer',
      date: tr.transferredAt.slice(0, 10),
      sortKey: tr.transferredAt,
      title: `Transferred: ${tr.fromLocation} → ${tr.toLocation}`,
      meta: [
        deptMoved ? `${tr.fromDepartment} → ${tr.toDepartment}` : '',
        `By ${tr.transferredBy}`,
      ].filter(Boolean),
      notes: tr.reason || undefined,
    });
  }

  for (const m of maintenanceLogs) {
    events.push({
      id: `mnt-${m.id}`,
      category: 'maintenance',
      kind: 'maintenance',
      date: m.service_date,
      sortKey: toTimestampScore(m.service_date, m.created_at),
      title: `${m.maintenance_type}: ${m.issue_description}`,
      meta: [
        m.vendor_or_technician,
        formatCurrencyExact(m.cost),
        m.next_service_date ? `Next service ${m.next_service_date}` : '',
        m.recorded_by_name ? `Logged by ${m.recorded_by_name}` : '',
      ].filter(Boolean),
      notes: m.notes || undefined,
      maintenanceStatus: m.status,
    });
  }

  if (asset.purchase_date) {
    events.push({
      id: `acq-${asset.id}`,
      category: 'lifecycle',
      kind: 'acquired',
      date: asset.purchase_date,
      sortKey: `${asset.purchase_date.slice(0, 10)}T00:00:00.000Z`,
      title: 'Asset Acquired & Registered',
      meta: [
        `${asset.brand} ${asset.model}`,
        formatCurrencyExact(asset.cost),
        `SN ${asset.serial_number}`,
      ],
    });
  }

  if (asset.disposal_status === 'disposed' && asset.disposal_date) {
    events.push({
      id: `disp-${asset.id}`,
      category: 'lifecycle',
      kind: 'disposed',
      date: asset.disposal_date.slice(0, 10),
      sortKey: asset.disposal_date,
      title: 'Asset Decommissioned / Retired',
      meta: [
        asset.disposal_approved_by
          ? `Approved by ${asset.disposal_approved_by}`
          : 'Decommissioned',
      ],
      notes: asset.disposal_reason || undefined,
    });
  }

  return events;
}

function EventNodeIcon({ kind }: { kind: TimelineEvent['kind'] }) {
  switch (kind) {
    case 'assignment_issued':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-blue-500/30 bg-blue-500/12 text-blue-600 dark:text-blue-400">
          <UserCheck className="h-3.5 w-3.5" />
        </span>
      );
    case 'assignment_returned':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
          <RotateCcw className="h-3.5 w-3.5" />
        </span>
      );
    case 'transfer':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-violet-500/30 bg-violet-500/12 text-violet-600 dark:text-violet-400">
          <ArrowRightLeft className="h-3.5 w-3.5" />
        </span>
      );
    case 'maintenance':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-amber-500/30 bg-amber-500/12 text-amber-600 dark:text-amber-400">
          <Wrench className="h-3.5 w-3.5" />
        </span>
      );
    case 'disposed':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-rose-500/30 bg-rose-500/12 text-rose-600 dark:text-rose-400">
          <Archive className="h-3.5 w-3.5" />
        </span>
      );
    case 'acquired':
      return (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-teal-500/30 bg-teal-500/12 text-teal-600 dark:text-teal-400">
          <PackagePlus className="h-3.5 w-3.5" />
        </span>
      );
  }
}

export function AssetTimeline({
  asset,
  assignments,
  maintenanceLogs,
  transfers,
  loading = false,
  compactLimit,
  onViewAll,
}: AssetTimelineProps) {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

  const allEvents = useMemo(
    () => buildAssetTimelineEvents(asset, assignments, maintenanceLogs, transfers),
    [asset, assignments, maintenanceLogs, transfers]
  );

  const counts = useMemo(
    () => ({
      all: allEvents.length,
      assignments: allEvents.filter((e) => e.category === 'assignments').length,
      transfers: allEvents.filter((e) => e.category === 'transfers').length,
      maintenance: allEvents.filter((e) => e.category === 'maintenance').length,
    }),
    [allEvents]
  );

  const visibleEvents = useMemo(() => {
    const filtered =
      filter === 'all'
        ? allEvents
        : allEvents.filter((e) => e.category === filter);
    const sorted = [...filtered].sort((a, b) =>
      sortOrder === 'desc'
        ? b.sortKey.localeCompare(a.sortKey)
        : a.sortKey.localeCompare(b.sortKey)
    );
    return compactLimit ? sorted.slice(0, compactLimit) : sorted;
  }, [allEvents, filter, sortOrder, compactLimit]);

  const totalMaintenanceSpend = useMemo(
    () => maintenanceLogs.reduce((sum, m) => sum + Number(m.cost || 0), 0),
    [maintenanceLogs]
  );

  if (loading) {
    return (
      <div className="space-y-2.5 rounded-xl border border-[var(--av-border)] p-4">
        <div className="flex items-center gap-2 text-xs text-[var(--av-text-subtle)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--av-accent)]" />
          <span>Building asset lifecycle timeline...</span>
        </div>
        <div className="h-10 w-full rounded-lg av-shimmer" />
        <div className="h-10 w-5/6 rounded-lg av-shimmer" />
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      {!compactLimit && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-[var(--av-surface-muted)] p-1 border border-[var(--av-border-subtle)]">
              {(
                [
                  { id: 'all', label: `All (${counts.all})` },
                  { id: 'assignments', label: `Assignments (${counts.assignments})` },
                  { id: 'transfers', label: `Transfers (${counts.transfers})` },
                  { id: 'maintenance', label: `Maintenance (${counts.maintenance})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    filter === tab.id
                      ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                      : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() =>
                setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
            >
              <ArrowDownUp className="h-3.5 w-3.5" />
              <span>{sortOrder === 'desc' ? 'Newest first' : 'Oldest first'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--av-text-subtle)]">
            <span>{assignments.length} handover{assignments.length === 1 ? '' : 's'}</span>
            <span aria-hidden="true">·</span>
            <span>{transfers.length} transfer{transfers.length === 1 ? '' : 's'}</span>
            <span aria-hidden="true">·</span>
            <span>{maintenanceLogs.length} maintenance log{maintenanceLogs.length === 1 ? '' : 's'}</span>
            {totalMaintenanceSpend > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[var(--av-text-muted)] tabular-nums">
                  {formatCurrencyExact(totalMaintenanceSpend)} total service cost
                </span>
              </>
            )}
          </div>
        </>
      )}

      {visibleEvents.length === 0 ? (
        <p className="rounded-xl border border-[var(--av-border)] p-4 text-xs text-[var(--av-text-subtle)]">
          No matching historical events recorded for this filter.
        </p>
      ) : (
        <div className="rounded-xl border border-[var(--av-border)] p-4">
          <ol className="relative space-y-5">
            {visibleEvents.map((event, idx) => {
              const isLast = idx === visibleEvents.length - 1;
              return (
                <li key={event.id} className="relative flex gap-3.5">
                  {!isLast && (
                    <span
                      aria-hidden="true"
                      className="absolute left-3.5 top-8 -bottom-5 w-px -translate-x-1/2 bg-[var(--av-border)]"
                    />
                  )}
                  <div className="relative z-10 shrink-0 pt-0.5 bg-[var(--av-surface)]">
                    <EventNodeIcon kind={event.kind} />
                  </div>
                  <div className="min-w-0 flex-1 pb-0.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--av-text)]">
                        {event.title}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--av-text-subtle)] tabular-nums shrink-0">
                        {event.date}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--av-text-subtle)]">
                      {event.activeCustody && (
                        <>
                          <span className="font-semibold text-blue-600 dark:text-blue-400">
                            Active Custody
                          </span>
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      {event.maintenanceStatus && (
                        <>
                          <MaintenanceStatusIndicator status={event.maintenanceStatus} />
                          <span aria-hidden="true">·</span>
                        </>
                      )}
                      {event.meta.map((item, mIdx) => (
                        <span key={mIdx} className="inline-flex items-center gap-2">
                          {mIdx > 0 && <span aria-hidden="true">·</span>}
                          <span>{item}</span>
                        </span>
                      ))}
                    </div>

                    {event.notes && (
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--av-text-muted)]">
                        {event.notes}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {compactLimit && allEvents.length > compactLimit && onViewAll && (
            <div className="mt-4 border-t border-[var(--av-border-subtle)] pt-3 flex items-center justify-between">
              <span className="text-[11px] text-[var(--av-text-subtle)]">
                Showing latest {compactLimit} of {allEvents.length} lifecycle events
              </span>
              <button
                type="button"
                onClick={onViewAll}
                className="text-xs font-semibold text-[var(--av-accent)] hover:underline"
              >
                View full timeline →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
