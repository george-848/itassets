import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Database,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  api,
  ApiError,
  type PlatformDbCollectionCategory,
  type PlatformDbCollectionMeta,
} from '../lib/api.ts';
import type { PlanCode, Tenant, TenantType } from '../types/saas.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface PlatformDatabaseTabProps {
  onRefreshPlatform: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-xs text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

const CATEGORY_ORDER: PlatformDbCollectionCategory[] = [
  'Core SaaS',
  'ITAM & Custody',
  'ITSM & Helpdesk',
  'Procurement & Vendors',
  'Governance & Logs',
];

function getRecordDisplayName(rec: Record<string, unknown>): string {
  const candidates = [
    rec.name,
    rec.title,
    rec.subject,
    rec.full_name,
    rec.softwareName,
    rec.asset_tag ? `${rec.asset_tag} · ${rec.name ?? ''}` : null,
    rec.ticketNumber ? `${rec.ticketNumber} · ${rec.subject ?? ''}` : null,
    rec.incidentNumber ? `${rec.incidentNumber} · ${rec.title ?? ''}` : null,
    rec.poNumber ? `${rec.poNumber} · ${rec.itemName ?? ''}` : null,
    rec.reference,
    rec.invoiceNumber,
    rec.email,
    rec.issue_description,
    rec.summary,
    rec.label,
    rec.action,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim()) return val.trim();
  }
  return String(rec.id ?? '—');
}

function getRecordTenantLabel(
  rec: Record<string, unknown>,
  meta: PlatformDbCollectionMeta | undefined
): string {
  if (!meta?.tenantField) return 'Platform';
  const val = rec[meta.tenantField];
  return typeof val === 'string' && val ? val : '—';
}

function getRecordTimestamp(rec: Record<string, unknown>): string {
  const raw = rec.updatedAt || rec.updated_at || rec.createdAt || rec.created_at || rec.issuedAt;
  if (typeof raw !== 'string' || !raw) return '—';
  return raw.slice(0, 16).replace('T', ' ');
}

function buildStarterTemplate(
  collection: string,
  meta: PlatformDbCollectionMeta | undefined,
  tenantId: string
): Record<string, unknown> {
  const activeTid = tenantId || 'ten-default-01';
  switch (collection) {
    case 'assets':
      return {
        asset_tag: `AV-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        name: 'MacBook Pro 14"',
        category: 'Laptops',
        brand: 'Apple',
        model: 'M3 Pro',
        status: 'Available',
        location: 'Main Office',
        cost: 18500,
        tenant_id: activeTid,
        org_id: 'org-default-01',
      };
    case 'employees':
      return {
        employee_code: `EMP-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        full_name: 'Kofi Boateng',
        email: 'kofi.boateng@company.com',
        department: 'IT Infrastructure',
        job_title: 'Systems Engineer',
        phone: '+233 24 000 0000',
        location: 'Main Office',
        status: 'active',
        tenant_id: activeTid,
        org_id: 'org-default-01',
      };
    case 'users':
      return {
        name: 'New Operator',
        email: 'operator@company.com',
        password: 'AssetVault@2026',
        role: 'staff',
        department: 'IT Operations',
        status: 'active',
        is_super_admin: false,
      };
    case 'tickets':
      return {
        tenantId: activeTid,
        orgId: 'org-default-01',
        ticketNumber: `TKT-${Math.floor(1000 + Math.random() * 9000)}`,
        subject: 'Workstation Provisioning Request',
        description: 'Setup laptop and corporate email access.',
        category: 'Hardware',
        priority: 'Medium',
        status: 'Open',
      };
    default:
      return meta?.tenantField === 'tenant_id'
        ? { tenant_id: activeTid, org_id: 'org-default-01', status: 'active' }
        : meta?.tenantField === 'tenantId'
          ? { tenantId: activeTid, orgId: 'org-default-01', name: 'New Record', status: 'active' }
          : { name: 'New Record', status: 'active' };
  }
}

