import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { api } from './api.ts';
import { auth, db, handleFirestoreError, OperationType } from './firebase.ts';
import type { PlatformDbSnapshot } from './api.ts';

export type FirestoreCollectionKind =
  | 'tenant_scoped'
  | 'plan'
  | 'tenant'
  | 'subscription_tx'
  | 'membership'
  | 'user_public'
  | 'platform_config';

export interface FirestoreCollectionMeta {
  name: string;
  label: string;
  category:
    | 'Core SaaS'
    | 'ITAM & Custody'
    | 'ITSM & Helpdesk'
    | 'Procurement & Vendors'
    | 'Governance & Logs';
  kind: FirestoreCollectionKind;
  tenantScoped: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReset: boolean;
  immutableNotice?: string;
}

export const FIRESTORE_COLLECTION_CATALOG: FirestoreCollectionMeta[] = [
  { name: 'tenants', label: 'Tenants', category: 'Core SaaS', kind: 'tenant', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: false },
  { name: 'tenantRegistry', label: 'Tenant Registry', category: 'Core SaaS', kind: 'tenant', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: false },
  { name: 'plans', label: 'Subscription Plans', category: 'Core SaaS', kind: 'plan', tenantScoped: false, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'platformSettings', label: 'Platform Settings', category: 'Core SaaS', kind: 'platform_config', tenantScoped: false, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'clientOrganisations', label: 'Client Organisations', category: 'Core SaaS', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'locations', label: 'Locations & Sites', category: 'Core SaaS', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'departments', label: 'Departments', category: 'Core SaaS', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'users', label: 'Users (Public)', category: 'Core SaaS', kind: 'user_public', tenantScoped: false, canCreate: true, canEdit: true, canDelete: true, canReset: false },
  { name: 'userMemberships', label: 'User Memberships', category: 'Core SaaS', kind: 'membership', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'members', label: 'Tenant Members', category: 'Core SaaS', kind: 'membership', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'subscriptions', label: 'Subscriptions', category: 'Core SaaS', kind: 'subscription_tx', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'payments', label: 'Payments', category: 'Core SaaS', kind: 'subscription_tx', tenantScoped: true, canCreate: true, canEdit: true, canDelete: false, canReset: false, immutableNotice: 'Payments cannot be deleted per Firestore ledger rules (status updates allowed).' },
  { name: 'invoices', label: 'Invoices', category: 'Core SaaS', kind: 'subscription_tx', tenantScoped: true, canCreate: true, canEdit: true, canDelete: false, canReset: false, immutableNotice: 'Invoices cannot be deleted per Firestore ledger rules.' },
  { name: 'usage', label: 'Tenant Usage Counters', category: 'Core SaaS', kind: 'platform_config', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'employees', label: 'Employees', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assets', label: 'IT Assets', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assetAssignments', label: 'Asset Assignments', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assetMaintenance', label: 'Maintenance Logs', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assetTransfers', label: 'Asset Transfers', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: false, canDelete: false, canReset: false, immutableNotice: 'Immutable chain-of-custody ledger (append-only).' },
  { name: 'softwareLicences', label: 'Software Licences', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'tickets', label: 'Helpdesk Tickets', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'incidents', label: 'Incidents', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'problems', label: 'Problems (KEDB)', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'changes', label: 'Change Requests', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'serviceCatalogue', label: 'Service Catalogue', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'serviceRequests', label: 'Service Requests', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'slaPolicies', label: 'SLA Policies', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'contracts', label: 'Service Contracts', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'knowledgeArticles', label: 'Knowledge Base', category: 'ITSM & Helpdesk', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'vendors', label: 'Vendors', category: 'Procurement & Vendors', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'purchaseRequests', label: 'Purchase Requests', category: 'Procurement & Vendors', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'purchaseOrders', label: 'Purchase Orders', category: 'Procurement & Vendors', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'platformAdmins', label: 'Platform Admins', category: 'Governance & Logs', kind: 'platform_config', tenantScoped: false, canCreate: true, canEdit: true, canDelete: true, canReset: false },
  { name: 'platform', label: 'Platform Root Docs', category: 'Governance & Logs', kind: 'platform_config', tenantScoped: false, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'provisioningJobs', label: 'Provisioning Jobs', category: 'Governance & Logs', kind: 'platform_config', tenantScoped: false, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assetCategories', label: 'Asset Categories', category: 'ITAM & Custody', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'approvals', label: 'Approvals Ledger', category: 'Governance & Logs', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: false, canDelete: false, canReset: false, immutableNotice: 'Immutable approvals ledger (append-only).' },
  { name: 'notifications', label: 'Notifications', category: 'Governance & Logs', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'integrations', label: 'Integrations Config', category: 'Governance & Logs', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'customFields', label: 'Custom Fields', category: 'Governance & Logs', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'auditLogs', label: 'Tenant Audit Logs', category: 'Governance & Logs', kind: 'tenant_scoped', tenantScoped: true, canCreate: true, canEdit: false, canDelete: false, canReset: false, immutableNotice: 'Immutable tenant audit ledger (append-only).' },
  { name: 'platformAuditLogs', label: 'Platform Audit Logs', category: 'Governance & Logs', kind: 'tenant_scoped', tenantScoped: false, canCreate: true, canEdit: false, canDelete: false, canReset: false, immutableNotice: 'Immutable platform audit ledger (append-only).' },
];

const CATALOG_MAP = new Map<string, FirestoreCollectionMeta>(
  FIRESTORE_COLLECTION_CATALOG.map((c) => [c.name, c])
);

export const BOOTSTRAP_SUPER_ADMIN_EMAIL = 'tonadoappiah50@gmail.com';

export function getFirestoreCollectionMeta(
  name: string
): FirestoreCollectionMeta | undefined {
  const direct = CATALOG_MAP.get(name);
  if (direct) return direct;
  if (/^tickets\/[^/]+\/(comments|attachments)$/.test(name)) {
    return {
      name,
      label: name.endsWith('/comments') ? 'Ticket Comments' : 'Ticket Attachments',
      category: 'ITSM & Helpdesk',
      kind: 'platform_config',
      tenantScoped: true,
      canCreate: true,
      canEdit: false,
      canDelete: false,
      canReset: false,
      immutableNotice: 'Ticket comments & attachments are immutable append-only subcollections.',
    };
  }
  if (/^tenants\/[^/]+\/config$/.test(name)) {
    return {
      name,
      label: 'Tenant Config',
      category: 'Core SaaS',
      kind: 'platform_config',
      tenantScoped: true,
      canCreate: true,
      canEdit: true,
      canDelete: true,
      canReset: true,
    };
  }
  return undefined;
}

export function sanitizeFirestoreId(raw: string, prefix = 'doc'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  if (cleaned.length > 0) return cleaned;
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function parseCollectionSegments(collectionPath: string): string[] {
  const segments = String(collectionPath || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length === 0 || segments.length % 2 === 0) {
    throw new Error(
      'Enter a valid Firestore collection name or odd-segment subcollection path (e.g. "assets" or "tickets/tkt_1/comments").'
    );
  }
  for (const seg of segments) {
    if (!/^[a-zA-Z0-9_-]+$/.test(seg) || seg.length > 128) {
      throw new Error(
        `Invalid collection segment "${seg}". Use alphanumeric characters, dashes, or underscores.`
      );
    }
  }
  return segments;
}

function resolveCollectionRef(collectionPath: string) {
  const [first, ...rest] = parseCollectionSegments(collectionPath);
  return collection(db, first, ...rest);
}

function resolveDocRef(collectionPath: string, docId: string) {
  const [first, ...rest] = parseCollectionSegments(collectionPath);
  return doc(db, first, ...rest, docId);
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return false;
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function stripUndefinedDeep<T>(val: T): T {
  if (Array.isArray(val)) {
    return val
      .filter((item) => item !== undefined)
      .map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (isPlainObject(val)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return val;
}

function serializeFirestoreValue(val: unknown): unknown {
  if (val instanceof Timestamp) {
    return val.toDate().toISOString();
  }
  if (Array.isArray(val)) {
    return val.map(serializeFirestoreValue);
  }
  if (val && typeof val === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = serializeFirestoreValue(v);
    }
    return out;
  }
  return val;
}

export function parseFirestoreUiError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  try {
    const parsed = JSON.parse(err.message) as {
      error?: string;
      operationType?: string;
      path?: string;
    };
    if (parsed && typeof parsed.error === 'string') {
      return `${parsed.error}${parsed.path ? ` (${parsed.operationType || 'op'} @ ${parsed.path})` : ''}`;
    }
  } catch {
    // plain error string
  }
  return err.message;
}

export interface FirestoreDocRow {
  docId: string;
  data: Record<string, unknown>;
}

export interface FirestoreFieldDiff {
  field: string;
  before: unknown;
  after: unknown;
}

function flattenForDiff(
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'createdAt' || key === 'updatedAt') continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = flattenForDiff(value as Record<string, unknown>, path);
      if (Object.keys(nested).length === 0) {
        out[path] = value;
      } else {
        Object.assign(out, nested);
      }
    } else {
      out[path] = value;
    }
  }
  return out;
}

