import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { onAuthStateChanged } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Code2,
  Columns3,
  Database,
  Flame,
  History,
  Lock,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { api, ApiError } from '../lib/api.ts';
import { auth, testConnection } from '../lib/firebase.ts';
import {
  BOOTSTRAP_SUPER_ADMIN_EMAIL,
  computeDocumentDiff,
  deleteTenantFirestoreData,
  fetchFirestoreCollectionCounts,
  fetchFirestoreDocuments,
  fetchSingleFirestoreCollectionCount,
  FIRESTORE_COLLECTION_CATALOG,
  getFirestoreCollectionMeta,
  parseCollectionSegments,
  parseFirestoreUiError,
  removeFirestoreDocument,
  resetFirestoreCollection,
  saveFirestoreDocument,
  syncSnapshotToFirestore,
  type FirestoreCollectionMeta,
  type FirestoreDocRow,
  type FirestoreFieldDiff,
} from '../lib/firestoreAdmin.ts';
import { connectFirebaseGoogleAccount, googleSignOut } from '../lib/googleAuth.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface PlatformFirestoreTabProps {
  tenants: Array<{ id: string; name: string; type: string }>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onAuditRecorded?: () => Promise<void> | void;
}

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-xs text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

const CATEGORY_ORDER: FirestoreCollectionMeta['category'][] = [
  'Core SaaS',
  'ITAM & Custody',
  'ITSM & Helpdesk',
  'Procurement & Vendors',
  'Governance & Logs',
];

const PRIORITY_COLUMN_ORDER = [
  'title',
  'name',
  'displayName',
  'subject',
  'status',
  'tenantId',
  'orgId',
  'category',
  'priority',
  'planCode',
  'role',
  'type',
  'amountGhs',
  'reference',
  'email',
  'updatedAt',
  'createdAt',
];

const EDIT_LOCKED_TOP_KEYS = new Set([
  'id',
  'uid',
  'tenantId',
  'orgId',
  'ownerUid',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
  'code',
]);

const TENANT_SCOPED_ENVELOPE_KEYS = new Set([
  'id',
  'tenantId',
  'orgId',
  'title',
  'category',
  'priority',
  'status',
  'payload',
  'tags',
  'createdBy',
  'updatedBy',
  'createdAt',
  'updatedAt',
]);

const FIELD_SUGGESTIONS: Record<string, string[]> = {
  status: [
    'active',
    'trial',
    'grace',
    'suspended',
    'Active',
    'In Use',
    'Available',
    'In Maintenance',
    'Retired',
    'Open',
    'In Progress',
    'Resolved',
    'Closed',
  ],
  planCode: ['starter', 'professional', 'business', 'enterprise'],
  type: ['company', 'msp'],
  deploymentMode: ['shared_cloud', 'dedicated_enterprise'],
  role: [
    'tenant_owner',
    'tenant_admin',
    'it_manager',
    'it_technician',
    'asset_manager',
    'dept_manager',
    'employee',
    'auditor',
    'msp_admin',
    'msp_manager',
    'msp_technician',
    'msp_viewer',
  ],
  orgAccessMode: ['all', 'selected'],
  billingCycle: ['monthly', 'annual'],
  priority: ['Low', 'Medium', 'High', 'Critical'],
};

const REQUIRED_TOP_KEYS_BASE = new Set([
  'id',
  'uid',
  'tenantId',
  'orgId',
  'createdBy',
  'updatedBy',
  'status',
]);

const REQUIRED_KEYS_BY_KIND: Record<string, string[]> = {
  plan: ['code', 'name', 'monthlyPriceGhs', 'annualPriceGhs'],
  tenant: ['name', 'type', 'ownerUid', 'planCode'],
  membership: ['role', 'orgAccessMode'],
  user_public: ['displayName'],
};

const OPTIONAL_KEYS_BY_KIND: Record<string, Array<{ key: string; type: FieldValueType; defaultVal: unknown }>> = {
  plan: [
    { key: 'description', type: 'string', defaultVal: '' },
    { key: 'tagline', type: 'string', defaultVal: '' },
    { key: 'isPublic', type: 'boolean', defaultVal: true },
    { key: 'isCustomAnnual', type: 'boolean', defaultVal: false },
    { key: 'limits', type: 'json', defaultVal: { maxAssets: 500, maxUsers: 25, maxLocations: 10 } },
    { key: 'features', type: 'json', defaultVal: ['helpdesk', 'qr_barcode'] },
  ],
  tenant: [
    { key: 'slug', type: 'string', defaultVal: '' },
    { key: 'deploymentMode', type: 'string', defaultVal: 'shared_cloud' },
    { key: 'supportEmail', type: 'string', defaultVal: '' },
    { key: 'country', type: 'string', defaultVal: 'Ghana' },
    { key: 'currency', type: 'string', defaultVal: 'GHS' },
  ],
  subscription_tx: [
    { key: 'planCode', type: 'string', defaultVal: 'professional' },
    { key: 'billingCycle', type: 'string', defaultVal: 'monthly' },
    { key: 'amountGhs', type: 'number', defaultVal: 0 },
    { key: 'reference', type: 'string', defaultVal: '' },
  ],
  membership: [{ key: 'allowedOrgIds', type: 'json', defaultVal: [] }],
  user_public: [{ key: 'department', type: 'string', defaultVal: 'IT Infrastructure' }],
};

type FieldValueType = 'string' | 'number' | 'boolean' | 'json' | 'null';

interface ColumnSpec {
  key: string;
  label: string;
  isPayload: boolean;
}

function getValueByColumnKey(row: FirestoreDocRow, colKey: string): unknown {
  if (colKey === '__docId') return row.docId;
  if (colKey.startsWith('payload.')) {
    const subKey = colKey.slice('payload.'.length);
    const payload = row.data.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      return (payload as Record<string, unknown>)[subKey];
    }
    return undefined;
  }
  return row.data[colKey];
}

function formatCellValue(val: unknown): string {
  if (val === undefined || val === null || val === '') return '—';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(val)) {
      return val.slice(0, 16).replace('T', ' ');
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.length === 0 ? '[]' : val.map((v) => String(v)).join(', ');
  }
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

function formatDiffValue(val: unknown): string {
  if (val === null || val === undefined) return '∅';
  if (typeof val === 'string') return val.length > 48 ? `"${val.slice(0, 45)}..."` : `"${val}"`;
  if (typeof val === 'boolean' || typeof val === 'number') return String(val);
  try {
    const s = JSON.stringify(val);
    return s.length > 48 ? `${s.slice(0, 45)}...` : s;
  } catch {
    return String(val);
  }
}

function inferFieldType(val: unknown): FieldValueType {
  if (val === null) return 'null';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (typeof val === 'string') return 'string';
  return 'json';
}

function buildFirestoreStarterDoc(
  collectionName: string,
  meta: FirestoreCollectionMeta | undefined,
  tenantId: string,
  uid: string
): { docId: string; body: Record<string, unknown> } {
  const activeTid = tenantId || 'ten-default-01';
  const rand = Math.random().toString(36).slice(2, 7);

  if (!meta || meta.kind === 'tenant_scoped') {
    return {
      docId: `${collectionName.slice(0, 3).replace(/[^a-zA-Z0-9]/g, 'd') || 'doc'}_${rand}`,
      body: {
        tenantId: activeTid,
        orgId: 'org-default-01',
        title: `Sample ${meta?.label || collectionName} Record`,
        status: 'Active',
        category: 'General',
        payload: {
          source: 'firestore_console',
          notes: 'Created directly from Platform Firestore Console',
        },
      },
    };
  }
  if (meta.kind === 'plan') {
    return {
      docId: `plan_${rand}`,
      body: {
        code: 'professional',
        name: 'Professional',
        tagline: 'Full ITAM & Helpdesk SLA control',
        monthlyPriceGhs: 349,
        annualPriceGhs: 3490,
        isPublic: true,
        limits: { maxAssets: 500, maxUsers: 25, maxLocations: 10 },
        features: ['helpdesk', 'software_licences', 'qr_barcode', 'audit_logs'],
      },
    };
  }
  if (meta.kind === 'tenant') {
    return {
      docId: `ten_${rand}`,
      body: {
        name: 'New Firestore Workspace',
        slug: `workspace-${rand}`,
        type: 'company',
        status: 'active',
        ownerUid: uid,
        planCode: 'professional',
        deploymentMode: 'shared_cloud',
        country: 'Ghana',
        currency: 'GHS',
      },
    };
  }
  if (meta.kind === 'subscription_tx') {
    return {
      docId: `sub_${rand}`,
      body: {
        tenantId: activeTid,
        planCode: 'professional',
        billingCycle: 'monthly',
        status: 'active',
        amountGhs: 349,
        reference: `FS-REF-${rand.toUpperCase()}`,
      },
    };
  }
  if (meta.kind === 'membership') {
    return {
      docId: `${uid}_${activeTid}`,
      body: {
        uid,
        tenantId: activeTid,
        role: 'tenant_owner',
        status: 'active',
        orgAccessMode: 'all',
        allowedOrgIds: [],
      },
    };
  }
  if (meta.kind === 'user_public') {
    return {
      docId: uid,
      body: {
        uid,
        displayName: 'Platform Operator',
        department: 'IT Infrastructure',
      },
    };
  }
  return {
    docId: `cfg_${rand}`,
    body: {
      platformName: 'AssetVault ITAM & ITSM',
      trialDays: 14,
      gracePeriodDays: 7,
    },
  };
}