export function PlatformDatabaseTab({
  onRefreshPlatform,
  onToast,
}: PlatformDatabaseTabProps) {
  const cachedOverviewInit = api.peekCache<{
    engine: string;
    collections: PlatformDbCollectionMeta[];
    tenants: Array<{
      id: string;
      name: string;
      type: TenantType;
      planCode: PlanCode;
      status: Tenant['status'];
    }>;
  }>('/api/platform/database/overview');
  const cachedRecordsInit = api.peekCache<{
    collection: string;
    meta: PlatformDbCollectionMeta;
    totalCount: number;
    records: Array<Record<string, unknown>>;
  }>('/api/platform/database/records?collection=assets&limit=200');

  const [engine, setEngine] = useState<string>(
    () => cachedOverviewInit?.engine ?? 'mongodb'
  );
  const [collections, setCollections] = useState<PlatformDbCollectionMeta[]>(
    () => cachedOverviewInit?.collections ?? []
  );
  const [tenants, setTenants] = useState<
    Array<{
      id: string;
      name: string;
      type: TenantType;
      planCode: PlanCode;
      status: Tenant['status'];
    }>
  >(() => cachedOverviewInit?.tenants ?? []);

  const [selectedCollection, setSelectedCollection] = useState<string>('assets');
  const [tenantFilter, setTenantFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [records, setRecords] = useState<Array<Record<string, unknown>>>(
    () => cachedRecordsInit?.records ?? []
  );
  const [totalCount, setTotalCount] = useState<number>(
    () => cachedRecordsInit?.totalCount ?? 0
  );
  const [loadingOverview, setLoadingOverview] = useState<boolean>(false);
  const [loadingRecords, setLoadingRecords] = useState<boolean>(false);

  // Create / Edit Modal
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [editingRecordId, setEditingRecordId] = useState<string>('');
  const [quickStatus, setQuickStatus] = useState<string>('');
  const [quickLabel, setQuickLabel] = useState<string>('');
  const [editorJson, setEditorJson] = useState<string>('{}');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingRecord, setSavingRecord] = useState<boolean>(false);

  // Single Delete Confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    collection: string;
    id: string;
    label: string;
  } | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<boolean>(false);

  // Tenant Operations Panel
  const [opTenantId, setOpTenantId] = useState<string>('');
  const [opCollection, setOpCollection] = useState<string>('assets');
  const [runningTenantOp, setRunningTenantOp] = useState<boolean>(false);
  const [tenantConfirm, setTenantConfirm] = useState<{
    action:
      | 'delete_collection_data'
      | 'reset_tenant_workspace'
      | 'delete_tenant_completely';
    title: string;
    description: string;
    confirmLabel: string;
  } | null>(null);

  // Reset Individual Collection Panel
  const [resetTargetCol, setResetTargetCol] = useState<string>('assets');
  const [resetColTenantScope, setResetColTenantScope] = useState<string>('');
  const [resetColConfirmText, setResetColConfirmText] = useState<string>('');
  const [resettingCol, setResettingCol] = useState<boolean>(false);

  const selectedMeta = useMemo(
    () => collections.find((c) => c.name === selectedCollection),
    [collections, selectedCollection]
  );

  const groupedCollections = useMemo(() => {
    const map = new Map<PlatformDbCollectionCategory, PlatformDbCollectionMeta[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const col of collections) {
      const bucket = map.get(col.category) ?? [];
      bucket.push(col);
      map.set(col.category, bucket);
    }
    return map;
  }, [collections]);

  const loadOverview = async (overrideTenantId?: string) => {
    const tid = overrideTenantId !== undefined ? overrideTenantId : tenantFilter;
    const overviewPath = tid
      ? `/api/platform/database/overview?tenantId=${encodeURIComponent(tid)}`
      : '/api/platform/database/overview';
    const cached = api.peekCache<{
      engine: string;
      collections: PlatformDbCollectionMeta[];
      tenants: Array<{
        id: string;
        name: string;
        type: TenantType;
        planCode: PlanCode;
        status: Tenant['status'];
      }>;
    }>(overviewPath);
    if (cached) {
      setEngine(cached.engine);
      setCollections(cached.collections);
      setTenants(cached.tenants);
      if (!opTenantId && cached.tenants[0]) {
        setOpTenantId(cached.tenants[0].id);
      }
    } else {
      setLoadingOverview(true);
    }
    try {
      const res = await api.getPlatformDatabaseOverview(tid || undefined);
      setEngine(res.engine);
      setCollections(res.collections);
      setTenants(res.tenants);
      if (!opTenantId && res.tenants[0]) {
        setOpTenantId(res.tenants[0].id);
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load database overview.'
      );
    } finally {
      setLoadingOverview(false);
    }
  };

  const loadRecords = async (
    col = selectedCollection,
    tid = tenantFilter,
    q = searchQuery
  ) => {
    const qs = new URLSearchParams();
    qs.set('collection', col);
    if (tid) qs.set('tenantId', tid);
    if (q.trim()) qs.set('q', q.trim());
    qs.set('limit', '200');
    const cached = api.peekCache<{
      collection: string;
      meta: PlatformDbCollectionMeta;
      totalCount: number;
      records: Array<Record<string, unknown>>;
    }>(`/api/platform/database/records?${qs.toString()}`);
    if (cached) {
      setRecords(cached.records);
      setTotalCount(cached.totalCount);
    } else {
      setLoadingRecords(true);
    }
    try {
      const res = await api.getPlatformDatabaseRecords({
        collection: col,
        tenantId: tid || undefined,
        q: q.trim() || undefined,
        limit: 200,
      });
      setRecords(res.records);
      setTotalCount(res.totalCount);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to query database collection.'
      );
    } finally {
      setLoadingRecords(false);
    }
  };

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    void loadOverview(tenantFilter);
    void loadRecords(selectedCollection, tenantFilter, searchQuery);
  }, [selectedCollection, tenantFilter]);

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    void loadRecords(selectedCollection, tenantFilter, searchQuery);
  };

  const openCreateModal = () => {
    const starter = buildStarterTemplate(selectedCollection, selectedMeta, tenantFilter);
    setEditorMode('create');
    setEditingRecordId('');
    setQuickStatus(String(starter.status ?? 'active'));
    setQuickLabel(getRecordDisplayName(starter));
    setEditorJson(JSON.stringify(starter, null, 2));
    setEditorError(null);
  };

  const openEditModal = (rec: Record<string, unknown>) => {
    const clean = { ...rec };
    delete clean._id;
    delete clean.password_hash;
    setEditorMode('edit');
    setEditingRecordId(String(rec.id ?? ''));
    setQuickStatus(typeof rec.status === 'string' ? rec.status : '');
    setQuickLabel(getRecordDisplayName(rec));
    setEditorJson(JSON.stringify(clean, null, 2));
    setEditorError(null);
  };

  const syncQuickFieldToJson = (field: 'status' | 'label', value: string) => {
    try {
      const parsed = JSON.parse(editorJson) as Record<string, unknown>;
      if (field === 'status') {
        setQuickStatus(value);
        parsed.status = value;
      } else {
        setQuickLabel(value);
        if ('name' in parsed) parsed.name = value;
        else if ('title' in parsed) parsed.title = value;
        else if ('subject' in parsed) parsed.subject = value;
        else if ('full_name' in parsed) parsed.full_name = value;
      }
      setEditorJson(JSON.stringify(parsed, null, 2));
    } catch {
      if (field === 'status') setQuickStatus(value);
      else setQuickLabel(value);
    }
  };

  const handleSaveRecord = async (e: FormEvent) => {
    e.preventDefault();
    setEditorError(null);
    let parsed: Record<string, unknown>;
    try {
      const raw = JSON.parse(editorJson);
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error('JSON must be a plain object.');
      }
      parsed = raw as Record<string, unknown>;
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Invalid JSON payload.');
      return;
    }

    setSavingRecord(true);
    try {
      if (editorMode === 'create') {
        await api.createPlatformDatabaseRecord(selectedCollection, parsed);
        onToast('success', `Created new record in "${selectedMeta?.label || selectedCollection}".`);
      } else if (editorMode === 'edit') {
        await api.updatePlatformDatabaseRecord(
          selectedCollection,
          editingRecordId,
          parsed
        );
        onToast('success', `Updated record ${editingRecordId} in "${selectedMeta?.label || selectedCollection}".`);
      }
      setEditorMode(null);
      await Promise.all([loadOverview(), loadRecords(), onRefreshPlatform()]);
    } catch (err) {
      setEditorError(
        err instanceof ApiError ? err.message : 'Failed to save database record.'
      );
    } finally {
      setSavingRecord(false);
    }
  };

  const handleConfirmDeleteRecord = async () => {
    if (!deleteTarget) return;
    setDeletingRecord(true);
    try {
      await api.deletePlatformDatabaseRecord(deleteTarget.collection, deleteTarget.id);
      onToast('success', `Deleted record "${deleteTarget.label}" (${deleteTarget.id}).`);
      setDeleteTarget(null);
      await Promise.all([loadOverview(), loadRecords(), onRefreshPlatform()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete record.'
      );
    } finally {
      setDeletingRecord(false);
    }
  };

  const handleConfirmTenantOp = async () => {
    if (!tenantConfirm || !opTenantId) return;
    setRunningTenantOp(true);
    try {
      const res = await api.runPlatformTenantDatabaseOp({
        tenantId: opTenantId,
        action: tenantConfirm.action,
        collection:
          tenantConfirm.action === 'delete_collection_data' ? opCollection : undefined,
      });
      onToast('success', res.message);
      setTenantConfirm(null);
      if (tenantConfirm.action === 'delete_tenant_completely' && tenantFilter === opTenantId) {
        setTenantFilter('');
      }
      await Promise.all([loadOverview(), loadRecords(), onRefreshPlatform()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Tenant database operation failed.'
      );
    } finally {
      setRunningTenantOp(false);
    }
  };

  const expectedResetCode = `RESET_${resetTargetCol.toUpperCase()}`;

  const handleResetIndividualCollection = async (e: FormEvent) => {
    e.preventDefault();
    if (resetColConfirmText.trim() !== expectedResetCode) return;
    setResettingCol(true);
    try {
      const res = await api.resetPlatformIndividualCollection({
        collection: resetTargetCol,
        tenantId: resetColTenantScope || undefined,
        confirm: expectedResetCode,
      });
      onToast('success', res.message);
      setResetColConfirmText('');
      await Promise.all([loadOverview(), loadRecords(), onRefreshPlatform()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to reset individual collection.'
      );
    } finally {
      setResettingCol(false);
    }
  };

  const activeOpTenant = tenants.find((t) => t.id === opTenantId);
  const tenantResettableCols = collections.filter(
    (c) => c.tenantScoped && c.name !== 'tenants' && c.canReset
  );
  const individuallyResettableCols = collections.filter((c) => c.canReset);

  return (
    <div className="space-y-5">
      {/* Control Header */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)] flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[var(--av-accent)]" />
            <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
              Platform Database Workbench
            </h3>
          </div>
          <span className="font-mono text-[11px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
            Engine: {engine.toUpperCase()}
          </span>
          <span className="text-xs text-[var(--av-text-subtle)] tabular-nums">
            {collections.reduce((sum, c) => sum + c.count, 0)} total records across {collections.length} collections
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tenantFilter}
            onChange={(e) => setTenantFilter(e.target.value)}
            aria-label="Filter database by tenant"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-1.5 text-xs text-[var(--av-text)] focus:border-[var(--av-accent)] focus:outline-none"
          >
            <option value="">All Tenants (Global View)</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.type.toUpperCase()})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void Promise.all([loadOverview(), loadRecords()])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingOverview || loadingRecords ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>

          {selectedMeta?.canCreate && (
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Record</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Collection Browser + Data Table */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Collections Sidebar */}
        <div className="lg:col-span-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="border-b border-[var(--av-border-subtle)] px-4 py-3 text-xs font-semibold text-[var(--av-text)]">
            Database Collections
          </div>
          <div className="max-h-[540px] overflow-y-auto p-2 space-y-3">
            {CATEGORY_ORDER.map((cat) => {
              const items = groupedCollections.get(cat) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={cat} className="space-y-1">
                  <div className="px-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--av-text-subtle)]">
                    {cat}
                  </div>
                  {items.map((col) => {
                    const active = col.name === selectedCollection;
                    return (
                      <button
                        key={col.name}
                        type="button"
                        onClick={() => setSelectedCollection(col.name)}
                        className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                          active
                            ? 'bg-[var(--av-accent)] text-white font-semibold'
                            : 'text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)]'
                        }`}
                      >
                        <span className="truncate">{col.label}</span>
                        <span
                          className={`ml-2 font-mono text-[11px] tabular-nums ${
                            active ? 'text-white/90' : 'text-[var(--av-text-subtle)]'
                          }`}
                        >
                          {col.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>

        {/* Records Inspector Table */}
        <div className="lg:col-span-9 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="border-b border-[var(--av-border-subtle)] px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div>
              <div className="font-display text-sm font-bold text-[var(--av-text)]">
                {selectedMeta?.label || selectedCollection}{' '}
                <span className="font-mono text-xs font-normal text-[var(--av-text-subtle)]">
                  ({totalCount} matching)
                </span>
              </div>
              <div className="text-[11px] text-[var(--av-text-subtle)]">
                Collection key: <span className="font-mono">{selectedCollection}</span>
                {tenantFilter ? ` · Tenant: ${tenantFilter}` : ' · All tenants'}
              </div>
            </div>

            <form onSubmit={handleSearchSubmit} className="flex items-center gap-1.5">
              <div className="relative">
                <Search className="h-3.5 w-3.5 text-[var(--av-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search JSON fields..."
                  className="w-48 sm:w-56 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-8 pr-3 py-1.5 text-xs text-[var(--av-text)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none"
                />
              </div>
              <button
                type="submit"
                className="rounded-lg border border-[var(--av-border)] px-3 py-1.5 text-xs font-semibold text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
              >
                Filter
              </button>
            </form>
          </div>

          <div className="overflow-x-auto max-h-[480px]">
            {records.length === 0 && !loadingRecords ? (
              <div className="p-10 text-center text-xs text-[var(--av-text-subtle)]">
                No records found in {selectedCollection}
                {tenantFilter ? ' for this tenant' : ''}.
              </div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-[var(--av-surface-muted)] border-b border-[var(--av-border)] text-[11px] font-semibold text-[var(--av-text-muted)]">
                  <tr>
                    <th className="py-2.5 px-3.5">Record ID</th>
                    <th className="py-2.5 px-3.5">Primary Display</th>
                    <th className="py-2.5 px-3.5">Tenant</th>
                    <th className="py-2.5 px-3.5">Status / Role</th>
                    <th className="py-2.5 px-3.5">Timestamp</th>
                    <th className="py-2.5 px-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {records.map((rec, idx) => {
                    const id = String(rec.id ?? idx);
                    const display = getRecordDisplayName(rec);
                    const statusVal = String(rec.status ?? rec.role ?? rec.type ?? '—');
                    return (
                      <tr key={id} className="hover:bg-[var(--av-surface-hover)]">
                        <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--av-accent)] whitespace-nowrap">
                          {id}
                        </td>
                        <td className="py-2.5 px-3.5 font-medium text-[var(--av-text)] max-w-[240px] truncate">
                          {display}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--av-text-muted)] whitespace-nowrap">
                          {getRecordTenantLabel(rec, selectedMeta)}
                        </td>
                        <td className="py-2.5 px-3.5 text-[11px] font-semibold text-[var(--av-text-muted)]">
                          {statusVal}
                        </td>
                        <td className="py-2.5 px-3.5 font-mono text-[11px] text-[var(--av-text-subtle)] whitespace-nowrap tabular-nums">
                          {getRecordTimestamp(rec)}
                        </td>
                        <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            {selectedMeta?.canEdit && (
                              <button
                                type="button"
                                onClick={() => openEditModal(rec)}
                                title="Edit record fields"
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--av-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                              >
                                <Pencil className="h-3 w-3" />
                                <span>Edit</span>
                              </button>
                            )}
                            {selectedMeta?.canDelete && (
                              <button
                                type="button"
                                onClick={() =>
                                  setDeleteTarget({
                                    collection: selectedCollection,
                                    id,
                                    label: display,
                                  })
                                }
                                title="Delete individual record"
                                className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Targeted Tenant Data Deletion & Individual Collection Reset */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Delete Particular Tenant Data */}
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                Tenant-Scoped Data Cleanup &amp; Purge
              </h4>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Delete a particular tenant&apos;s data from one collection, wipe its operational workspace while keeping the tenant/users, or purge the tenant completely.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                Target Tenant
              </label>
              <select
                value={opTenantId}
                onChange={(e) => setOpTenantId(e.target.value)}
                className={INPUT_CLASS}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.id})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                Collection (for single-table delete)
              </label>
              <select
                value={opCollection}
                onChange={(e) => setOpCollection(e.target.value)}
                className={INPUT_CLASS}
              >
                {tenantResettableCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label} ({c.name})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={!activeOpTenant || runningTenantOp}
              onClick={() => {
                if (!activeOpTenant) return;
                setTenantConfirm({
                  action: 'delete_collection_data',
                  title: `Delete ${opCollection} Data for Tenant`,
                  description: `Remove all "${opCollection}" records belonging to "${activeOpTenant.name}"? Other collections for this tenant remain untouched.`,
                  confirmLabel: 'Delete Collection Data',
                });
              }}
              className="rounded-lg border border-[var(--av-border)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] disabled:opacity-50"
            >
              Delete Tenant&apos;s {opCollection}
            </button>

            <button
              type="button"
              disabled={!activeOpTenant || runningTenantOp}
              onClick={() => {
                if (!activeOpTenant) return;
                setTenantConfirm({
                  action: 'reset_tenant_workspace',
                  title: 'Reset Tenant Operational Database',
                  description: `Clear all assets, employees, assignments, maintenance logs, tickets, ITSM records, procurement, and logs for "${activeOpTenant.name}"? The tenant profile, client orgs, and user accounts remain intact.`,
                  confirmLabel: 'Reset Workspace Data',
                });
              }}
              className="rounded-lg border border-amber-400/70 bg-amber-50/70 dark:bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-500/20 disabled:opacity-50"
            >
              Reset Tenant Operational Data
            </button>

            <button
              type="button"
              disabled={
                !activeOpTenant ||
                activeOpTenant.id === 'ten-default-01' ||
                runningTenantOp
              }
              onClick={() => {
                if (!activeOpTenant) return;
                setTenantConfirm({
                  action: 'delete_tenant_completely',
                  title: 'Purge Entire Tenant & All Data',
                  description: `Permanently delete tenant "${activeOpTenant.name}", its subscription, client orgs, sites, assets, employees, tickets, and exclusive user accounts?`,
                  confirmLabel: 'Purge Tenant Completely',
                });
              }}
              className="rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Purge Tenant Completely
            </button>
          </div>
        </div>

        {/* Reset Individual Database / Collection */}
        <form
          onSubmit={handleResetIndividualCollection}
          className="rounded-xl border border-rose-300/60 dark:border-rose-500/30 bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4"
        >
          <div className="flex items-start gap-2.5">
            <RotateCcw className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="font-display text-sm font-bold text-rose-700 dark:text-rose-400">
                Reset Individual Database / Collection
              </h4>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                Clear or restore an individual collection without affecting the rest of the database. Resetting <span className="font-mono">plans</span> restores default GH₵ subscription tiers.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                Collection to Reset
              </label>
              <select
                value={resetTargetCol}
                onChange={(e) => {
                  setResetTargetCol(e.target.value);
                  setResetColConfirmText('');
                }}
                className={INPUT_CLASS}
              >
                {individuallyResettableCols.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.label} ({c.count})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                Scope (Optional Tenant Filter)
              </label>
              <select
                value={resetColTenantScope}
                onChange={(e) => setResetColTenantScope(e.target.value)}
                disabled={resetTargetCol === 'plans'}
                className={INPUT_CLASS}
              >
                <option value="">All Tenants (Full Collection Reset)</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    Only {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={resetColConfirmText}
              onChange={(e) => setResetColConfirmText(e.target.value)}
              placeholder={`Type "${expectedResetCode}" to confirm`}
              className={`${INPUT_CLASS} font-mono`}
            />
            <button
              type="submit"
              disabled={resettingCol || resetColConfirmText.trim() !== expectedResetCode}
              className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
            >
              {resettingCol ? 'Resetting...' : 'Reset Collection'}
            </button>
          </div>
        </form>
      </div>

      {/* Create / Edit Record Modal */}
      <AnimatePresence>
        {editorMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Edit database record"
          >
            <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    {editorMode === 'create'
                      ? `Create Record · ${selectedMeta?.label || selectedCollection}`
                      : `Edit Record · ${editingRecordId}`}
                  </h3>
                  <p className="text-[11px] font-mono text-[var(--av-text-subtle)] mt-0.5">
                    Collection: {selectedCollection}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditorMode(null)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSaveRecord} className="flex-1 overflow-y-auto p-6 space-y-4">
                {editorError && (
                  <div className="rounded-lg border border-rose-300/60 dark:border-rose-500/30 bg-rose-50/80 dark:bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                    {editorError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                      Quick Field · Name / Title / Subject
                    </label>
                    <input
                      type="text"
                      value={quickLabel}
                      onChange={(e) => syncQuickFieldToJson('label', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                      Quick Field · Status
                    </label>
                    <input
                      type="text"
                      value={quickStatus}
                      onChange={(e) => syncQuickFieldToJson('status', e.target.value)}
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                    Full Record JSON Payload
                  </label>
                  <textarea
                    rows={14}
                    value={editorJson}
                    onChange={(e) => setEditorJson(e.target.value)}
                    spellCheck={false}
                    className={`${INPUT_CLASS} font-mono text-[11px] leading-relaxed`}
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setEditorMode(null)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingRecord}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                  >
                    {savingRecord
                      ? 'Saving...'
                      : editorMode === 'create'
                        ? 'Insert Record'
                        : 'Save Record Changes'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Database Record"
        description={`Permanently delete record "${deleteTarget?.label}" (${deleteTarget?.id}) from "${deleteTarget?.collection}"?`}
        confirmLabel="Delete Record"
        loading={deletingRecord}
        onConfirm={handleConfirmDeleteRecord}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(tenantConfirm)}
        title={tenantConfirm?.title || 'Confirm Tenant Operation'}
        description={tenantConfirm?.description || ''}
        confirmLabel={tenantConfirm?.confirmLabel || 'Proceed'}
        loading={runningTenantOp}
        onConfirm={handleConfirmTenantOp}
        onCancel={() => setTenantConfirm(null)}
      />
    </div>
  );
}