export function computeDocumentDiff(
  beforeObj: Record<string, unknown> | null | undefined,
  afterObj: Record<string, unknown> | null | undefined
): FirestoreFieldDiff[] {
  const beforeFlat = beforeObj ? flattenForDiff(beforeObj) : {};
  const afterFlat = afterObj ? flattenForDiff(afterObj) : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeFlat), ...Object.keys(afterFlat)])
  ).sort();

  const diffs: FirestoreFieldDiff[] = [];
  for (const field of keys) {
    const prev = beforeFlat[field];
    const next = afterFlat[field];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      diffs.push({
        field,
        before: prev === undefined ? null : prev,
        after: next === undefined ? null : next,
      });
    }
  }
  return diffs;
}

export async function recordFirestoreAuditLog(params: {
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'RESET' | 'TENANT_PURGE' | 'SYNC';
  collectionName: string;
  docId: string;
  tenantId?: string;
  summary: string;
  reason?: string;
  changedFields?: FirestoreFieldDiff[];
}): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error('Verified Firebase authentication is required to record audit logs.');
  }

  const logId = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const safeTenantId = sanitizeFirestoreId(params.tenantId || 'platform', 'ten');
  const safeCategory = sanitizeFirestoreId(params.collectionName, 'col').slice(0, 80);
  const logPath = `platformAuditLogs/${logId}`;

  const safeChangedFields = (params.changedFields || [])
    .slice(0, 40)
    .map((d) => ({
      field: String(d.field || '').slice(0, 120),
      before: stripUndefinedDeep(d.before === undefined ? null : d.before),
      after: stripUndefinedDeep(d.after === undefined ? null : d.after),
    }));

  const auditPayload = stripUndefinedDeep({
    id: logId,
    tenantId: safeTenantId,
    orgId: 'platform',
    title: `${params.action} · ${params.collectionName}/${params.docId}`.slice(0, 240),
    category: safeCategory,
    priority: params.action,
    status: 'Recorded',
    payload: {
      action: params.action,
      collection: params.collectionName,
      docId: params.docId,
      tenantId: safeTenantId,
      actorUid: currentUser.uid,
      actorEmail: currentUser.email || BOOTSTRAP_SUPER_ADMIN_EMAIL,
      summary: params.summary.slice(0, 500),
      ...(params.reason ? { reason: params.reason.slice(0, 300) } : {}),
      changedFields: safeChangedFields,
      recordedAt: new Date().toISOString(),
    },
    tags: [params.action.toLowerCase(), safeCategory].slice(0, 10),
    createdBy: currentUser.uid,
    updatedBy: currentUser.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'platformAuditLogs', logId), auditPayload as DocumentData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, logPath);
  }

  // Mirror to backend platform governance audit log so SuperAdminView audit feed stays synced
  try {
    await api.recordPlatformAuditLog({
      action: `FIRESTORE_${params.action}`,
      entityType: params.collectionName,
      entityId: params.docId,
      tenantId: safeTenantId,
      summary: `${params.summary}${params.reason ? ` — Reason: ${params.reason}` : ''}`,
    });
  } catch {
    // Firestore immutable audit entry is already persisted; ignore secondary mirror errors
  }

  return logId;
}

export async function fetchFirestoreDocuments(
  collectionName: string,
  tenantFilter?: string,
  maxDocs = 250
): Promise<FirestoreDocRow[]> {
  try {
    const colRef = resolveCollectionRef(collectionName);
    const meta = CATALOG_MAP.get(collectionName);
    const qRef =
      tenantFilter &&
      meta?.tenantScoped &&
      collectionName !== 'tenants' &&
      collectionName !== 'tenantRegistry' &&
      collectionName !== 'usage'
        ? query(colRef, where('tenantId', '==', tenantFilter), limit(maxDocs))
        : query(colRef, limit(maxDocs));

    const snap = await getDocs(qRef);
    const rows: FirestoreDocRow[] = snap.docs.map((d) => ({
      docId: d.id,
      data: serializeFirestoreValue(d.data()) as Record<string, unknown>,
    }));

    if (
      tenantFilter &&
      (collectionName === 'tenants' ||
        collectionName === 'tenantRegistry' ||
        collectionName === 'usage')
    ) {
      return rows.filter(
        (r) => r.docId === tenantFilter || String(r.data.id ?? '') === tenantFilter
      );
    }
    if (tenantFilter && !meta) {
      return rows.filter(
        (r) =>
          !r.data.tenantId ||
          String(r.data.tenantId) === tenantFilter ||
          r.docId === tenantFilter
      );
    }
    return rows;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, collectionName);
  }
}

export async function fetchSingleFirestoreCollectionCount(
  collectionName: string
): Promise<number> {
  const colRef = resolveCollectionRef(collectionName);
  try {
    const agg = await getCountFromServer(colRef);
    return agg.data().count;
  } catch {
    try {
      const snap = await getDocs(query(colRef, limit(500)));
      return snap.size;
    } catch {
      return 0;
    }
  }
}

export async function fetchFirestoreCollectionCounts(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  await Promise.all(
    FIRESTORE_COLLECTION_CATALOG.map(async (meta) => {
      counts[meta.name] = await fetchSingleFirestoreCollectionCount(meta.name);
    })
  );
  return counts;
}

function stripReadOnlyInputFields(input: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...input };
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
}

function normalizeTenantStatus(rawStatus: unknown): 'active' | 'suspended' | 'trial' | 'grace' {
  const s = String(rawStatus ?? '').trim().toLowerCase();
  if (s === 'trialing' || s === 'trial') return 'trial';
  if (s === 'suspended') return 'suspended';
  if (s === 'grace' || s === 'grace_period') return 'grace';
  return 'active';
}

function normalizePlanCode(rawPlan: unknown): 'starter' | 'professional' | 'business' | 'enterprise' {
  const p = String(rawPlan ?? '').trim().toLowerCase();
  if (p === 'starter' || p === 'professional' || p === 'business' || p === 'enterprise') {
    return p;
  }
  return 'professional';
}