function formatColLabel(key: string): string {
  if (key.startsWith('payload.')) {
    return key.slice('payload.'.length);
  }
  return key;
}

export function PlatformFirestoreTab({
  tenants,
  onToast,
  onAuditRecorded,
}: PlatformFirestoreTabProps) {
  const [fbUser, setFbUser] = useState<{
    uid: string;
    email: string | null;
    emailVerified: boolean;
  } | null>(() =>
    auth.currentUser
      ? {
          uid: auth.currentUser.uid,
          email: auth.currentUser.email,
          emailVerified: auth.currentUser.emailVerified,
        }
      : null
  );
  const [connectingAuth, setConnectingAuth] = useState(false);
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);

  // Collection selection & dynamic path fetcher
  const [selectedCollection, setSelectedCollection] = useState<string>('tenants');
  const [collectionInput, setCollectionInput] = useState<string>('tenants');
  const [collectionInputError, setCollectionInputError] = useState<string | null>(null);
  const [sidebarFilter, setSidebarFilter] = useState<string>('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [tenantFilter, setTenantFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [docs, setDocs] = useState<FirestoreDocRow[]>([]);
  const [loadingDocs, setLoadingDocs] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [pruneDeletedOnSync, setPruneDeletedOnSync] = useState<boolean>(true);

  // Dynamic table columns, sorting, pagination
  const [visibleColumns, setVisibleColumns] = useState<string[] | null>(null);
  const [columnsMenuOpen, setColumnsMenuOpen] = useState<boolean>(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState<number>(1);

  // Recent Firestore Audit Trail
  const [recentAudits, setRecentAudits] = useState<FirestoreDocRow[]>([]);
  const [loadingAudits, setLoadingAudits] = useState<boolean>(false);

  // Create / Edit Modal (Field Editor + Raw JSON)
  const [editorMode, setEditorMode] = useState<'create' | 'edit' | null>(null);
  const [editorTab, setEditorTab] = useState<'fields' | 'json'>('fields');
  const [editorDocId, setEditorDocId] = useState<string>('');
  const [editorOriginalData, setEditorOriginalData] = useState<Record<string, unknown>>({});
  const [editorDraft, setEditorDraft] = useState<Record<string, unknown>>({});
  const [editorJson, setEditorJson] = useState<string>('{}');
  const [jsonFieldDrafts, setJsonFieldDrafts] = useState<Record<string, string>>({});
  const [auditReason, setAuditReason] = useState<string>('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [savingDoc, setSavingDoc] = useState<boolean>(false);

  // Add Field inline builder
  const [newFieldScope, setNewFieldScope] = useState<'top' | 'payload'>('top');
  const [newFieldKey, setNewFieldKey] = useState<string>('');
  const [newFieldType, setNewFieldType] = useState<FieldValueType>('string');
  const [newFieldValue, setNewFieldValue] = useState<string>('');

  // Single Delete Confirmation
  const [deleteTarget, setDeleteTarget] = useState<{
    collection: string;
    docId: string;
  } | null>(null);
  const [deletingDoc, setDeletingDoc] = useState<boolean>(false);

  // Tenant Purge Panel
  const [purgeTenantId, setPurgeTenantId] = useState<string>(tenants[0]?.id || '');
  const [includeTenantRoot, setIncludeTenantRoot] = useState<boolean>(false);
  const [purgeConfirmOpen, setPurgeConfirmOpen] = useState<boolean>(false);
  const [purgingTenant, setPurgingTenant] = useState<boolean>(false);

  // Reset Collection Panel
  const [resetCol, setResetCol] = useState<string>('assets');
  const [resetTenantScope, setResetTenantScope] = useState<string>('');
  const [resetConfirmText, setResetConfirmText] = useState<string>('');
  const [resettingCol, setResettingCol] = useState<boolean>(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setFbUser(
        u
          ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified }
          : null
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!purgeTenantId && tenants[0]) {
      setPurgeTenantId(tenants[0].id);
    }
  }, [tenants, purgeTenantId]);

  const isSuperAdminReady = Boolean(
    fbUser && fbUser.emailVerified && fbUser.email === BOOTSTRAP_SUPER_ADMIN_EMAIL
  );

  const selectedMeta = useMemo(
    () => getFirestoreCollectionMeta(selectedCollection),
    [selectedCollection]
  );

  const isCustomCollection = !selectedMeta;
  const canCreate = selectedMeta ? selectedMeta.canCreate : true;
  const canEdit = selectedMeta ? selectedMeta.canEdit : true;
  const canDelete = selectedMeta ? selectedMeta.canDelete : true;

  const groupedCollections = useMemo(() => {
    const q = sidebarFilter.trim().toLowerCase();
    const map = new Map<FirestoreCollectionMeta['category'], FirestoreCollectionMeta[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const col of FIRESTORE_COLLECTION_CATALOG) {
      if (
        q &&
        !col.name.toLowerCase().includes(q) &&
        !col.label.toLowerCase().includes(q)
      ) {
        continue;
      }
      const bucket = map.get(col.category) ?? [];
      bucket.push(col);
      map.set(col.category, bucket);
    }
    return map;
  }, [sidebarFilter]);

  const fetchRecentAudits = useCallback(async () => {
    if (!isSuperAdminReady) {
      setRecentAudits([]);
      return;
    }
    setLoadingAudits(true);
    try {
      const logs = await fetchFirestoreDocuments('platformAuditLogs', undefined, 50);
      logs.sort((a, b) => {
        const ta = String(
          (a.data.payload as Record<string, unknown> | undefined)?.recordedAt ||
            a.data.createdAt ||
            ''
        );
        const tb = String(
          (b.data.payload as Record<string, unknown> | undefined)?.recordedAt ||
            b.data.createdAt ||
            ''
        );
        return tb.localeCompare(ta);
      });
      setRecentAudits(logs.slice(0, 15));
    } catch {
      // Ignore secondary audit fetch failure
    } finally {
      setLoadingAudits(false);
    }
  }, [isSuperAdminReady]);

  const refreshActiveCollectionOnly = useCallback(async () => {
    if (!isSuperAdminReady) return;
    setLoadingDocs(true);
    try {
      const [nextDocs, nextSingleCount] = await Promise.all([
        fetchFirestoreDocuments(selectedCollection, tenantFilter || undefined, 250),
        isCustomCollection
          ? Promise.resolve<number | null>(null)
          : fetchSingleFirestoreCollectionCount(selectedCollection),
      ]);
      setDocs(nextDocs);
      setCounts((prev) => ({
        ...prev,
        [selectedCollection]:
          nextSingleCount !== null ? nextSingleCount : nextDocs.length,
      }));
    } catch (err) {
      onToast('error', parseFirestoreUiError(err));
    } finally {
      setLoadingDocs(false);
    }
  }, [isSuperAdminReady, selectedCollection, tenantFilter, isCustomCollection, onToast]);

  const refreshCountsAndDocs = useCallback(async () => {
    if (!isSuperAdminReady) return;
    setLoadingDocs(true);
    try {
      const [ok, nextCounts, nextDocs] = await Promise.all([
        testConnection(false),
        fetchFirestoreCollectionCounts(),
        fetchFirestoreDocuments(selectedCollection, tenantFilter || undefined, 250),
      ]);
      setConnectionOk(ok);
      setCounts({
        ...nextCounts,
        ...(isCustomCollection ? { [selectedCollection]: nextDocs.length } : {}),
      });
      setDocs(nextDocs);
    } catch (err) {
      onToast('error', parseFirestoreUiError(err));
    } finally {
      setLoadingDocs(false);
    }
  }, [isSuperAdminReady, selectedCollection, tenantFilter, isCustomCollection, onToast]);

  // Initial connection check, collection counts, and audit feed once per Super Admin session
  useEffect(() => {
    if (isSuperAdminReady) {
      void (async () => {
        const [ok, nextCounts] = await Promise.all([
          testConnection(false),
          fetchFirestoreCollectionCounts(),
        ]);
        setConnectionOk(ok);
        setCounts((prev) => ({ ...prev, ...nextCounts }));
      })();
      void fetchRecentAudits();
    } else {
      setConnectionOk(null);
      setDocs([]);
      setRecentAudits([]);
    }
  }, [isSuperAdminReady, fetchRecentAudits]);

  // Fast single-collection fetch when switching collections or tenant filter
  useEffect(() => {
    if (isSuperAdminReady) {
      void refreshActiveCollectionOnly();
    }
  }, [isSuperAdminReady, refreshActiveCollectionOnly]);

  // Reset per-collection view state when switching collections
  useEffect(() => {
    setVisibleColumns(null);
    setColumnsMenuOpen(false);
    setSortColumn(null);
    setPage(1);
    setCollectionInput(selectedCollection);
    setCollectionInputError(null);
  }, [selectedCollection]);

  // Dynamically discover all columns across fetched documents (top-level + payload.*)
  const discoveredColumns = useMemo<ColumnSpec[]>(() => {
    const topKeys = new Set<string>();
    const payloadKeys = new Set<string>();
    for (const row of docs) {
      for (const [k, v] of Object.entries(row.data)) {
        if (k === 'id') continue;
        if (k === 'payload' && v && typeof v === 'object' && !Array.isArray(v)) {
          for (const pk of Object.keys(v as Record<string, unknown>)) {
            payloadKeys.add(`payload.${pk}`);
          }
        } else {
          topKeys.add(k);
        }
      }
    }

    const sortedTop = Array.from(topKeys).sort((a, b) => {
      const ia = PRIORITY_COLUMN_ORDER.indexOf(a);
      const ib = PRIORITY_COLUMN_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    const sortedPayload = Array.from(payloadKeys).sort();

    return [
      ...sortedTop.map((key) => ({ key, label: formatColLabel(key), isPayload: false })),
      ...sortedPayload.map((key) => ({ key, label: formatColLabel(key), isPayload: true })),
    ];
  }, [docs]);

  const defaultColumnKeys = useMemo(() => {
    if (discoveredColumns.length === 0) {
      return ['title', 'status', 'tenantId', 'updatedAt'];
    }
    const topPriority = discoveredColumns
      .filter((c) => !c.isPayload && c.key !== 'createdBy' && c.key !== 'updatedBy')
      .slice(0, 5)
      .map((c) => c.key);
    const payloadExtras = discoveredColumns
      .filter((c) => c.isPayload)
      .slice(0, Math.max(0, 7 - topPriority.length))
      .map((c) => c.key);
    const combined = [...topPriority, ...payloadExtras];
    return combined.length > 0
      ? combined
      : discoveredColumns.slice(0, 6).map((c) => c.key);
  }, [discoveredColumns]);

  const activeColumnKeys = visibleColumns ?? defaultColumnKeys;
  const activeColumns = useMemo(
    () =>
      activeColumnKeys.map((key) => {
        const found = discoveredColumns.find((c) => c.key === key);
        return found || { key, label: formatColLabel(key), isPayload: key.startsWith('payload.') };
      }),
    [activeColumnKeys, discoveredColumns]
  );

  const handleSelectCollection = (name: string) => {
    setSelectedCollection(name);
    setCollectionInput(name);
    setCollectionInputError(null);
  };

  const handleFetchCustomCollection = (e: FormEvent) => {
    e.preventDefault();
    setCollectionInputError(null);
    try {
      const segments = parseCollectionSegments(collectionInput);
      const normalized = segments.join('/');
      if (normalized === selectedCollection) {
        void refreshCountsAndDocs();
      } else {
        setSelectedCollection(normalized);
      }
    } catch (err) {
      setCollectionInputError(
        err instanceof Error ? err.message : 'Invalid Firestore collection path.'
      );
    }
  };

  const handleConnectGoogle = async () => {
    setConnectingAuth(true);
    try {
      const user = await connectFirebaseGoogleAccount();
      if (user.email !== BOOTSTRAP_SUPER_ADMIN_EMAIL) {
        onToast(
          'error',
          `Signed in as ${user.email}, but Cloud Firestore Super Admin rules require ${BOOTSTRAP_SUPER_ADMIN_EMAIL}.`
        );
      } else {
        onToast('success', `Connected Cloud Firestore as ${user.email}.`);
      }
    } catch (err) {
      onToast('error', err instanceof Error ? err.message : 'Google sign-in failed.');
    } finally {
      setConnectingAuth(false);
    }
  };

  const handleSyncToFirestore = async (options?: {
    onlyCollection?: string;
    onlyTenantId?: string;
  }) => {
    if (!isSuperAdminReady) {
      onToast('error', `Connect Firebase Auth as ${BOOTSTRAP_SUPER_ADMIN_EMAIL} first.`);
      return;
    }
    setSyncing(true);
    try {
      const snapshot = await api.getPlatformDatabaseSnapshot(options?.onlyTenantId);
      const res = await syncSnapshotToFirestore(snapshot, {
        onlyCollection: options?.onlyCollection,
        pruneStale: pruneDeletedOnSync,
        tenantScope: options?.onlyTenantId,
      });
      const pruneNote =
        res.prunedCount > 0 ? ` and pruned ${res.prunedCount} stale doc(s)` : '';
      onToast(
        'success',
        `Synced ${res.syncedCount} Firestore document(s)${pruneNote} across ${res.collectionsTouched.length} collection(s).`
      );
      await Promise.all([
        options?.onlyCollection
          ? refreshActiveCollectionOnly()
          : refreshCountsAndDocs(),
        fetchRecentAudits(),
      ]);
      await onAuditRecorded?.();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : parseFirestoreUiError(err)
      );
    } finally {
      setSyncing(false);
    }
  };

  const initEditorState = (
    mode: 'create' | 'edit',
    docId: string,
    data: Record<string, unknown>,
    initialTab: 'fields' | 'json' = 'fields'
  ) => {
    const clean = { ...data };
    delete clean.createdAt;
    delete clean.updatedAt;
    const cloned = JSON.parse(JSON.stringify(clean)) as Record<string, unknown>;
    setEditorMode(mode);
    setEditorTab(initialTab);
    setEditorDocId(docId);
    setEditorOriginalData(mode === 'edit' ? cloned : {});
    setEditorDraft(cloned);
    setEditorJson(JSON.stringify(cloned, null, 2));
    setJsonFieldDrafts({});
    setAuditReason('');
    setNewFieldKey('');
    setNewFieldValue('');
    setNewFieldType('string');
    setNewFieldScope(
      (!selectedMeta && !selectedCollection.includes('/')) ||
        selectedMeta?.kind === 'tenant_scoped'
        ? 'payload'
        : 'top'
    );
    setEditorError(null);
  };

  const openCreateModal = () => {
    const starter = buildFirestoreStarterDoc(
      selectedCollection,
      selectedMeta,
      tenantFilter,
      fbUser?.uid || 'admin'
    );
    initEditorState('create', starter.docId, starter.body, 'fields');
  };

  const openEditModal = (row: FirestoreDocRow, initialTab: 'fields' | 'json' = 'fields') => {
    initEditorState('edit', row.docId, row.data, initialTab);
  };

  const switchEditorTab = (targetTab: 'fields' | 'json') => {
    setEditorError(null);
    if (targetTab === editorTab) return;
    if (targetTab === 'json') {
      const pendingFields = Object.keys(jsonFieldDrafts);
      if (pendingFields.length > 0) {
        setEditorError(
          `Finish or fix invalid JSON in "${pendingFields[0]}" before switching to Raw JSON.`
        );
        return;
      }
      setEditorJson(JSON.stringify(editorDraft, null, 2));
      setEditorTab('json');
      return;
    }
    try {
      const parsed = JSON.parse(editorJson);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setEditorError('Document JSON must be an object before switching to Field Editor.');
        return;
      }
      setEditorDraft(parsed as Record<string, unknown>);
      setJsonFieldDrafts({});
      setEditorTab('fields');
    } catch (err) {
      setEditorError(err instanceof Error ? err.message : 'Fix JSON syntax errors first.');
    }
  };

  const updateTopLevelField = (key: string, val: unknown) => {
    setEditorDraft((prev) => ({ ...prev, [key]: val }));
  };

  const updatePayloadField = (subKey: string, val: unknown) => {
    setEditorDraft((prev) => {
      const currentPayload =
        prev.payload && typeof prev.payload === 'object' && !Array.isArray(prev.payload)
          ? { ...(prev.payload as Record<string, unknown>) }
          : {};
      currentPayload[subKey] = val;
      return { ...prev, payload: currentPayload };
    });
  };

  const deleteDraftField = (scope: 'top' | 'payload', key: string) => {
    setEditorDraft((prev) => {
      if (scope === 'top') {
        const next = { ...prev };
        delete next[key];
        return next;
      }
      const currentPayload =
        prev.payload && typeof prev.payload === 'object' && !Array.isArray(prev.payload)
          ? { ...(prev.payload as Record<string, unknown>) }
          : {};
      delete currentPayload[key];
      return { ...prev, payload: currentPayload };
    });
  };

  const handleAddField = () => {
    setEditorError(null);
    const trimmedKey = newFieldKey.trim();
    if (!trimmedKey || !/^[a-zA-Z0-9_.-]+$/.test(trimmedKey)) {
      setEditorError('Enter a valid field name (letters, numbers, underscore, dash).');
      return;
    }

    let parsedVal: unknown = newFieldValue;
    if (newFieldType === 'number') {
      const num = Number(newFieldValue);
      if (Number.isNaN(num)) {
        setEditorError(`"${newFieldValue}" is not a valid number.`);
        return;
      }
      parsedVal = num;
    } else if (newFieldType === 'boolean') {
      parsedVal = newFieldValue === 'true';
    } else if (newFieldType === 'json') {
      try {
        parsedVal = JSON.parse(newFieldValue || '{}');
      } catch {
        setEditorError('Initial JSON value is invalid.');
        return;
      }
    } else if (newFieldType === 'null') {
      parsedVal = null;
    }

    const effectiveScope =
      newFieldScope === 'payload' && !TENANT_SCOPED_ENVELOPE_KEYS.has(trimmedKey)
        ? 'payload'
        : 'top';

    if (effectiveScope === 'payload') {
      updatePayloadField(trimmedKey, parsedVal);
    } else {
      updateTopLevelField(trimmedKey, parsedVal);
    }
    setNewFieldKey('');
    setNewFieldValue('');
  };

  const liveDraftForDiff = useMemo(() => {
    if (!editorMode) return {};
    if (editorTab === 'json') {
      try {
        const parsed = JSON.parse(editorJson);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return editorDraft;
      }
    }
    return editorDraft;
  }, [editorMode, editorTab, editorJson, editorDraft]);

  const liveDiffs = useMemo<FirestoreFieldDiff[]>(() => {
    if (!editorMode) return [];
    return computeDocumentDiff(
      editorMode === 'edit' ? editorOriginalData : null,
      liveDraftForDiff
    );
  }, [editorMode, editorOriginalData, liveDraftForDiff]);

  const handleSaveDocument = async (e: FormEvent) => {
    e.preventDefault();
    setEditorError(null);

    if (Object.keys(jsonFieldDrafts).length > 0 && editorTab === 'fields') {
      // Ensure any pending JSON subfields parse cleanly
      for (const [fieldPath, rawText] of Object.entries(jsonFieldDrafts)) {
        try {
          JSON.parse(rawText);
        } catch {
          setEditorError(`Field "${fieldPath}" contains invalid JSON syntax.`);
          return;
        }
      }
    }

    let payloadToSave: Record<string, unknown>;
    if (editorTab === 'json') {
      try {
        const raw = JSON.parse(editorJson);
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          throw new Error('Document payload must be a JSON object.');
        }
        payloadToSave = raw as Record<string, unknown>;
      } catch (err) {
        setEditorError(err instanceof Error ? err.message : 'Invalid JSON syntax.');
        return;
      }
    } else {
      payloadToSave = editorDraft;
    }

    setSavingDoc(true);
    try {
      const targetTid = String(payloadToSave.tenantId || tenantFilter || 'ten-default-01');
      const matchedTenant = tenants.find((t) => t.id === targetTid);
      const result = await saveFirestoreDocument(
        selectedCollection,
        editorDocId,
        payloadToSave,
        editorMode === 'edit' ? 'edit' : 'create',
        {
          previousData: editorMode === 'edit' ? editorOriginalData : undefined,
          auditReason: auditReason.trim() || undefined,
          tenantFallback: matchedTenant,
        }
      );
      const diffCount = result.changedFields.length;
      const auditNote = result.auditLogId
        ? ` · ${diffCount} field${diffCount === 1 ? '' : 's'} logged`
        : '';
      onToast(
        'success',
        `${editorMode === 'create' ? 'Created' : 'Updated'} ${selectedCollection}/${result.docId}${auditNote}.`
      );
      setEditorMode(null);
      await Promise.all([refreshActiveCollectionOnly(), fetchRecentAudits()]);
      await onAuditRecorded?.();
    } catch (err) {
      setEditorError(parseFirestoreUiError(err));
    } finally {
      setSavingDoc(false);
    }
  };

  const handleConfirmDeleteDoc = async () => {
    if (!deleteTarget) return;
    setDeletingDoc(true);
    try {
      await removeFirestoreDocument(deleteTarget.collection, deleteTarget.docId);
      onToast(
        'success',
        `Deleted Firestore document ${deleteTarget.collection}/${deleteTarget.docId} (audit log recorded).`
      );
      setDeleteTarget(null);
      await Promise.all([refreshActiveCollectionOnly(), fetchRecentAudits()]);
      await onAuditRecorded?.();
    } catch (err) {
      onToast('error', parseFirestoreUiError(err));
    } finally {
      setDeletingDoc(false);
    }
  };

  const handleConfirmPurgeTenant = async () => {
    if (!purgeTenantId) return;
    setPurgingTenant(true);
    try {
      const res = await deleteTenantFirestoreData(purgeTenantId, {
        includeTenantDocs: includeTenantRoot,
      });
      const immutableNote =
        res.skippedImmutable.length > 0
          ? ` (Immutable ledgers retained per security rules: ${res.skippedImmutable.join(', ')})`
          : '';
      onToast(
        'success',
        `Deleted ${res.deletedCount} Firestore document(s) for tenant ${purgeTenantId}.${immutableNote}`
      );
      setPurgeConfirmOpen(false);
      await Promise.all([refreshCountsAndDocs(), fetchRecentAudits()]);
      await onAuditRecorded?.();
    } catch (err) {
      onToast('error', parseFirestoreUiError(err));
    } finally {
      setPurgingTenant(false);
    }
  };

  const expectedResetCode = `RESET_${resetCol.toUpperCase()}`;

  const handleResetFirestoreCol = async (e: FormEvent) => {
    e.preventDefault();
    if (resetConfirmText.trim() !== expectedResetCode) return;
    setResettingCol(true);
    try {
      const deleted = await resetFirestoreCollection(
        resetCol,
        resetTenantScope || undefined
      );
      onToast(
        'success',
        `Reset Firestore collection "${resetCol}" (${deleted} document(s) deleted & audited).`
      );
      setResetConfirmText('');
      await Promise.all([refreshCountsAndDocs(), fetchRecentAudits()]);
      await onAuditRecorded?.();
    } catch (err) {
      onToast('error', parseFirestoreUiError(err));
    } finally {
      setResettingCol(false);
    }
  };

  const filteredAndSortedDocs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = q
      ? docs.filter(
          (d) =>
            d.docId.toLowerCase().includes(q) ||
            JSON.stringify(d.data).toLowerCase().includes(q)
        )
      : [...docs];

    if (sortColumn) {
      list.sort((a, b) => {
        const va = formatCellValue(getValueByColumnKey(a, sortColumn));
        const vb = formatCellValue(getValueByColumnKey(b, sortColumn));
        const na = Number(va);
        const nb = Number(vb);
        const cmp =
          !Number.isNaN(na) && !Number.isNaN(nb) && va !== '—' && vb !== '—'
            ? na - nb
            : va.localeCompare(vb);
        return sortDirection === 'asc' ? cmp : -cmp;
      });
    }
    return list;
  }, [docs, searchQuery, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(filteredAndSortedDocs.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pagedDocs = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredAndSortedDocs.slice(start, start + pageSize);
  }, [filteredAndSortedDocs, safePage, pageSize]);

  const toggleSort = (colKey: string) => {
    if (sortColumn !== colKey) {
      setSortColumn(colKey);
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      setSortColumn(null);
    }
  };

  const toggleColumnVisibility = (colKey: string) => {
    const current = new Set(activeColumnKeys);
    if (current.has(colKey)) {
      if (current.size <= 1) return;
      current.delete(colKey);
    } else {
      current.add(colKey);
    }
    setVisibleColumns(Array.from(current));
  };

  const resettableFirestoreCols = FIRESTORE_COLLECTION_CATALOG.filter((c) => c.canReset);

  const isLockedFieldOnEdit = (key: string): boolean => {
    if (editorMode !== 'edit') return false;
    if (selectedCollection === 'payments') return key !== 'status';
    if (EDIT_LOCKED_TOP_KEYS.has(key)) return true;
    if (selectedMeta?.kind === 'tenant' && key === 'type') return true;
    return false;
  };

  const isRequiredTopField = (key: string): boolean => {
    if (REQUIRED_TOP_KEYS_BASE.has(key)) return true;
    const extra = selectedMeta ? REQUIRED_KEYS_BY_KIND[selectedMeta.kind] : undefined;
    return Boolean(extra && extra.includes(key));
  };

  const renderStructuredFieldControl = (
    scope: 'top' | 'payload',
    fieldKey: string,
    value: unknown,
    readOnly: boolean
  ) => {
    const fullPath = scope === 'payload' ? `payload.${fieldKey}` : fieldKey;
    const fType = inferFieldType(value);
    const updateFn = (nextVal: unknown) =>
      scope === 'payload'
        ? updatePayloadField(fieldKey, nextVal)
        : updateTopLevelField(fieldKey, nextVal);

    if (fType === 'boolean') {
      return (
        <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text)] cursor-pointer py-1">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={Boolean(value)}
            onChange={(e) => updateFn(e.target.checked)}
          />
          <span className="font-mono">{value ? 'true' : 'false'}</span>
        </label>
      );
    }

    if (fType === 'number') {
      return (
        <input
          type="number"
          step="any"
          disabled={readOnly}
          value={Number.isFinite(value as number) ? String(value) : '0'}
          onChange={(e) => {
            const raw = e.target.value;
            updateFn(raw === '' ? 0 : Number(raw));
          }}
          className={`${INPUT_CLASS} font-mono disabled:opacity-60`}
        />
      );
    }

    if (fType === 'json') {
      const displayStr =
        jsonFieldDrafts[fullPath] ?? JSON.stringify(value, null, 2);
      const isValidJson = (() => {
        try {
          JSON.parse(displayStr);
          return true;
        } catch {
          return false;
        }
      })();
      return (
        <div className="space-y-1">
          <textarea
            rows={3}
            disabled={readOnly}
            value={displayStr}
            spellCheck={false}
            onChange={(e) => {
              const txt = e.target.value;
              setJsonFieldDrafts((prev) => ({ ...prev, [fullPath]: txt }));
              try {
                const parsed = JSON.parse(txt);
                updateFn(parsed);
                setJsonFieldDrafts((prev) => {
                  const copy = { ...prev };
                  delete copy[fullPath];
                  return copy;
                });
              } catch {
                // Keep text in draft while editing incomplete JSON
              }
            }}
            className={`${INPUT_CLASS} font-mono text-[11px] disabled:opacity-60 ${
              !isValidJson ? 'border-rose-400 focus:border-rose-500' : ''
            }`}
          />
          {!isValidJson && (
            <div className="text-[10px] text-rose-600 dark:text-rose-400">
              Invalid JSON — finish editing or fix brackets before saving.
            </div>
          )}
        </div>
      );
    }

    const strVal = value === null || value === undefined ? '' : String(value);
    const listId = FIELD_SUGGESTIONS[fieldKey] ? `fs-suggest-${fieldKey}` : undefined;
    if (strVal.length > 90 || strVal.includes('\n')) {
      return (
        <textarea
          rows={2}
          disabled={readOnly}
          value={strVal}
          onChange={(e) => updateFn(e.target.value)}
          className={`${INPUT_CLASS} disabled:opacity-60`}
        />
      );
    }

    return (
      <>
        <input
          type="text"
          disabled={readOnly}
          list={listId}
          value={strVal}
          placeholder={value === null ? 'null' : ''}
          onChange={(e) => updateFn(e.target.value)}
          className={`${INPUT_CLASS} disabled:opacity-60`}
        />
        {listId && (
          <datalist id={listId}>
            {FIELD_SUGGESTIONS[fieldKey].map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        )}
      </>
    );
  };

  const payloadObject =
    editorDraft.payload &&
    typeof editorDraft.payload === 'object' &&
    !Array.isArray(editorDraft.payload)
      ? (editorDraft.payload as Record<string, unknown>)
      : null;

  const topLevelEntries = Object.entries(editorDraft).filter(
    ([k]) => k !== 'payload'
  );
  const payloadEntries = payloadObject ? Object.entries(payloadObject) : [];

  return (
    <div className="space-y-5">
      {/* Firebase Connection & Sync Strip */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)] space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" />
              <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                Cloud Firestore Dynamic Console
              </h3>
            </div>
            <span className="font-mono text-[11px] text-[var(--av-text-subtle)]">
              Project: {firebaseConfig.projectId} · DB: {firebaseConfig.firestoreDatabaseId}
            </span>
            {connectionOk !== null && (
              <span
                className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                  connectionOk
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{connectionOk ? 'Live Connection Verified' : 'Offline / Check Rules'}</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isSuperAdminReady ? (
              <>
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Firebase Auth: {fbUser?.email}
                </span>
                <button
                  type="button"
                  onClick={() => void googleSignOut()}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] px-2.5 py-1.5 text-xs text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Disconnect</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleConnectGoogle}
                disabled={connectingAuth}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
              >
                <Cloud className="h-3.5 w-3.5" />
                <span>
                  {connectingAuth
                    ? 'Connecting...'
                    : `Connect Firebase Super Admin (${BOOTSTRAP_SUPER_ADMIN_EMAIL})`}
                </span>
              </button>
            )}
          </div>
        </div>

        {!isSuperAdminReady ? (
          <div className="rounded-lg border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200">
            <strong>Firebase Authentication Required:</strong> Cloud Firestore security rules enforce Super Admin verification (verified Google sign-in as{' '}
            <span className="font-mono">{BOOTSTRAP_SUPER_ADMIN_EMAIL}</span>). Click{' '}
            <strong>Connect Firebase Super Admin</strong> above to dynamically fetch any collection, edit fields with live diffs, and inspect immutable audit logs.
          </div>
        ) : (
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 pt-2.5 border-t border-[var(--av-border-subtle)]">
            {/* Dynamic Collection Path Fetcher */}
            <form
              onSubmit={handleFetchCustomCollection}
              className="flex-1 flex flex-col sm:flex-row sm:items-center gap-2"
            >
              <div className="relative flex-1 max-w-md">
                <Database className="h-3.5 w-3.5 text-[var(--av-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={collectionInput}
                  onChange={(e) => {
                    setCollectionInput(e.target.value);
                    setCollectionInputError(null);
                  }}
                  placeholder="Any collection or subcollection (e.g. assets, platformAuditLogs, tickets/id/comments)"
                  aria-label="Firestore collection path"
                  className={`${INPUT_CLASS} pl-8 font-mono`}
                />
              </div>
              <button
                type="submit"
                disabled={loadingDocs}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingDocs ? 'animate-spin' : ''}`} />
                <span>Fetch Collection</span>
              </button>
              {collectionInputError && (
                <span className="text-[11px] text-rose-600 dark:text-rose-400">
                  {collectionInputError}
                </span>
              )}
            </form>

            {/* Sync Controls */}
            <div className="flex flex-wrap items-center gap-2">
              <label
                className="inline-flex items-center gap-1.5 text-[11px] text-[var(--av-text-muted)] cursor-pointer select-none px-1"
                title="Remove mutable Firestore documents that were deleted from the platform database during sync"
              >
                <input
                  type="checkbox"
                  checked={pruneDeletedOnSync}
                  onChange={(e) => setPruneDeletedOnSync(e.target.checked)}
                />
                <span>Prune deleted docs</span>
              </label>

              <button
                type="button"
                disabled={syncing || isCustomCollection}
                onClick={() => void handleSyncToFirestore({ onlyCollection: selectedCollection })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] disabled:opacity-50"
                title={isCustomCollection ? 'Snapshot sync applies to catalog collections' : undefined}
              >
                <UploadCloud className="h-3.5 w-3.5 text-[var(--av-accent)]" />
                <span>Sync {selectedCollection}</span>
              </button>

              {tenantFilter && (
                <button
                  type="button"
                  disabled={syncing}
                  onClick={() => void handleSyncToFirestore({ onlyTenantId: tenantFilter })}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-1.5 text-xs font-semibold text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] disabled:opacity-50"
                >
                  <UploadCloud className="h-3.5 w-3.5 text-teal-500" />
                  <span>Sync Tenant {tenantFilter}</span>
                </button>
              )}

              <button
                type="button"
                disabled={syncing}
                onClick={() => void handleSyncToFirestore()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                <span>{syncing ? 'Syncing...' : 'Sync All → Firestore'}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {isSuperAdminReady && (
        <>
          {/* Main Browser + Dynamic Data Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Collections List */}
            <div className="lg:col-span-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
              <div className="border-b border-[var(--av-border-subtle)] px-3.5 py-2.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--av-text)]">
                  <span>Collections ({FIRESTORE_COLLECTION_CATALOG.length})</span>
                  {isCustomCollection && (
                    <span className="font-mono text-[10px] text-[var(--av-accent)]">
                      Custom Path
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={sidebarFilter}
                  onChange={(e) => setSidebarFilter(e.target.value)}
                  placeholder="Find collection..."
                  className="w-full rounded-md border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2.5 py-1 text-[11px] text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:outline-none focus:border-[var(--av-accent)]"
                />
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
                        const count = counts[col.name] ?? 0;
                        return (
                          <button
                            key={col.name}
                            type="button"
                            onClick={() => handleSelectCollection(col.name)}
                            className={`w-full flex items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${
                              active
                                ? 'bg-[var(--av-accent)] text-white font-semibold'
                                : 'text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)]'
                            }`}
                          >
                            <span className="truncate flex items-center gap-1.5">
                              {!col.canDelete && <Lock className="h-3 w-3 shrink-0 opacity-75" />}
                              <span className="truncate">{col.label}</span>
                            </span>
                            <span
                              className={`ml-2 font-mono text-[11px] tabular-nums ${
                                active ? 'text-white/90' : 'text-[var(--av-text-subtle)]'
                              }`}
                            >
                              {count}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Documents Table */}
            <div className="lg:col-span-9 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
              <div className="border-b border-[var(--av-border-subtle)] px-4 py-3 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-display text-sm font-bold text-[var(--av-text)]">
                    <span>{selectedMeta?.label || selectedCollection}</span>
                    <span className="font-mono text-xs font-normal text-[var(--av-text-subtle)]">
                      {selectedCollection} · {filteredAndSortedDocs.length} doc
                      {filteredAndSortedDocs.length === 1 ? '' : 's'}
                    </span>
                    {discoveredColumns.length > 0 && (
                      <span className="font-mono text-[11px] font-normal text-[var(--av-text-subtle)]">
                        · {activeColumns.length}/{discoveredColumns.length} cols
                      </span>
                    )}
                  </div>
                  {selectedMeta?.immutableNotice && (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5">
                      {selectedMeta.immutableNotice}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={tenantFilter}
                    onChange={(e) => {
                      setTenantFilter(e.target.value);
                      setPage(1);
                    }}
                    aria-label="Filter Firestore docs by tenant"
                    className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2.5 py-1.5 text-xs text-[var(--av-text)]"
                  >
                    <option value="">All Tenants</option>
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>

                  <div className="relative">
                    <Search className="h-3.5 w-3.5 text-[var(--av-text-subtle)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setPage(1);
                      }}
                      placeholder="Search any field..."
                      className="w-40 sm:w-44 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-8 pr-2.5 py-1.5 text-xs text-[var(--av-text)]"
                    />
                  </div>

                  {/* Dynamic Columns Toggle Popover */}
                  {discoveredColumns.length > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setColumnsMenuOpen((o) => !o)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2.5 py-1.5 text-xs font-medium text-[var(--av-text)] hover:bg-[var(--av-surface-hover)]"
                      >
                        <Columns3 className="h-3.5 w-3.5 text-[var(--av-text-muted)]" />
                        <span>Columns</span>
                      </button>

                      {columnsMenuOpen && (
                        <div className="absolute right-0 mt-1.5 z-30 w-64 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-xl p-3 space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--av-text)] pb-1.5 border-b border-[var(--av-border-subtle)]">
                            <span className="inline-flex items-center gap-1">
                              <SlidersHorizontal className="h-3 w-3" />
                              Discovered Fields
                            </span>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setVisibleColumns(null)}
                                className="text-[10px] font-medium text-[var(--av-accent)] hover:underline"
                              >
                                Default
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setVisibleColumns(discoveredColumns.map((c) => c.key))
                                }
                                className="text-[10px] font-medium text-[var(--av-text-muted)] hover:underline"
                              >
                                All
                              </button>
                            </div>
                          </div>
                          <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                            {discoveredColumns.map((col) => {
                              const checked = activeColumnKeys.includes(col.key);
                              return (
                                <label
                                  key={col.key}
                                  className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px] hover:bg-[var(--av-surface-hover)] cursor-pointer"
                                >
                                  <span className="flex items-center gap-2 truncate">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleColumnVisibility(col.key)}
                                    />
                                    <span className="font-mono truncate text-[var(--av-text)]">
                                      {col.label}
                                    </span>
                                  </span>
                                  {col.isPayload && (
                                    <span className="font-mono text-[9px] text-[var(--av-text-subtle)] shrink-0">
                                      payload
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => void refreshCountsAndDocs()}
                    className="rounded-lg border border-[var(--av-border)] p-1.5 text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                    title="Refresh Firestore documents"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingDocs ? 'animate-spin' : ''}`} />
                  </button>

                  {canCreate && (
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="inline-flex items-center gap-1 rounded-lg bg-[var(--av-accent)] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>New Doc</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto max-h-[500px]">
                {filteredAndSortedDocs.length === 0 && !loadingDocs ? (
                  <div className="p-10 text-center text-xs text-[var(--av-text-subtle)] space-y-2">
                    <div>
                      No Firestore documents returned for <span className="font-mono">{selectedCollection}</span>
                      {tenantFilter ? ` (tenant: ${tenantFilter})` : ''}.
                    </div>
                    {!isCustomCollection && (
                      <div>
                        Click <strong>Sync {selectedCollection}</strong> or{' '}
                        <strong>Sync All → Firestore</strong> above to populate records from the platform database.
                      </div>
                    )}
                  </div>
                ) : (
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-[var(--av-surface-muted)] border-b border-[var(--av-border)] text-[11px] font-semibold text-[var(--av-text-muted)]">
                      <tr>
                        <th className="py-2.5 px-3.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleSort('__docId')}
                            className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                          >
                            <span>docId</span>
                            {sortColumn === '__docId' ? (
                              sortDirection === 'asc' ? (
                                <ArrowUp className="h-3 w-3" />
                              ) : (
                                <ArrowDown className="h-3 w-3" />
                              )
                            ) : (
                              <ArrowUpDown className="h-3 w-3 opacity-40" />
                            )}
                          </button>
                        </th>
                        {activeColumns.map((col) => (
                          <th key={col.key} className="py-2.5 px-3.5 whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => toggleSort(col.key)}
                              className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                            >
                              <span className="font-mono">{col.label}</span>
                              {sortColumn === col.key ? (
                                sortDirection === 'asc' ? (
                                  <ArrowUp className="h-3 w-3" />
                                ) : (
                                  <ArrowDown className="h-3 w-3" />
                                )
                              ) : (
                                <ArrowUpDown className="h-3 w-3 opacity-40" />
                              )}
                            </button>
                          </th>
                        ))}
                        <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                      {pagedDocs.map((row) => (
                        <tr key={row.docId} className="hover:bg-[var(--av-surface-hover)]">
                          <td className="py-2.5 px-3.5 font-mono text-[11px] text-amber-600 dark:text-amber-400 whitespace-nowrap">
                            {row.docId}
                          </td>
                          {activeColumns.map((col) => {
                            const raw = getValueByColumnKey(row, col.key);
                            const formatted = formatCellValue(raw);
                            const isMono =
                              typeof raw === 'number' ||
                              typeof raw === 'boolean' ||
                              col.key === 'tenantId' ||
                              col.key === 'orgId' ||
                              col.key === 'updatedAt' ||
                              col.key === 'createdAt';
                            return (
                              <td
                                key={col.key}
                                title={formatted}
                                className={`py-2.5 px-3.5 max-w-[220px] truncate ${
                                  isMono
                                    ? 'font-mono text-[11px] text-[var(--av-text-muted)] tabular-nums'
                                    : 'text-[var(--av-text)]'
                                }`}
                              >
                                {formatted}
                              </td>
                            );
                          })}
                          <td className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1">
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => openEditModal(row, 'fields')}
                                  className="inline-flex items-center gap-1 rounded-md border border-[var(--av-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                                >
                                  <Pencil className="h-3 w-3" />
                                  <span>Edit Fields</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => openEditModal(row, 'json')}
                                className="inline-flex items-center gap-1 rounded-md border border-[var(--av-border)] px-2 py-1 text-[11px] font-mono text-[var(--av-text-subtle)] hover:text-[var(--av-text)]"
                                title={canEdit ? 'Edit Raw JSON' : 'Inspect Raw JSON'}
                              >
                                <Code2 className="h-3 w-3" />
                                <span>JSON</span>
                              </button>
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDeleteTarget({
                                      collection: selectedCollection,
                                      docId: row.docId,
                                    })
                                  }
                                  className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15"
                                  title="Delete Firestore document"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Pagination Footer */}
              {filteredAndSortedDocs.length > 0 && (
                <div className="border-t border-[var(--av-border-subtle)] px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--av-text-muted)]">
                  <div className="tabular-nums">
                    Showing {(safePage - 1) * pageSize + 1}–
                    {Math.min(safePage * pageSize, filteredAndSortedDocs.length)} of{' '}
                    {filteredAndSortedDocs.length}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                      aria-label="Rows per page"
                      className="rounded border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-2 py-1 text-[11px]"
                    >
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                    </select>
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      className="rounded border border-[var(--av-border)] p-1 disabled:opacity-40"
                      aria-label="Previous page"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono tabular-nums">
                      {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      className="rounded border border-[var(--av-border)] p-1 disabled:opacity-40"
                      aria-label="Next page"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Recent Firestore Change Audit Log Trail */}
          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
            <div className="border-b border-[var(--av-border-subtle)] px-5 py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <History className="h-4 w-4 text-[var(--av-accent)]" />
                <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                  Live Firestore Change Audit Trail ({recentAudits.length})
                </h4>
                <span className="text-[11px] text-[var(--av-text-subtle)]">
                  Every document edit, create, delete, reset, and sync writes an immutable field-diff entry to{' '}
                  <span className="font-mono">platformAuditLogs</span>.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSelectCollection('platformAuditLogs')}
                  className="rounded-lg border border-[var(--av-border)] px-2.5 py-1 text-[11px] font-semibold text-[var(--av-accent)] hover:bg-[var(--av-surface-hover)]"
                >
                  Open platformAuditLogs in Table
                </button>
                <button
                  type="button"
                  onClick={() => void fetchRecentAudits()}
                  className="rounded-lg border border-[var(--av-border)] p-1 text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                  title="Refresh audit trail"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingAudits ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="max-h-72 overflow-y-auto divide-y divide-[var(--av-border-subtle)] text-xs">
              {recentAudits.length === 0 ? (
                <div className="p-6 text-center text-[var(--av-text-subtle)]">
                  No Firestore mutations logged yet in this database. Edit or create any document above to generate an audit record.
                </div>
              ) : (
                recentAudits.map((entry) => {
                  const p =
                    entry.data.payload && typeof entry.data.payload === 'object'
                      ? (entry.data.payload as Record<string, unknown>)
                      : {};
                  const actionLabel = String(p.action || entry.data.priority || 'UPDATE');
                  const summary = String(p.summary || entry.data.title || entry.docId);
                  const reason = typeof p.reason === 'string' ? p.reason : '';
                  const actorEmail = typeof p.actorEmail === 'string' ? p.actorEmail : '';
                  const recordedAt = String(p.recordedAt || entry.data.createdAt || '');
                  const diffs = Array.isArray(p.changedFields)
                    ? (p.changedFields as FirestoreFieldDiff[])
                    : [];

                  return (
                    <div key={entry.docId} className="px-5 py-3 space-y-1.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-[var(--av-surface-muted)] border border-[var(--av-border)] text-[var(--av-accent)]">
                            {actionLabel}
                          </span>
                          <span className="font-medium text-[var(--av-text)]">{summary}</span>
                        </div>
                        <div className="font-mono text-[10px] text-[var(--av-text-subtle)] tabular-nums">
                          {actorEmail ? `${actorEmail} · ` : ''}
                          {recordedAt ? recordedAt.slice(0, 19).replace('T', ' ') : ''}
                        </div>
                      </div>
                      {reason && (
                        <div className="text-[11px] text-[var(--av-text-muted)]">
                          Reason: <span className="italic">{reason}</span>
                        </div>
                      )}
                      {diffs.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-0.5">
                          {diffs.slice(0, 6).map((d) => (
                            <span
                              key={d.field}
                              className="inline-flex items-center gap-1 rounded border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] px-2 py-0.5 font-mono text-[10px] text-[var(--av-text-muted)]"
                            >
                              <span className="text-[var(--av-text)] font-semibold">{d.field}:</span>
                              <span className="line-through opacity-70">{formatDiffValue(d.before)}</span>
                              <span>→</span>
                              <span className="text-emerald-600 dark:text-emerald-400">
                                {formatDiffValue(d.after)}
                              </span>
                            </span>
                          ))}
                          {diffs.length > 6 && (
                            <span className="font-mono text-[10px] text-[var(--av-text-subtle)] self-center">
                              +{diffs.length - 6} more field(s)
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Firestore Tenant Purge & Collection Reset */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3.5">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                    Delete Particular Tenant Data in Firestore
                  </h4>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Deletes mutable Firestore documents owned by the selected tenant across all collections (immutable audit/transfer/payment ledgers remain protected by rules).
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                  Target Tenant ID
                </label>
                <select
                  value={purgeTenantId}
                  onChange={(e) => setPurgeTenantId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.id})
                    </option>
                  ))}
                </select>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeTenantRoot}
                  onChange={(e) => setIncludeTenantRoot(e.target.checked)}
                />
                <span>Also delete root tenant profile &amp; registry documents in Firestore</span>
              </label>

              <div>
                <button
                  type="button"
                  disabled={!purgeTenantId || purgingTenant}
                  onClick={() => setPurgeConfirmOpen(true)}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  Delete Tenant Firestore Data
                </button>
              </div>
            </div>

            <form
              onSubmit={handleResetFirestoreCol}
              className="rounded-xl border border-rose-300/60 dark:border-rose-500/30 bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3.5"
            >
              <div className="flex items-start gap-2.5">
                <RotateCcw className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-display text-sm font-bold text-rose-700 dark:text-rose-400">
                    Reset Individual Firestore Collection
                  </h4>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Batch-deletes documents from a single mutable Cloud Firestore collection (globally or scoped to one tenant).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  value={resetCol}
                  onChange={(e) => {
                    setResetCol(e.target.value);
                    setResetConfirmText('');
                  }}
                  className={INPUT_CLASS}
                >
                  {resettableFirestoreCols.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.label} ({counts[c.name] ?? 0})
                    </option>
                  ))}
                </select>
                <select
                  value={resetTenantScope}
                  onChange={(e) => setResetTenantScope(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">All Tenants in Collection</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      Only {t.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  value={resetConfirmText}
                  onChange={(e) => setResetConfirmText(e.target.value)}
                  placeholder={`Type "${expectedResetCode}" to confirm`}
                  className={`${INPUT_CLASS} font-mono`}
                />
                <button
                  type="submit"
                  disabled={resettingCol || resetConfirmText.trim() !== expectedResetCode}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  {resettingCol ? 'Resetting...' : 'Reset Collection'}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {/* Create / Edit Firestore Document Modal (Structured Field Editor + Raw JSON) */}
      <AnimatePresence>
        {editorMode && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Edit Firestore document"
          >
            <div className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    {editorMode === 'create'
                      ? `New Firestore Document · ${selectedCollection}`
                      : `${canEdit ? 'Edit' : 'Inspect'} Document · ${selectedCollection}/${editorDocId}`}
                  </h3>
                  <p className="text-[11px] text-[var(--av-text-subtle)] mt-0.5">
                    Every saved modification automatically records a field-level diff in immutable audit logs.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] p-0.5">
                    <button
                      type="button"
                      onClick={() => switchEditorTab('fields')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        editorTab === 'fields'
                          ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                          : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                      }`}
                    >
                      Field Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => switchEditorTab('json')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        editorTab === 'json'
                          ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                          : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                      }`}
                    >
                      Raw JSON
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditorMode(null)}
                    className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSaveDocument} className="flex-1 overflow-y-auto p-6 space-y-5">
                {editorError && (
                  <div className="rounded-lg border border-rose-300/60 dark:border-rose-500/30 bg-rose-50/80 dark:bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300 break-words">
                    {editorError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--av-text-muted)] mb-1">
                      Document ID
                    </label>
                    <input
                      type="text"
                      required
                      disabled={editorMode === 'edit'}
                      value={editorDocId}
                      onChange={(e) => setEditorDocId(e.target.value)}
                      className={`${INPUT_CLASS} font-mono disabled:opacity-60`}
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--av-text-muted)] mb-1">
                      Audit Change Note (optional)
                    </label>
                    <input
                      type="text"
                      disabled={!canEdit && editorMode === 'edit'}
                      value={auditReason}
                      onChange={(e) => setAuditReason(e.target.value)}
                      placeholder="e.g. Verified serial number & corrected status"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                {editorTab === 'fields' ? (
                  <div className="space-y-5">
                    {/* Top-Level Fields */}
                    <div className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--av-text-subtle)]">
                        Document Fields ({topLevelEntries.length})
                      </div>
                      <div className="divide-y divide-[var(--av-border-subtle)] rounded-lg border border-[var(--av-border)] overflow-hidden">
                        {topLevelEntries.map(([fieldKey, val]) => {
                          const locked = !canEdit && editorMode === 'edit' ? true : isLockedFieldOnEdit(fieldKey);
                          const fType = inferFieldType(val);
                          return (
                            <div
                              key={fieldKey}
                              className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start p-3 bg-[var(--av-surface)]"
                            >
                              <div className="sm:col-span-4 space-y-0.5 pt-1">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-mono text-xs font-semibold text-[var(--av-text)] break-all">
                                    {fieldKey}
                                  </span>
                                  {locked && (
                                    <Lock className="h-3 w-3 text-[var(--av-text-subtle)] shrink-0" />
                                  )}
                                </div>
                                <div className="font-mono text-[10px] text-[var(--av-text-subtle)]">
                                  {fType}
                                  {locked ? ' · read-only' : ''}
                                </div>
                              </div>
                              <div className="sm:col-span-7">
                                {renderStructuredFieldControl('top', fieldKey, val, locked)}
                              </div>
                              <div className="sm:col-span-1 flex justify-end pt-1">
                                {!locked && !isRequiredTopField(fieldKey) && (
                                  <button
                                    type="button"
                                    onClick={() => deleteDraftField('top', fieldKey)}
                                    className="p-1 rounded text-[var(--av-text-subtle)] hover:text-rose-600"
                                    title={`Remove field ${fieldKey}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Nested Payload Fields (tenant-scoped collections) */}
                    {payloadObject && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--av-text-subtle)]">
                            Record Payload Fields ({payloadEntries.length})
                          </span>
                          <span className="font-mono text-[10px] text-[var(--av-text-subtle)]">
                            stored under payload.*
                          </span>
                        </div>
                        <div className="divide-y divide-[var(--av-border-subtle)] rounded-lg border border-[var(--av-border)] overflow-hidden">
                          {payloadEntries.length === 0 ? (
                            <div className="p-3 text-xs text-[var(--av-text-subtle)]">
                              No payload attributes yet. Use Add Field below to add custom fields.
                            </div>
                          ) : (
                            payloadEntries.map(([subKey, val]) => {
                              const locked = !canEdit && editorMode === 'edit';
                              const fType = inferFieldType(val);
                              return (
                                <div
                                  key={subKey}
                                  className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-start p-3 bg-[var(--av-surface)]"
                                >
                                  <div className="sm:col-span-4 space-y-0.5 pt-1">
                                    <div className="font-mono text-xs font-semibold text-[var(--av-text)] break-all">
                                      {subKey}
                                    </div>
                                    <div className="font-mono text-[10px] text-[var(--av-text-subtle)]">
                                      payload · {fType}
                                    </div>
                                  </div>
                                  <div className="sm:col-span-7">
                                    {renderStructuredFieldControl('payload', subKey, val, locked)}
                                  </div>
                                  <div className="sm:col-span-1 flex justify-end pt-1">
                                    {!locked && (
                                      <button
                                        type="button"
                                        onClick={() => deleteDraftField('payload', subKey)}
                                        className="p-1 rounded text-[var(--av-text-subtle)] hover:text-rose-600"
                                        title={`Remove payload.${subKey}`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      </div>
                    )}

                    {/* Add Field Builder (free-form for flexible collections, schema-guided for fixed collections) */}
                    {(canEdit || editorMode === 'create') &&
                      !(selectedCollection === 'payments' && editorMode === 'edit') &&
                      (!selectedMeta ||
                      selectedMeta.kind === 'tenant_scoped' ||
                      selectedMeta.kind === 'platform_config' ? (
                        <div className="rounded-lg border border-dashed border-[var(--av-border)] bg-[var(--av-surface-muted)] p-3.5 space-y-2.5">
                          <div className="text-[11px] font-semibold text-[var(--av-text)]">
                            + Add New Field
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
                            {selectedMeta?.kind === 'tenant_scoped' && (
                              <select
                                value={newFieldScope}
                                onChange={(e) =>
                                  setNewFieldScope(e.target.value as 'top' | 'payload')
                                }
                                aria-label="Target field location"
                                className={`${INPUT_CLASS} sm:col-span-2`}
                              >
                                <option value="payload">payload.*</option>
                                <option value="top">Top-level</option>
                              </select>
                            )}
                            <input
                              type="text"
                              value={newFieldKey}
                              onChange={(e) => setNewFieldKey(e.target.value)}
                              placeholder="Field key (e.g. serialNumber)"
                              className={`${INPUT_CLASS} font-mono ${
                                selectedMeta?.kind === 'tenant_scoped'
                                  ? 'sm:col-span-3'
                                  : 'sm:col-span-4'
                              }`}
                            />
                            <select
                              value={newFieldType}
                              onChange={(e) => {
                                const nextType = e.target.value as FieldValueType;
                                setNewFieldType(nextType);
                                if (nextType === 'boolean') setNewFieldValue('true');
                                else if (nextType === 'number') setNewFieldValue('0');
                                else if (nextType === 'json') setNewFieldValue('{}');
                                else setNewFieldValue('');
                              }}
                              aria-label="New field type"
                              className={`${INPUT_CLASS} sm:col-span-2`}
                            >
                              <option value="string">string</option>
                              <option value="number">number</option>
                              <option value="boolean">boolean</option>
                              <option value="json">json</option>
                            </select>
                            {newFieldType === 'boolean' ? (
                              <select
                                value={newFieldValue || 'true'}
                                onChange={(e) => setNewFieldValue(e.target.value)}
                                className={`${INPUT_CLASS} sm:col-span-3`}
                              >
                                <option value="true">true</option>
                                <option value="false">false</option>
                              </select>
                            ) : (
                              <input
                                type={newFieldType === 'number' ? 'number' : 'text'}
                                step="any"
                                value={newFieldValue}
                                onChange={(e) => setNewFieldValue(e.target.value)}
                                placeholder={
                                  newFieldType === 'json' ? '{"key":"val"}' : 'Initial value'
                                }
                                className={`${INPUT_CLASS} sm:col-span-3`}
                              />
                            )}
                            <button
                              type="button"
                              onClick={handleAddField}
                              className="sm:col-span-2 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text)] hover:bg-[var(--av-surface-hover)] whitespace-nowrap"
                            >
                              Add Field
                            </button>
                          </div>
                        </div>
                      ) : (() => {
                        const candidates = (OPTIONAL_KEYS_BY_KIND[selectedMeta.kind] || []).filter(
                          (item) => editorDraft[item.key] === undefined
                        );
                        if (candidates.length === 0) return null;
                        return (
                          <div className="rounded-lg border border-dashed border-[var(--av-border)] bg-[var(--av-surface-muted)] p-3.5 flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[11px] font-medium text-[var(--av-text-muted)]">
                              Add optional schema field:
                            </span>
                            <div className="flex flex-wrap gap-1.5">
                              {candidates.map((opt) => (
                                <button
                                  key={opt.key}
                                  type="button"
                                  onClick={() => updateTopLevelField(opt.key, opt.defaultVal)}
                                  className="rounded-md border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1 font-mono text-[11px] text-[var(--av-text)] hover:bg-[var(--av-surface-hover)]"
                                >
                                  + {opt.key}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })())}
                  </div>
                ) : (
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-muted)] mb-1">
                      Firestore Document JSON
                    </label>
                    <textarea
                      rows={15}
                      disabled={!canEdit && editorMode === 'edit'}
                      value={editorJson}
                      onChange={(e) => setEditorJson(e.target.value)}
                      spellCheck={false}
                      className={`${INPUT_CLASS} font-mono text-[11px] leading-relaxed disabled:opacity-70`}
                    />
                  </div>
                )}

                {/* Live Diff Preview */}
                {liveDiffs.length > 0 && (
                  <div className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] p-3.5 space-y-2">
                    <div className="text-[11px] font-semibold text-[var(--av-text)]">
                      Pending Audit Diff ({liveDiffs.length} field
                      {liveDiffs.length === 1 ? '' : 's'} modified)
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1 font-mono text-[11px]">
                      {liveDiffs.map((d) => (
                        <div key={d.field} className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-[var(--av-text)]">{d.field}:</span>
                          <span className="text-[var(--av-text-subtle)] line-through">
                            {formatDiffValue(d.before)}
                          </span>
                          <span className="text-[var(--av-text-subtle)]">→</span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {formatDiffValue(d.after)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setEditorMode(null)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                  >
                    {canEdit || editorMode === 'create' ? 'Cancel' : 'Close'}
                  </button>
                  {(canEdit || editorMode === 'create') && (
                    <button
                      type="submit"
                      disabled={savingDoc}
                      className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                    >
                      {savingDoc
                        ? 'Saving & Logging Audit...'
                        : editorMode === 'create'
                          ? 'Create Document'
                          : 'Save & Record Audit Log'}
                    </button>
                  )}
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Firestore Document"
        description={`Permanently delete Cloud Firestore document "${deleteTarget?.collection}/${deleteTarget?.docId}"? This action will be recorded in the audit ledger.`}
        confirmLabel="Delete Document"
        loading={deletingDoc}
        onConfirm={handleConfirmDeleteDoc}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={purgeConfirmOpen}
        title="Delete Tenant Data in Cloud Firestore"
        description={`Delete all mutable Cloud Firestore records for tenant "${purgeTenantId}"${includeTenantRoot ? ' including its tenant profile & registry docs' : ''}?`}
        confirmLabel="Delete Firestore Data"
        loading={purgingTenant}
        onConfirm={handleConfirmPurgeTenant}
        onCancel={() => setPurgeConfirmOpen(false)}
      />
    </div>
  );
}
