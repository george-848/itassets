import { useEffect, useMemo, useState } from 'react';
import { History, Search } from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type { AuditLogEntry } from '../types/saas.ts';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface AuditLogsViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function AuditLogsView({ tenantCtx, onToast }: AuditLogsViewProps) {
  const cachedLogs = api.peekCache<{ auditLogs: AuditLogEntry[] }>('/api/audit-logs');
  const [logs, setLogs] = useState<AuditLogEntry[]>(() => cachedLogs?.auditLogs ?? []);
  const [loading, setLoading] = useState(!cachedLogs);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  useEffect(() => {
    let active = true;
    const cached = api.peekCache<{ auditLogs: AuditLogEntry[] }>('/api/audit-logs');
    if (cached) {
      setLogs(cached.auditLogs);
      setLoading(false);
    }
    async function load() {
      try {
        const res = await api.listAuditLogs();
        if (active) setLogs(res.auditLogs);
      } catch (err) {
        onToast(
          'error',
          err instanceof ApiError ? err.message : 'Failed to load audit logs.'
        );
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id, tenantCtx?.isAllOrgsView]);

  const actions = useMemo(
    () => Array.from(new Set(logs.map((l) => l.action))).sort(),
    [logs]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((l) => {
      if (actionFilter !== 'ALL' && l.action !== actionFilter) return false;
      if (!q) return true;
      return (
        l.action.toLowerCase().includes(q) ||
        l.actorEmail.toLowerCase().includes(q) ||
        l.summary.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q)
      );
    });
  }, [logs, search, actionFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search actor email, summary, entity..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
            />
          </div>
          <select
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)]"
          >
            <option value="ALL">All Actions</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs font-medium text-[var(--av-text-subtle)] tabular-nums">
          {filtered.length} immutable events
        </span>
      </div>

      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Action</th>
                <th className="py-3 px-4">Actor</th>
                <th className="py-3 px-4">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
              {paginated.length === 0 && !loading ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      icon={History}
                      title="No audit events found"
                      description="Immutable security, asset lifecycle, and administrative actions appear here."
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((l) => (
                  <tr key={l.id} className="hover:bg-[var(--av-surface-hover)]">
                    <td className="py-3 px-4 font-mono text-[11px] text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap">
                      {l.createdAt.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-[var(--av-accent)] whitespace-nowrap">
                      {l.action}
                    </td>
                    <td className="py-3 px-4 text-[var(--av-text-muted)] whitespace-nowrap">
                      {l.actorEmail} <span className="opacity-70">({l.actorRole})</span>
                    </td>
                    <td className="py-3 px-4 text-[var(--av-text)]">{l.summary}</td>
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
          itemLabel="audit entries"
        />
      </div>
    </div>
  );
}