function buildUpdatePayloadForKind(
  kind: FirestoreCollectionKind,
  raw: Record<string, unknown>,
  uid: string,
  collectionName?: string,
  beforeSnapshot?: Record<string, unknown> | null
): { patch: Record<string, unknown>; deletedKeys: string[] } {
  const data = stripUndefinedDeep(stripReadOnlyInputFields(raw));
  const deletedKeys: string[] = [];
  const hasChanged = (key: string, nextVal: unknown): boolean => {
    if (!beforeSnapshot) return true;
    return JSON.stringify(beforeSnapshot[key]) !== JSON.stringify(nextVal);
  };

  switch (kind) {
    case 'plan': {
      const allowed = [
        'name',
        'description',
        'tagline',
        'monthlyPriceGhs',
        'annualPriceGhs',
        'isPublic',
        'isCustomAnnual',
        'limits',
        'features',
      ];
      const optionalDeletable = new Set(['description', 'tagline', 'isCustomAnnual', 'limits', 'features']);
      const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
      for (const k of allowed) {
        if (data[k] !== undefined) {
          if (hasChanged(k, data[k])) out[k] = data[k];
        } else if (beforeSnapshot && beforeSnapshot[k] !== undefined && optionalDeletable.has(k)) {
          out[k] = deleteField();
          deletedKeys.push(k);
        }
      }
      return { patch: out, deletedKeys };
    }
    case 'tenant': {
      const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (typeof data.name === 'string' && data.name.trim()) {
        const val = data.name.trim().slice(0, 160);
        if (hasChanged('name', val)) out.name = val;
      }
      if (typeof data.slug === 'string' && data.slug.trim().length >= 2) {
        const val = data.slug.trim().slice(0, 160);
        if (hasChanged('slug', val)) out.slug = val;
      } else if (beforeSnapshot && beforeSnapshot.slug !== undefined && data.slug === undefined) {
        out.slug = deleteField();
        deletedKeys.push('slug');
      }
      if (data.status !== undefined) {
        const val = normalizeTenantStatus(data.status);
        if (hasChanged('status', val)) out.status = val;
      }
      if (data.planCode !== undefined) {
        const val = normalizePlanCode(data.planCode);
        if (hasChanged('planCode', val)) out.planCode = val;
      }
      if (data.deploymentMode !== undefined) {
        const val =
          data.deploymentMode === 'dedicated_enterprise'
            ? 'dedicated_enterprise'
            : data.deploymentMode === 'shared'
              ? 'shared'
              : 'shared_cloud';
        if (hasChanged('deploymentMode', val)) out.deploymentMode = val;
      }
      for (const optKey of ['supportEmail', 'country', 'currency'] as const) {
        if (data[optKey] !== undefined && String(data[optKey]).trim() !== '') {
          const maxLen = optKey === 'supportEmail' ? 180 : optKey === 'country' ? 80 : 12;
          const val = String(data[optKey]).trim().slice(0, maxLen);
          if (hasChanged(optKey, val)) out[optKey] = val;
        } else if (beforeSnapshot && beforeSnapshot[optKey] !== undefined && data[optKey] === undefined) {
          out[optKey] = deleteField();
          deletedKeys.push(optKey);
        }
      }
      return { patch: out, deletedKeys };
    }
    case 'subscription_tx': {
      // Payments rule strictly restricts affectedKeys() to ['status', 'updatedAt']
      if (collectionName === 'payments') {
        const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
        if (data.status !== undefined && String(data.status).trim()) {
          const nextStatus = String(data.status).trim().slice(0, 48);
          if (hasChanged('status', nextStatus)) out.status = nextStatus;
        }
        return { patch: out, deletedKeys };
      }
      const allowed = ['planCode', 'billingCycle', 'status', 'amountGhs', 'reference'];
      const optionalDeletable = new Set(['planCode', 'billingCycle', 'amountGhs', 'reference']);
      const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
      for (const k of allowed) {
        if (data[k] !== undefined && data[k] !== '') {
          const nextVal = k === 'amountGhs' ? Math.max(0, Number(data[k]) || 0) : data[k];
          if (hasChanged(k, nextVal)) out[k] = nextVal;
        } else if (beforeSnapshot && beforeSnapshot[k] !== undefined && optionalDeletable.has(k)) {
          out[k] = deleteField();
          deletedKeys.push(k);
        }
      }
      return { patch: out, deletedKeys };
    }
    case 'membership': {
      const allowed = ['role', 'status', 'orgAccessMode', 'allowedOrgIds'];
      const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
      for (const k of allowed) {
        if (data[k] !== undefined) {
          if (hasChanged(k, data[k])) out[k] = data[k];
        } else if (k === 'allowedOrgIds' && beforeSnapshot?.allowedOrgIds !== undefined) {
          out.allowedOrgIds = deleteField();
          deletedKeys.push('allowedOrgIds');
        }
      }
      return { patch: out, deletedKeys };
    }
    case 'user_public': {
      const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
      if (typeof data.displayName === 'string' && data.displayName.trim()) {
        const val = data.displayName.trim().slice(0, 120);
        if (hasChanged('displayName', val)) out.displayName = val;
      }
      if (typeof data.department === 'string' && data.department.trim()) {
        const val = data.department.trim().slice(0, 120);
        if (hasChanged('department', val)) out.department = val;
      } else if (beforeSnapshot?.department !== undefined && (data.department === undefined || data.department === '')) {
        out.department = deleteField();
        deletedKeys.push('department');
      }
      return { patch: out, deletedKeys };
    }
    case 'tenant_scoped': {
      const out: Record<string, unknown> = {
        updatedBy: sanitizeFirestoreId(uid, 'admin'),
        updatedAt: serverTimestamp(),
      };
      if (typeof data.title === 'string' && data.title.trim()) {
        const val = data.title.trim().slice(0, 240);
        if (hasChanged('title', val)) out.title = val;
      } else if (beforeSnapshot?.title !== undefined && (data.title === undefined || data.title === '')) {
        out.title = deleteField();
        deletedKeys.push('title');
      }
      if (typeof data.category === 'string' && data.category.trim()) {
        const val = data.category.trim().slice(0, 80);
        if (hasChanged('category', val)) out.category = val;
      } else if (beforeSnapshot?.category !== undefined && (data.category === undefined || data.category === '')) {
        out.category = deleteField();
        deletedKeys.push('category');
      }
      if (typeof data.priority === 'string' && data.priority.trim()) {
        const val = data.priority.trim().slice(0, 32);
        if (hasChanged('priority', val)) out.priority = val;
      } else if (beforeSnapshot?.priority !== undefined && (data.priority === undefined || data.priority === '')) {
        out.priority = deleteField();
        deletedKeys.push('priority');
      }
      if (typeof data.status === 'string' && data.status.trim()) {
        const val = data.status.trim().slice(0, 64);
        if (hasChanged('status', val)) out.status = val;
      }
      if (data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)) {
        if (hasChanged('payload', data.payload)) out.payload = data.payload;
      } else if (beforeSnapshot?.payload !== undefined && data.payload === undefined) {
        out.payload = deleteField();
        deletedKeys.push('payload');
      }
      if (Array.isArray(data.tags)) {
        const cleanTags = data.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 10);
        if (hasChanged('tags', cleanTags)) out.tags = cleanTags;
      } else if (beforeSnapshot?.tags !== undefined && data.tags === undefined) {
        out.tags = deleteField();
        deletedKeys.push('tags');
      }
      return { patch: out, deletedKeys };
    }
    default: {
      const out: Record<string, unknown> = { ...data, updatedAt: serverTimestamp() };
      if (beforeSnapshot) {
        for (const prevKey of Object.keys(beforeSnapshot)) {
          if (
            prevKey !== 'id' &&
            prevKey !== 'createdAt' &&
            prevKey !== 'updatedAt' &&
            prevKey !== 'createdBy' &&
            data[prevKey] === undefined
          ) {
            out[prevKey] = deleteField();
            deletedKeys.push(prevKey);
          }
        }
      }
      return { patch: out, deletedKeys };
    }
  }
}

function buildCreatePayloadForKind(
  collectionName: string,
  kind: FirestoreCollectionKind,
  docId: string,
  raw: Record<string, unknown>,
  uid: string
): Record<string, unknown> {
  const safeUid = sanitizeFirestoreId(uid, 'admin');
  const data = stripUndefinedDeep(stripReadOnlyInputFields(raw));

  switch (kind) {
    case 'plan':
      return stripUndefinedDeep({
        id: docId,
        code: normalizePlanCode(data.code || docId),
        name: String(data.name || 'Plan').trim().slice(0, 80) || 'Plan',
        ...(data.description ? { description: String(data.description) } : {}),
        ...(data.tagline !== undefined ? { tagline: String(data.tagline).slice(0, 240) } : {}),
        monthlyPriceGhs: Math.max(0, Number(data.monthlyPriceGhs ?? 0) || 0),
        annualPriceGhs: Math.max(0, Number(data.annualPriceGhs ?? 0) || 0),
        isPublic: data.isPublic !== false,
        ...(data.isCustomAnnual !== undefined ? { isCustomAnnual: Boolean(data.isCustomAnnual) } : {}),
        ...(data.limits ? { limits: data.limits } : {}),
        ...(Array.isArray(data.features) ? { features: data.features } : {}),
        createdBy: safeUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    case 'tenant':
      return stripUndefinedDeep({
        id: docId,
        name: String(data.name || 'Workspace').trim().slice(0, 160) || 'Workspace',
        ...(typeof data.slug === 'string' && data.slug.trim().length >= 2
          ? { slug: data.slug.trim().slice(0, 160) }
          : {}),
        type: data.type === 'msp' ? 'msp' : 'company',
        status: normalizeTenantStatus(data.status),
        ownerUid: sanitizeFirestoreId(String(data.ownerUid || safeUid), 'usr'),
        planCode: normalizePlanCode(data.planCode),
        deploymentMode:
          data.deploymentMode === 'dedicated_enterprise'
            ? 'dedicated_enterprise'
            : data.deploymentMode === 'shared'
              ? 'shared'
              : 'shared_cloud',
        ...(typeof data.supportEmail === 'string' && data.supportEmail.trim()
          ? { supportEmail: data.supportEmail.trim().slice(0, 180) }
          : {}),
        ...(typeof data.country === 'string' && data.country.trim()
          ? { country: data.country.trim().slice(0, 80) }
          : {}),
        ...(typeof data.currency === 'string' && data.currency.trim()
          ? { currency: data.currency.trim().slice(0, 12) }
          : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    case 'subscription_tx':
      return stripUndefinedDeep({
        id: docId,
        tenantId: sanitizeFirestoreId(String(data.tenantId || 'ten-default-01'), 'ten'),
        ...(data.planCode ? { planCode: String(data.planCode) } : {}),
        ...(data.billingCycle ? { billingCycle: String(data.billingCycle) } : {}),
        status: String(data.status || 'active').trim().slice(0, 48) || 'active',
        ...(data.amountGhs !== undefined ? { amountGhs: Math.max(0, Number(data.amountGhs) || 0) } : {}),
        ...(typeof data.reference === 'string' && data.reference.trim()
          ? { reference: data.reference.trim().slice(0, 128) }
          : {}),
        createdBy: sanitizeFirestoreId(String(data.createdBy || safeUid), 'usr'),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    case 'membership': {
      const memberUid = sanitizeFirestoreId(String(data.uid || safeUid), 'usr');
      const tenantId = sanitizeFirestoreId(String(data.tenantId || 'ten-default-01'), 'ten');
      const targetId =
        collectionName === 'userMemberships' ? `${memberUid}_${tenantId}` : docId;
      return stripUndefinedDeep({
        id: targetId,
        uid: memberUid,
        tenantId,
        role: String(data.role || 'tenant_admin'),
        status: ['active', 'invited', 'suspended'].includes(String(data.status))
          ? String(data.status)
          : 'active',
        orgAccessMode: data.orgAccessMode === 'selected' ? 'selected' : 'all',
        ...(Array.isArray(data.allowedOrgIds)
          ? { allowedOrgIds: data.allowedOrgIds.slice(0, 50) }
          : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    case 'user_public': {
      const out: Record<string, unknown> = {
        uid: docId,
        displayName: String(data.displayName || 'User').trim().slice(0, 120) || 'User',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (typeof data.department === 'string' && data.department.trim()) {
        out.department = data.department.trim().slice(0, 120);
      }
      return out;
    }
    case 'tenant_scoped': {
      const out: Record<string, unknown> = {
        id: docId,
        tenantId: sanitizeFirestoreId(String(data.tenantId || 'ten-default-01'), 'ten'),
        orgId: sanitizeFirestoreId(String(data.orgId || 'org-default-01'), 'org'),
        status: String(data.status || '').trim().slice(0, 64) || 'active',
        createdBy: safeUid,
        updatedBy: safeUid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (typeof data.title === 'string' && data.title.trim()) {
        out.title = data.title.trim().slice(0, 240);
      }
      if (typeof data.category === 'string' && data.category.trim()) {
        out.category = data.category.trim().slice(0, 80);
      }
      if (typeof data.priority === 'string' && data.priority.trim()) {
        out.priority = data.priority.trim().slice(0, 32);
      }
      if (data.payload && typeof data.payload === 'object' && !Array.isArray(data.payload)) {
        out.payload = stripUndefinedDeep(data.payload);
      }
      if (Array.isArray(data.tags) && data.tags.length > 0) {
        out.tags = data.tags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 10);
      }
      return out;
    }
    default:
      return stripUndefinedDeep({
        ...data,
        id: docId,
        updatedAt: serverTimestamp(),
      });
  }
}

export async function ensureTenantExistsInFirestore(
  tenantId: string,
  fallback?: {
    id: string;
    name?: string;
    type?: string;
    planCode?: string;
    status?: string;
  }
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const safeTid = sanitizeFirestoreId(tenantId, 'ten');
  const tenantRef = doc(db, 'tenants', safeTid);
  try {
    const snap = await getDoc(tenantRef);
    if (snap.exists()) return;
    const payload = buildCreatePayloadForKind(
      'tenants',
      'tenant',
      safeTid,
      {
        id: safeTid,
        name: fallback?.name || `Workspace ${safeTid}`,
        type: fallback?.type || 'company',
        status: fallback?.status || 'active',
        planCode: fallback?.planCode || 'professional',
        ownerUid: currentUser.uid,
        deploymentMode: 'shared_cloud',
      },
      currentUser.uid
    );
    await setDoc(tenantRef, payload as DocumentData);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `tenants/${safeTid}`);
  }
}

export async function saveFirestoreDocument(
  collectionName: string,
  rawDocId: string,
  payloadInput: Record<string, unknown>,
  mode: 'create' | 'edit',
  options?: {
    previousData?: Record<string, unknown>;
    auditReason?: string;
    skipAudit?: boolean;
    tenantFallback?: {
      id: string;
      name?: string;
      type?: string;
      planCode?: string;
      status?: string;
    };
  }
): Promise<{ docId: string; changedFields: FirestoreFieldDiff[]; auditLogId: string | null }> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error(
      'Connect your verified Firebase Super Admin Google account first to write to Cloud Firestore.'
    );
  }
  const meta = getFirestoreCollectionMeta(collectionName);
  const kind: FirestoreCollectionKind =
    meta?.kind ?? (collectionName.includes('/') ? 'platform_config' : 'tenant_scoped');

  const docId =
    collectionName === 'userMemberships' && mode === 'create'
      ? `${sanitizeFirestoreId(String(payloadInput.uid || currentUser.uid), 'usr')}_${sanitizeFirestoreId(String(payloadInput.tenantId || 'ten-default-01'), 'ten')}`
      : sanitizeFirestoreId(rawDocId, collectionName.slice(0, 3));

  const path = `${collectionName}/${docId}`;
  const docRef = resolveDocRef(collectionName, docId);

  let beforeSnapshot: Record<string, unknown> | null = options?.previousData ?? null;
  if (mode === 'edit' && !beforeSnapshot) {
    try {
      const prevSnap = await getDoc(docRef);
      if (prevSnap.exists()) {
        beforeSnapshot = serializeFirestoreValue(prevSnap.data()) as Record<string, unknown>;
      }
    } catch {
      // Proceed even if prior snapshot wasn't readable
    }
  }

  let writtenPayload: Record<string, unknown> = {};

  if (mode === 'create') {
    // Ensure parent tenant doc exists before creating tenant-scoped doc so exists() rules succeed
    if (
      kind === 'tenant_scoped' &&
      collectionName !== 'platformAuditLogs' &&
      !collectionName.includes('/')
    ) {
      await ensureTenantExistsInFirestore(
        String(payloadInput.tenantId || 'ten-default-01'),
        options?.tenantFallback
      );
    }

    try {
      const payload =
        meta || kind === 'tenant_scoped'
          ? buildCreatePayloadForKind(
              collectionName,
              kind,
              docId,
              payloadInput,
              currentUser.uid
            )
          : stripUndefinedDeep({
              ...stripReadOnlyInputFields(payloadInput),
              id: docId,
              createdBy: currentUser.uid,
              updatedBy: currentUser.uid,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
      writtenPayload = payload;
      await setDoc(docRef, payload as DocumentData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  } else {
    try {
      if (kind === 'platform_config') {
        const cleanInput = stripUndefinedDeep(stripReadOnlyInputFields(payloadInput));
        writtenPayload = { ...cleanInput, id: docId };

        if (beforeSnapshot) {
          const patch: Record<string, unknown> = {
            ...cleanInput,
            id: docId,
            updatedAt: serverTimestamp(),
          };
          for (const prevKey of Object.keys(beforeSnapshot)) {
            if (
              prevKey !== 'id' &&
              prevKey !== 'createdAt' &&
              prevKey !== 'updatedAt' &&
              prevKey !== 'createdBy' &&
              cleanInput[prevKey] === undefined
            ) {
              patch[prevKey] = deleteField();
            }
          }
          await updateDoc(docRef, patch as DocumentData);
        } else {
          await setDoc(
            docRef,
            { ...cleanInput, id: docId, updatedAt: serverTimestamp() },
            { merge: true }
          );
        }
      } else {
        // For tenant_scoped docs, funnel any non-envelope keys edited in the modal into payload
        const enrichedInput = stripUndefinedDeep({ ...payloadInput });
        if (kind === 'tenant_scoped') {
          const envelopeKeys = new Set([
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
          const existingPayload =
            enrichedInput.payload &&
            typeof enrichedInput.payload === 'object' &&
            !Array.isArray(enrichedInput.payload)
              ? { ...(enrichedInput.payload as Record<string, unknown>) }
              : {};
          for (const [k, v] of Object.entries(enrichedInput)) {
            if (!envelopeKeys.has(k)) {
              existingPayload[k] = v;
              delete enrichedInput[k];
            }
          }
          if (Object.keys(existingPayload).length > 0) {
            enrichedInput.payload = existingPayload;
          }
        }
        const { patch, deletedKeys } = buildUpdatePayloadForKind(
          kind,
          enrichedInput,
          currentUser.uid,
          collectionName,
          beforeSnapshot
        );
        const nextWritten: Record<string, unknown> = { ...(beforeSnapshot || {}) };
        for (const [k, v] of Object.entries(patch)) {
          if (k === 'updatedAt' || k === 'createdAt') continue;
          if (deletedKeys.includes(k)) {
            delete nextWritten[k];
          } else {
            nextWritten[k] = v;
          }
        }
        for (const dk of deletedKeys) {
          delete nextWritten[dk];
        }
        writtenPayload = nextWritten;
        await updateDoc(docRef, patch as DocumentData);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  }

  const changedFields = computeDocumentDiff(beforeSnapshot, writtenPayload);
  let auditLogId: string | null = null;

  if (!options?.skipAudit && collectionName !== 'platformAuditLogs') {
    const fieldNames = changedFields.map((c) => c.field);
    const tenantId = String(
      payloadInput.tenantId ??
        beforeSnapshot?.tenantId ??
        (collectionName === 'tenants' || collectionName === 'tenantRegistry'
          ? docId
          : 'platform')
    );
    const action = mode === 'create' ? 'CREATE' : 'UPDATE';
    const summary =
      mode === 'create'
        ? `Created document ${path} (${fieldNames.length} field${fieldNames.length === 1 ? '' : 's'})`
        : changedFields.length > 0
          ? `Edited ${changedFields.length} field${changedFields.length === 1 ? '' : 's'} on ${path}: ${fieldNames.slice(0, 6).join(', ')}${fieldNames.length > 6 ? '...' : ''}`
          : `Saved document ${path}`;

    auditLogId = await recordFirestoreAuditLog({
      action,
      collectionName,
      docId,
      tenantId,
      summary,
      reason: options?.auditReason,
      changedFields,
    });
  }

  return { docId, changedFields, auditLogId };
}

export async function removeFirestoreDocument(
  collectionName: string,
  docId: string,
  auditReason?: string
): Promise<string | null> {
  const path = `${collectionName}/${docId}`;
  const docRef = resolveDocRef(collectionName, docId);
  let beforeSnapshot: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      beforeSnapshot = serializeFirestoreValue(snap.data()) as Record<string, unknown>;
    }
  } catch {
    // Ignore pre-read error
  }

  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }

  if (collectionName === 'platformAuditLogs') return null;

  const tenantId = String(
    beforeSnapshot?.tenantId ??
      (collectionName === 'tenants' || collectionName === 'tenantRegistry'
        ? docId
        : 'platform')
  );
  return recordFirestoreAuditLog({
    action: 'DELETE',
    collectionName,
    docId,
    tenantId,
    summary: `Deleted document ${path}`,
    reason: auditReason,
    changedFields: beforeSnapshot
      ? computeDocumentDiff(beforeSnapshot, null).slice(0, 20)
      : [],
  });
}

export async function resetFirestoreCollection(
  collectionName: string,
  tenantId?: string
): Promise<number> {
  const meta = getFirestoreCollectionMeta(collectionName);
  if (meta && !meta.canReset) {
    throw new Error(
      meta.immutableNotice || `Collection "${collectionName}" cannot be reset directly.`
    );
  }
  try {
    let deleted = 0;
    for (let round = 0; round < 15; round++) {
      const docs = await fetchFirestoreDocuments(collectionName, tenantId, 400);
      if (docs.length === 0) break;

      const batch = writeBatch(db);
      for (const item of docs) {
        batch.delete(resolveDocRef(collectionName, item.docId));
        deleted++;
      }
      await batch.commit();
      if (docs.length < 400) break;
    }

    if (deleted > 0) {
      await recordFirestoreAuditLog({
        action: 'RESET',
        collectionName,
        docId: tenantId || 'all',
        tenantId: tenantId || 'platform',
        summary: `Reset Firestore collection "${collectionName}" (${deleted} doc${deleted === 1 ? '' : 's'} deleted${tenantId ? ` for ${tenantId}` : ''})`,
      });
    }

    return deleted;
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, collectionName);
  }
}

export async function deleteTenantFirestoreData(
  tenantId: string,
  options: { includeTenantDocs?: boolean } = {}
): Promise<{ deletedCount: number; skippedImmutable: string[] }> {
  const targetCols = FIRESTORE_COLLECTION_CATALOG.filter(
    (c) =>
      c.tenantScoped &&
      c.name !== 'tenants' &&
      c.name !== 'tenantRegistry' &&
      c.name !== 'usage'
  );

  let deletedCount = 0;
  const skippedImmutable: string[] = [];

  for (const col of targetCols) {
    if (!col.canDelete) {
      skippedImmutable.push(col.name);
      continue;
    }
    for (let round = 0; round < 15; round++) {
      const docs = await fetchFirestoreDocuments(col.name, tenantId, 400);
      if (docs.length === 0) break;
      const batch = writeBatch(db);
      for (const item of docs) {
        batch.delete(doc(db, col.name, item.docId));
        deletedCount++;
      }
      await batch.commit();
      if (docs.length < 400) break;
    }
  }

  // Always clean usage counter for this tenant if it exists
  try {
    const usageRef = doc(db, 'usage', tenantId);
    const usageSnap = await getDoc(usageRef);
    if (usageSnap.exists()) {
      await deleteDoc(usageRef);
      deletedCount++;
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `usage/${tenantId}`);
  }

  if (options.includeTenantDocs) {
    // Delete tenants/{tenantId}/config/* subcollection docs before removing root tenant doc
    try {
      const configPath = `tenants/${tenantId}/config`;
      const configDocs = await fetchFirestoreDocuments(configPath, undefined, 400);
      if (configDocs.length > 0) {
        const batch = writeBatch(db);
        for (const item of configDocs) {
          batch.delete(resolveDocRef(configPath, item.docId));
          deletedCount++;
        }
        await batch.commit();
      }
    } catch {
      // Ignore if no config subcollection exists
    }

    for (const rootCol of ['tenants', 'tenantRegistry'] as const) {
      try {
        const ref = doc(db, rootCol, tenantId);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          await deleteDoc(ref);
          deletedCount++;
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, `${rootCol}/${tenantId}`);
      }
    }
  }

  await recordFirestoreAuditLog({
    action: 'TENANT_PURGE',
    collectionName: 'tenants',
    docId: tenantId,
    tenantId,
    summary: `Purged ${deletedCount} Firestore doc(s) for tenant ${tenantId}${options.includeTenantDocs ? ' (including root tenant docs)' : ''}`,
  });

  return { deletedCount, skippedImmutable };
}

interface SyncWriteEntry {
  collection: string;
  docId: string;
  kind: FirestoreCollectionKind;
  rawData: Record<string, unknown>;
}

function normalizeTenantScopedEntry(
  collection: string,
  raw: Record<string, unknown>,
  fields: {
    id: string;
    tenantId: string;
    orgId: string;
    title?: string;
    category?: string;
    priority?: string;
    status: string;
    tags?: string[];
  }
): SyncWriteEntry {
  const payload = stripUndefinedDeep({ ...raw });
  delete payload._id;
  delete payload.password_hash;

  const cleanTitle = typeof fields.title === 'string' ? fields.title.trim().slice(0, 240) : '';
  const cleanCategory = typeof fields.category === 'string' ? fields.category.trim().slice(0, 80) : '';
  const cleanPriority = typeof fields.priority === 'string' ? fields.priority.trim().slice(0, 32) : '';
  const cleanStatus = String(fields.status ?? '').trim().slice(0, 64) || 'active';

  return {
    collection,
    docId: sanitizeFirestoreId(fields.id, collection.slice(0, 3)),
    kind: 'tenant_scoped',
    rawData: stripUndefinedDeep({
      id: sanitizeFirestoreId(fields.id, collection.slice(0, 3)),
      tenantId: sanitizeFirestoreId(fields.tenantId || 'ten-default-01', 'ten'),
      orgId: sanitizeFirestoreId(fields.orgId || 'org-default-01', 'org'),
      ...(cleanTitle ? { title: cleanTitle } : {}),
      ...(cleanCategory ? { category: cleanCategory } : {}),
      ...(cleanPriority ? { priority: cleanPriority } : {}),
      status: cleanStatus,
      payload,
      ...(fields.tags && fields.tags.length > 0 ? { tags: fields.tags.slice(0, 10) } : {}),
    }),
  };
}

export async function syncSnapshotToFirestore(
  snapshot: PlatformDbSnapshot,
  options?: { onlyCollection?: string; pruneStale?: boolean; tenantScope?: string }
): Promise<{ syncedCount: number; prunedCount: number; collectionsTouched: string[] }> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) {
    throw new Error(
      'Please connect your verified Firebase Super Admin Google account before syncing to Cloud Firestore.'
    );
  }
  const uid = sanitizeFirestoreId(currentUser.uid, 'admin');
  const only = options?.onlyCollection;

  // Stage 1: Foundation records (must exist before tenant-scoped records pass exists() checks)
  const foundationEntries: SyncWriteEntry[] = [];

  if (!only || only === 'plans') {
    for (const plan of snapshot.plans) {
      foundationEntries.push({
        collection: 'plans',
        docId: sanitizeFirestoreId(plan.id || plan.code, 'plan'),
        kind: 'plan',
        rawData: stripUndefinedDeep({
          id: sanitizeFirestoreId(plan.id || plan.code, 'plan'),
          code: normalizePlanCode(plan.code),
          name: plan.name,
          tagline: plan.tagline ?? '',
          monthlyPriceGhs: plan.monthlyPriceGhs,
          annualPriceGhs: plan.annualPriceGhs,
          isPublic: plan.isPublic,
          isCustomAnnual: Boolean(plan.isCustomAnnual),
          limits: plan.limits,
          features: plan.features,
        }),
      });
    }
  }

  if (!only || only === 'platformSettings') {
    foundationEntries.push({
      collection: 'platformSettings',
      docId: 'global',
      kind: 'platform_config',
      rawData: stripUndefinedDeep({ id: 'global', ...snapshot.platformSettings }),
    });
  }

  // Ensure tenants exist if syncing tenants OR any tenant-scoped collection
  const knownTenantIds = new Set(
    snapshot.tenants.map((t) => sanitizeFirestoreId(t.id, 'ten'))
  );
  const fallbackTenantId = snapshot.tenants[0]
    ? sanitizeFirestoreId(snapshot.tenants[0].id, 'ten')
    : 'ten-default-01';

  const needsTenantsForScoped = Boolean(only && CATALOG_MAP.get(only)?.tenantScoped);
  if (!only || only === 'tenants' || only === 'tenantRegistry' || needsTenantsForScoped) {
    for (const t of snapshot.tenants) {
      const tenantData = stripUndefinedDeep({
        id: sanitizeFirestoreId(t.id, 'ten'),
        name: t.name,
        ...(t.slug ? { slug: t.slug } : {}),
        type: t.type === 'msp' ? 'msp' : 'company',
        status: normalizeTenantStatus(t.status),
        ownerUid: sanitizeFirestoreId(t.ownerUserId || uid, 'usr'),
        planCode: normalizePlanCode(t.planCode),
        deploymentMode:
          t.deploymentMode === 'dedicated_enterprise'
            ? 'dedicated_enterprise'
            : 'shared_cloud',
        ...(t.supportEmail ? { supportEmail: t.supportEmail } : {}),
        ...(t.country ? { country: t.country } : {}),
        ...(t.currency ? { currency: t.currency } : {}),
      });
      if (!only || only === 'tenants' || needsTenantsForScoped) {
        foundationEntries.push({
          collection: 'tenants',
          docId: tenantData.id,
          kind: 'tenant',
          rawData: tenantData,
        });
      }
      if (!only || only === 'tenantRegistry') {
        foundationEntries.push({
          collection: 'tenantRegistry',
          docId: tenantData.id,
          kind: 'tenant',
          rawData: tenantData,
        });
      }
    }
  }

  if (!only || only === 'users') {
    for (const u of snapshot.users) {
      foundationEntries.push({
        collection: 'users',
        docId: sanitizeFirestoreId(u.id, 'usr'),
        kind: 'user_public',
        rawData: stripUndefinedDeep({
          uid: sanitizeFirestoreId(u.id, 'usr'),
          displayName: u.name || u.email || 'User',
          department: u.department || 'IT Operations',
        }),
      });
    }
  }

  // Stage 2: Tenant-scoped & operational records
  const operationalEntries: SyncWriteEntry[] = [];
  const shouldInclude = (name: string) => !only || only === name;

  if (shouldInclude('clientOrganisations')) {
    for (const o of snapshot.clientOrganisations) {
      operationalEntries.push(
        normalizeTenantScopedEntry('clientOrganisations', o as unknown as Record<string, unknown>, {
          id: o.id,
          tenantId: o.tenantId,
          orgId: o.id,
          title: o.name,
          category: o.industry,
          status: o.status,
        })
      );
    }
  }
  if (shouldInclude('locations')) {
    for (const l of snapshot.locations) {
      operationalEntries.push(
        normalizeTenantScopedEntry('locations', l as unknown as Record<string, unknown>, {
          id: l.id,
          tenantId: l.tenantId,
          orgId: l.orgId,
          title: l.name,
          category: l.city || l.code,
          status: l.status || 'active',
        })
      );
    }
  }
  if (shouldInclude('departments')) {
    for (const d of snapshot.departments) {
      operationalEntries.push(
        normalizeTenantScopedEntry('departments', d as unknown as Record<string, unknown>, {
          id: d.id,
          tenantId: d.tenantId,
          orgId: d.orgId,
          title: d.name,
          status: 'active',
        })
      );
    }
  }
  if (shouldInclude('members') || shouldInclude('userMemberships')) {
    for (const m of snapshot.memberships) {
      const mUid = sanitizeFirestoreId(String(m.userId || uid), 'usr');
      const mTenantId = sanitizeFirestoreId(String(m.tenantId || 'ten-default-01'), 'ten');
      const mData = {
        id: sanitizeFirestoreId(String(m.id || `${mUid}_${mTenantId}`), 'mbr'),
        uid: mUid,
        tenantId: mTenantId,
        role: String(m.role || 'tenant_admin'),
        status: String(m.status || 'active'),
        orgAccessMode: m.orgAccessMode === 'selected' ? 'selected' : 'all',
        allowedOrgIds: Array.isArray(m.allowedOrgIds) ? m.allowedOrgIds : [],
      };
      if (shouldInclude('members')) {
        operationalEntries.push({
          collection: 'members',
          docId: mData.id,
          kind: 'membership',
          rawData: mData,
        });
      }
      if (shouldInclude('userMemberships')) {
        const umId = `${mUid}_${mTenantId}`;
        operationalEntries.push({
          collection: 'userMemberships',
          docId: umId,
          kind: 'membership',
          rawData: { ...mData, id: umId },
        });
      }
    }
  }
  if (shouldInclude('subscriptions')) {
    for (const s of snapshot.subscriptions) {
      operationalEntries.push({
        collection: 'subscriptions',
        docId: sanitizeFirestoreId(s.id, 'sub'),
        kind: 'subscription_tx',
        rawData: {
          id: sanitizeFirestoreId(s.id, 'sub'),
          tenantId: s.tenantId,
          planCode: s.planCode,
          billingCycle: s.billingCycle,
          status: s.status,
          amountGhs: s.amountGhs,
          createdBy: uid,
        },
      });
    }
  }
  if (shouldInclude('payments')) {
    for (const p of snapshot.payments) {
      operationalEntries.push({
        collection: 'payments',
        docId: sanitizeFirestoreId(p.id, 'pay'),
        kind: 'subscription_tx',
        rawData: {
          id: sanitizeFirestoreId(p.id, 'pay'),
          tenantId: p.tenantId,
          planCode: p.planCode,
          billingCycle: p.billingCycle,
          status: p.status,
          amountGhs: p.amountGhs,
          reference: p.reference,
          createdBy: p.createdBy || uid,
        },
      });
    }
  }
  if (shouldInclude('invoices')) {
    for (const inv of snapshot.invoices) {
      operationalEntries.push({
        collection: 'invoices',
        docId: sanitizeFirestoreId(inv.id, 'inv'),
        kind: 'subscription_tx',
        rawData: {
          id: sanitizeFirestoreId(inv.id, 'inv'),
          tenantId: inv.tenantId,
          billingCycle: inv.billingCycle,
          status: inv.status,
          amountGhs: inv.amountGhs,
          reference: inv.invoiceNumber,
          createdBy: uid,
        },
      });
    }
  }
  if (shouldInclude('usage')) {
    for (const t of snapshot.tenants) {
      const tid = sanitizeFirestoreId(t.id, 'ten');
      operationalEntries.push({
        collection: 'usage',
        docId: tid,
        kind: 'platform_config',
        rawData: {
          tenantId: tid,
          assetsCount: snapshot.assets.filter((a) => (a.tenant_id || 'ten-default-01') === t.id).length,
          employeesCount: snapshot.employees.filter((e) => (e.tenant_id || 'ten-default-01') === t.id).length,
          ticketsCount: snapshot.tickets.filter((tk) => tk.tenantId === t.id).length,
          orgsCount: snapshot.clientOrganisations.filter((o) => o.tenantId === t.id).length,
        },
      });
    }
  }
  if (shouldInclude('employees')) {
    for (const e of snapshot.employees) {
      operationalEntries.push(
        normalizeTenantScopedEntry('employees', e as unknown as Record<string, unknown>, {
          id: e.id,
          tenantId: e.tenant_id || 'ten-default-01',
          orgId: e.org_id || 'org-default-01',
          title: e.full_name,
          category: e.department,
          status: e.status,
        })
      );
    }
  }
  if (shouldInclude('assets')) {
    for (const a of snapshot.assets) {
      operationalEntries.push(
        normalizeTenantScopedEntry('assets', a as unknown as Record<string, unknown>, {
          id: a.id,
          tenantId: a.tenant_id || 'ten-default-01',
          orgId: a.org_id || 'org-default-01',
          title: `${a.asset_tag} · ${a.name}`,
          category: a.category,
          status: a.status,
        })
      );
    }
  }
  if (shouldInclude('assetAssignments')) {
    for (const asg of snapshot.assignments) {
      operationalEntries.push(
        normalizeTenantScopedEntry('assetAssignments', asg as unknown as Record<string, unknown>, {
          id: asg.id,
          tenantId: asg.tenant_id || 'ten-default-01',
          orgId: asg.org_id || 'org-default-01',
          title: `Asset ${asg.asset_id} → Employee ${asg.employee_id}`,
          status: asg.status,
        })
      );
    }
  }
  if (shouldInclude('assetMaintenance')) {
    for (const m of snapshot.maintenance) {
      operationalEntries.push(
        normalizeTenantScopedEntry('assetMaintenance', m as unknown as Record<string, unknown>, {
          id: m.id,
          tenantId: m.tenant_id || 'ten-default-01',
          orgId: m.org_id || 'org-default-01',
          title: m.issue_description,
          category: m.maintenance_type,
          status: m.status,
        })
      );
    }
  }
  if (shouldInclude('assetTransfers')) {
    for (const tr of snapshot.assetTransfers) {
      operationalEntries.push(
        normalizeTenantScopedEntry('assetTransfers', tr as unknown as Record<string, unknown>, {
          id: tr.id,
          tenantId: tr.tenantId,
          orgId: tr.orgId,
          title: `${tr.assetTag} ${tr.fromLocation} → ${tr.toLocation}`,
          status: 'Completed',
        })
      );
    }
  }
  if (shouldInclude('softwareLicences')) {
    for (const lic of snapshot.softwareLicences) {
      operationalEntries.push(
        normalizeTenantScopedEntry('softwareLicences', lic as unknown as Record<string, unknown>, {
          id: lic.id,
          tenantId: lic.tenantId,
          orgId: lic.orgId,
          title: lic.softwareName,
          category: lic.vendor,
          status: lic.status,
        })
      );
    }
  }
  if (shouldInclude('vendors')) {
    for (const v of snapshot.vendors) {
      operationalEntries.push(
        normalizeTenantScopedEntry('vendors', v as unknown as Record<string, unknown>, {
          id: v.id,
          tenantId: v.tenantId,
          orgId: v.orgId,
          title: v.name,
          category: v.category,
          status: v.status,
        })
      );
    }
  }
  if (shouldInclude('purchaseRequests')) {
    for (const pr of snapshot.purchaseRequests) {
      operationalEntries.push(
        normalizeTenantScopedEntry('purchaseRequests', pr as unknown as Record<string, unknown>, {
          id: pr.id,
          tenantId: pr.tenantId,
          orgId: pr.orgId,
          title: `${pr.requestNumber} · ${pr.title}`,
          category: pr.category,
          status: pr.status,
        })
      );
    }
  }
  if (shouldInclude('purchaseOrders')) {
    for (const po of snapshot.purchaseOrders) {
      operationalEntries.push(
        normalizeTenantScopedEntry('purchaseOrders', po as unknown as Record<string, unknown>, {
          id: po.id,
          tenantId: po.tenantId,
          orgId: po.orgId,
          title: `${po.poNumber} · ${po.itemName}`,
          category: po.category,
          status: po.status,
        })
      );
    }
  }
  if (shouldInclude('tickets')) {
    for (const tk of snapshot.tickets) {
      operationalEntries.push(
        normalizeTenantScopedEntry('tickets', tk as unknown as Record<string, unknown>, {
          id: tk.id,
          tenantId: tk.tenantId,
          orgId: tk.orgId,
          title: `${tk.ticketNumber} · ${tk.subject}`,
          category: tk.category,
          priority: tk.priority,
          status: tk.status,
        })
      );
    }
  }
  if (shouldInclude('incidents')) {
    for (const inc of snapshot.incidents) {
      operationalEntries.push(
        normalizeTenantScopedEntry('incidents', inc as unknown as Record<string, unknown>, {
          id: inc.id,
          tenantId: inc.tenantId,
          orgId: inc.orgId,
          title: `${inc.incidentNumber} · ${inc.title}`,
          priority: inc.severity,
          status: inc.status,
        })
      );
    }
  }
  if (shouldInclude('problems')) {
    for (const p of snapshot.problems) {
      operationalEntries.push(
        normalizeTenantScopedEntry('problems', p as unknown as Record<string, unknown>, {
          id: p.id,
          tenantId: p.tenantId,
          orgId: p.orgId,
          title: `${p.problemNumber} · ${p.title}`,
          status: p.status,
        })
      );
    }
  }
  if (shouldInclude('changes')) {
    for (const ch of snapshot.changes) {
      operationalEntries.push(
        normalizeTenantScopedEntry('changes', ch as unknown as Record<string, unknown>, {
          id: ch.id,
          tenantId: ch.tenantId,
          orgId: ch.orgId,
          title: `${ch.changeNumber} · ${ch.title}`,
          category: ch.changeType,
          priority: ch.riskLevel,
          status: ch.status,
        })
      );
    }
  }
  if (shouldInclude('serviceCatalogue')) {
    for (const sc of snapshot.serviceCatalogue) {
      operationalEntries.push(
        normalizeTenantScopedEntry('serviceCatalogue', sc as unknown as Record<string, unknown>, {
          id: sc.id,
          tenantId: sc.tenantId,
          orgId: sc.orgId,
          title: sc.name,
          category: sc.category,
          status: 'Active',
        })
      );
    }
  }
  if (shouldInclude('serviceRequests')) {
    for (const sr of snapshot.serviceRequests) {
      operationalEntries.push(
        normalizeTenantScopedEntry('serviceRequests', sr as unknown as Record<string, unknown>, {
          id: sr.id,
          tenantId: sr.tenantId,
          orgId: sr.orgId,
          title: `${sr.requestNumber} · ${sr.itemName}`,
          status: sr.status,
        })
      );
    }
  }
  if (shouldInclude('slaPolicies')) {
    for (const sla of snapshot.slaPolicies) {
      operationalEntries.push(
        normalizeTenantScopedEntry('slaPolicies', sla as unknown as Record<string, unknown>, {
          id: sla.id,
          tenantId: sla.tenantId,
          orgId: sla.orgId,
          title: sla.name,
          priority: sla.priority,
          status: 'Active',
        })
      );
    }
  }
  if (shouldInclude('contracts')) {
    for (const ct of snapshot.contracts) {
      operationalEntries.push(
        normalizeTenantScopedEntry('contracts', ct as unknown as Record<string, unknown>, {
          id: ct.id,
          tenantId: ct.tenantId,
          orgId: ct.orgId,
          title: `${ct.contractNumber} · ${ct.title}`,
          category: ct.contractType,
          status: ct.status,
        })
      );
    }
  }
  if (shouldInclude('knowledgeArticles')) {
    for (const kb of snapshot.knowledgeArticles) {
      operationalEntries.push(
        normalizeTenantScopedEntry('knowledgeArticles', kb as unknown as Record<string, unknown>, {
          id: kb.id,
          tenantId: kb.tenantId,
          orgId: kb.orgId,
          title: kb.title,
          category: kb.category,
          status: kb.visibility,
          tags: kb.tags,
        })
      );
    }
  }
  if (shouldInclude('customFields')) {
    for (const cf of snapshot.customFields) {
      operationalEntries.push(
        normalizeTenantScopedEntry('customFields', cf as unknown as Record<string, unknown>, {
          id: cf.id,
          tenantId: cf.tenantId,
          orgId: 'org-default-01',
          title: cf.label,
          category: cf.entityType,
          status: cf.fieldType,
        })
      );
    }
  }
  if (shouldInclude('auditLogs')) {
    const knownTenantIds = new Set(snapshot.tenants.map((t) => sanitizeFirestoreId(t.id, 'ten')));
    const fallbackTid = snapshot.tenants[0]
      ? sanitizeFirestoreId(snapshot.tenants[0].id, 'ten')
      : 'ten-default-01';
    for (const al of snapshot.auditLogs) {
      const candidateTid = sanitizeFirestoreId(al.tenantId || fallbackTid, 'ten');
      const resolvedTid = knownTenantIds.has(candidateTid) ? candidateTid : fallbackTid;
      operationalEntries.push(
        normalizeTenantScopedEntry('auditLogs', al as unknown as Record<string, unknown>, {
          id: al.id,
          tenantId: resolvedTid,
          orgId: al.orgId || 'org-default-01',
          title: `${al.action} · ${al.summary}`,
          category: al.entityType,
          status: 'Recorded',
        })
      );
    }
  }
  if (shouldInclude('platformAuditLogs')) {
    const defaultTenant = snapshot.tenants[0]?.id || 'ten-default-01';
    for (const pal of snapshot.platformAuditLogs) {
      operationalEntries.push(
        normalizeTenantScopedEntry(
          'platformAuditLogs',
          pal as unknown as Record<string, unknown>,
          {
            id: pal.id,
            tenantId: defaultTenant,
            orgId: 'platform',
            title: `${pal.action} · ${pal.summary}`,
            category: pal.entityType,
            status: 'Recorded',
          }
        )
      );
    }
  }

  // Filter out orphaned tenant_scoped entries whose tenant doesn't exist in snapshot.tenants
  // so Firestore exists(/tenants/$(tenantId)) rules never reject valid batches.
  const validOperationalEntries = operationalEntries.filter((entry) => {
    if (entry.kind !== 'tenant_scoped' || entry.collection === 'platformAuditLogs') {
      return true;
    }
    const tid = String(entry.rawData.tenantId || '');
    if (knownTenantIds.size > 0 && !knownTenantIds.has(tid)) {
      return false;
    }
    if (knownTenantIds.size === 0 && !tid) {
      entry.rawData.tenantId = fallbackTenantId;
    }
    return true;
  });

  let syncedCount = 0;
  let prunedCount = 0;
  const touched = new Set<string>();

  // Pre-fetch existing docs per touched collection in parallel (1 query per collection instead of 1 getDoc per doc)
  const collectionsToPrefetch = new Set<string>();
  for (const entry of [...foundationEntries, ...validOperationalEntries]) {
    collectionsToPrefetch.add(entry.collection);
  }

  const expectedIdsByCollection = new Map<string, Set<string>>();
  if (options?.pruneStale) {
    for (const entry of [...foundationEntries, ...validOperationalEntries]) {
      if (only && entry.collection !== only) continue;
      let set = expectedIdsByCollection.get(entry.collection);
      if (!set) {
        set = new Set<string>();
        expectedIdsByCollection.set(entry.collection, set);
      }
      set.add(entry.docId);
    }

    if (only && !expectedIdsByCollection.has(only)) {
      expectedIdsByCollection.set(only, new Set<string>());
    } else if (!only && !options?.tenantScope) {
      for (const col of FIRESTORE_COLLECTION_CATALOG) {
        if (
          col.canDelete &&
          col.name !== 'users' &&
          col.name !== 'platformAdmins' &&
          col.name !== 'platform' &&
          col.name !== 'provisioningJobs' &&
          col.name !== 'assetCategories' &&
          col.name !== 'notifications' &&
          col.name !== 'integrations' &&
          !expectedIdsByCollection.has(col.name)
        ) {
          expectedIdsByCollection.set(col.name, new Set<string>());
        }
      }
    }

    for (const colName of expectedIdsByCollection.keys()) {
      const colMeta = CATALOG_MAP.get(colName);
      if (colMeta && colMeta.canDelete && (!options?.tenantScope || colMeta.tenantScoped)) {
        collectionsToPrefetch.add(colName);
      }
    }
  }

  const existingByCollection = new Map<string, Map<string, Record<string, unknown>>>();
  await Promise.all(
    Array.from(collectionsToPrefetch).map(async (colName) => {
      try {
        const rows = await fetchFirestoreDocuments(
          colName,
          options?.tenantScope || undefined,
          1000
        );
        existingByCollection.set(
          colName,
          new Map(rows.map((r) => [r.docId, r.data]))
        );
      } catch {
        existingByCollection.set(colName, new Map());
      }
    })
  );

  type PreparedOp =
    | {
        type: 'set';
        collection: string;
        docId: string;
        payload: Record<string, unknown>;
        merge?: boolean;
      }
    | {
        type: 'update';
        collection: string;
        docId: string;
        payload: Record<string, unknown>;
      };

  const commitBatchOps = async (ops: PreparedOp[]) => {
    const BATCH_LIMIT = 400;
    for (let i = 0; i < ops.length; i += BATCH_LIMIT) {
      const chunk = ops.slice(i, i + BATCH_LIMIT);
      const batch = writeBatch(db);
      for (const op of chunk) {
        const ref = doc(db, op.collection, op.docId);
        if (op.type === 'set') {
          if (op.merge) {
            batch.set(ref, op.payload as DocumentData, { merge: true });
          } else {
            batch.set(ref, op.payload as DocumentData);
          }
        } else {
          batch.update(ref, op.payload as DocumentData);
        }
      }
      try {
        await batch.commit();
        for (const op of chunk) {
          syncedCount++;
          touched.add(op.collection);
        }
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.WRITE,
          chunk[0] ? `${chunk[0].collection}/${chunk[0].docId}` : 'batch'
        );
      }
    }
  };

  const prepareOpsForEntries = (entries: SyncWriteEntry[]): PreparedOp[] => {
    const ops: PreparedOp[] = [];
    for (const entry of entries) {
      const colMap = existingByCollection.get(entry.collection);
      const existingSnapData = colMap?.get(entry.docId) ?? null;
      const colMeta = CATALOG_MAP.get(entry.collection);

      if (existingSnapData) {
        if (colMeta && !colMeta.canEdit) {
          continue;
        }
        if (entry.kind === 'platform_config') {
          const clean = stripUndefinedDeep(entry.rawData);
          const candidate = { ...clean, id: entry.docId };
          const hasAnyDiff = Object.entries(candidate).some(
            ([k, v]) => JSON.stringify(existingSnapData[k]) !== JSON.stringify(v)
          );
          if (!hasAnyDiff) continue;
          ops.push({
            type: 'set',
            collection: entry.collection,
            docId: entry.docId,
            payload: { ...candidate, updatedAt: serverTimestamp() },
            merge: true,
          });
        } else {
          const { patch, deletedKeys } = buildUpdatePayloadForKind(
            entry.kind,
            entry.rawData,
            uid,
            entry.collection,
            existingSnapData
          );
          const hasMeaningfulChange =
            deletedKeys.length > 0 ||
            Object.keys(patch).some((k) => k !== 'updatedAt' && k !== 'updatedBy');
          if (!hasMeaningfulChange) continue;
          ops.push({
            type: 'update',
            collection: entry.collection,
            docId: entry.docId,
            payload: patch,
          });
        }
      } else {
        const payload = buildCreatePayloadForKind(
          entry.collection,
          entry.kind,
          entry.docId,
          entry.rawData,
          uid
        );
        ops.push({
          type: 'set',
          collection: entry.collection,
          docId: entry.docId,
          payload,
          merge: false,
        });
      }
    }
    return ops;
  };

  // Commit Stage 1 (tenants/plans/settings/users) before Stage 2 so exists(/tenants/$(tid)) rules pass
  await commitBatchOps(prepareOpsForEntries(foundationEntries));
  await commitBatchOps(prepareOpsForEntries(validOperationalEntries));

  // Optional deletion reconciliation: remove stale Firestore docs no longer in snapshot
  if (options?.pruneStale) {
    for (const [colName, keepIds] of expectedIdsByCollection.entries()) {
      const colMeta = CATALOG_MAP.get(colName);
      if (!colMeta || !colMeta.canDelete) continue;
      if (options?.tenantScope && !colMeta.tenantScoped) continue;

      const existingMap = existingByCollection.get(colName);
      const staleIds = existingMap
        ? Array.from(existingMap.keys()).filter((id) => !keepIds.has(id))
        : (
            await fetchFirestoreDocuments(
              colName,
              options?.tenantScope || undefined,
              500
            )
          )
            .filter((d) => !keepIds.has(d.docId))
            .map((d) => d.docId);

      if (staleIds.length > 0) {
        for (let i = 0; i < staleIds.length; i += 400) {
          const chunk = staleIds.slice(i, i + 400);
          const batch = writeBatch(db);
          for (const docId of chunk) {
            batch.delete(doc(db, colName, docId));
            prunedCount++;
          }
          await batch.commit();
        }
        touched.add(colName);
      }
    }
  }

  if (syncedCount > 0 || prunedCount > 0) {
    await recordFirestoreAuditLog({
      action: 'SYNC',
      collectionName: options?.onlyCollection || 'all_collections',
      docId: options?.tenantScope || options?.onlyCollection || 'snapshot',
      tenantId: options?.tenantScope || 'platform',
      summary: `Synced ${syncedCount} doc(s)${prunedCount > 0 ? `, pruned ${prunedCount} deleted doc(s)` : ''} across ${touched.size} Firestore collection(s): ${Array.from(touched).slice(0, 6).join(', ')}${touched.size > 6 ? '...' : ''}`,
    });
  }

  return { syncedCount, prunedCount, collectionsTouched: Array.from(touched) };
}
