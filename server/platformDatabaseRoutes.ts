import crypto from 'node:crypto';
import type { Express, RequestHandler } from 'express';
import { hashPassword } from './auth.ts';
import type { TenantRequest } from './context.ts';
import type { ItamsDatabase } from './db.ts';
import { createDefaultPlans } from './entitlements.ts';
import { DEFAULT_TENANT_ID, type SaasState, type SaasStore } from './saasStore.ts';
import type { Asset, Employee, MaintenanceLog } from '../src/types/itams.ts';

export type DbCollectionCategory =
  | 'Core SaaS'
  | 'ITAM & Custody'
  | 'ITSM & Helpdesk'
  | 'Procurement & Vendors'
  | 'Governance & Logs';

export interface DbCollectionMeta {
  name: string;
  label: string;
  category: DbCollectionCategory;
  tenantScoped: boolean;
  tenantField: 'tenantId' | 'tenant_id' | 'id' | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReset: boolean;
}

export const DB_COLLECTIONS: DbCollectionMeta[] = [
  { name: 'tenants', label: 'Tenants', category: 'Core SaaS', tenantScoped: true, tenantField: 'id', canCreate: false, canEdit: true, canDelete: true, canReset: false },
  { name: 'clientOrganisations', label: 'Client Organisations', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'locations', label: 'Locations & Sites', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'departments', label: 'Departments', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'users', label: 'User Accounts', category: 'Core SaaS', tenantScoped: false, tenantField: null, canCreate: true, canEdit: true, canDelete: true, canReset: false },
  { name: 'memberships', label: 'Tenant Memberships', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'plans', label: 'Subscription Plans', category: 'Core SaaS', tenantScoped: false, tenantField: null, canCreate: false, canEdit: true, canDelete: false, canReset: true },
  { name: 'subscriptions', label: 'Tenant Subscriptions', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'payments', label: 'Payment Transactions', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'invoices', label: 'Billing Invoices', category: 'Core SaaS', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'assets', label: 'IT Assets', category: 'ITAM & Custody', tenantScoped: true, tenantField: 'tenant_id', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'employees', label: 'Employees', category: 'ITAM & Custody', tenantScoped: true, tenantField: 'tenant_id', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assignments', label: 'Asset Assignments', category: 'ITAM & Custody', tenantScoped: true, tenantField: 'tenant_id', canCreate: false, canEdit: true, canDelete: true, canReset: true },
  { name: 'maintenance', label: 'Maintenance Logs', category: 'ITAM & Custody', tenantScoped: true, tenantField: 'tenant_id', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'assetTransfers', label: 'Asset Transfers', category: 'ITAM & Custody', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'softwareLicences', label: 'Software Licences', category: 'ITAM & Custody', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'tickets', label: 'Helpdesk Tickets', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'incidents', label: 'Incidents', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'problems', label: 'Problems (KEDB)', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'changes', label: 'CAB Change Requests', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'serviceCatalogue', label: 'Service Catalogue', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'serviceRequests', label: 'Service Requests', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'slaPolicies', label: 'SLA Policies', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'contracts', label: 'Service Contracts', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'knowledgeArticles', label: 'Knowledge Base', category: 'ITSM & Helpdesk', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'vendors', label: 'Vendors', category: 'Procurement & Vendors', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'purchaseRequests', label: 'Purchase Requests', category: 'Procurement & Vendors', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'purchaseOrders', label: 'Purchase Orders', category: 'Procurement & Vendors', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },

  { name: 'customFields', label: 'Custom Fields', category: 'Governance & Logs', tenantScoped: true, tenantField: 'tenantId', canCreate: true, canEdit: true, canDelete: true, canReset: true },
  { name: 'attachments', label: 'Attachments', category: 'Governance & Logs', tenantScoped: true, tenantField: 'tenantId', canCreate: false, canEdit: false, canDelete: true, canReset: true },
  { name: 'auditLogs', label: 'Tenant Audit Logs', category: 'Governance & Logs', tenantScoped: true, tenantField: 'tenantId', canCreate: false, canEdit: false, canDelete: true, canReset: true },
  { name: 'platformAuditLogs', label: 'Platform Audit Logs', category: 'Governance & Logs', tenantScoped: false, tenantField: null, canCreate: false, canEdit: false, canDelete: true, canReset: true },
];

const COLLECTION_META_MAP = new Map<string, DbCollectionMeta>(
  DB_COLLECTIONS.map((c) => [c.name, c])
);

const STORE_ARRAY_COLLECTIONS = new Set<keyof SaasState>([
  'tenants',
  'clientOrganisations',
  'locations',
  'departments',
  'memberships',
  'plans',
  'subscriptions',
  'payments',
  'invoices',
  'assetTransfers',
  'softwareLicences',
  'vendors',
  'purchaseRequests',
  'purchaseOrders',
  'tickets',
  'incidents',
  'problems',
  'changes',
  'serviceCatalogue',
  'serviceRequests',
  'slaPolicies',
  'contracts',
  'knowledgeArticles',
  'customFields',
  'attachments',
  'auditLogs',
  'platformAuditLogs',
]);

function getRecordTenantId(rec: Record<string, unknown>, meta: DbCollectionMeta): string {
  if (!meta.tenantField) return '';
  return String(rec[meta.tenantField] ?? '');
}

async function listRecordsForCollection(
  collection: string,
  db: ItamsDatabase,
  store: SaasStore,
  tenantIdFilter?: string
): Promise<Array<Record<string, unknown>>> {
  const meta = COLLECTION_META_MAP.get(collection);
  if (!meta) return [];

  let rows: Array<Record<string, unknown>> = [];
  const scope = tenantIdFilter ? { tenantId: tenantIdFilter } : undefined;

  switch (collection) {
    case 'assets':
      rows = (await db.listAssets(scope)) as unknown as Array<Record<string, unknown>>;
      break;
    case 'employees':
      rows = (await db.listEmployees(scope)) as unknown as Array<Record<string, unknown>>;
      break;
    case 'assignments':
      rows = (await db.listAssignments(scope)) as unknown as Array<Record<string, unknown>>;
      break;
    case 'maintenance':
      rows = (await db.listMaintenanceLogs(scope)) as unknown as Array<Record<string, unknown>>;
      break;
    case 'users': {
      const users = await db.listUsers();
      if (tenantIdFilter) {
        const tenantUserIds = new Set(
          store.data.memberships
            .filter((m) => m.tenantId === tenantIdFilter)
            .map((m) => m.userId)
        );
        rows = users
          .filter((u) => tenantUserIds.has(u.id))
          .map((u) => ({ ...u }));
      } else {
        rows = users.map((u) => ({ ...u }));
      }
      break;
    }
    default: {
      if (STORE_ARRAY_COLLECTIONS.has(collection as keyof SaasState)) {
        const arr = store.data[collection as keyof SaasState] as unknown as Array<
          Record<string, unknown>
        >;
        rows = tenantIdFilter && meta.tenantField
          ? arr.filter((r) => String(r[meta.tenantField!] ?? '') === tenantIdFilter)
          : [...arr];
      }
      break;
    }
  }

  return rows;
}

async function purgeTenantCompletely(params: {
  tenantId: string;
  actorId: string;
  db: ItamsDatabase;
  store: SaasStore;
}): Promise<number> {
  const { tenantId, actorId, db, store } = params;
  let removedCount = 0;

  const [tAsgs, tMaint, tAssets, tEmps, allUsers] = await Promise.all([
    db.listAssignments({ tenantId }),
    db.listMaintenanceLogs({ tenantId }),
    db.listAssets({ tenantId }),
    db.listEmployees({ tenantId }),
    db.listUsers(),
  ]);

  for (const asg of tAsgs) {
    if (await db.deleteAssignment(asg.id)) removedCount++;
  }
  for (const m of tMaint) {
    if (await db.deleteMaintenanceLog(m.id)) removedCount++;
  }
  for (const a of tAssets) {
    if (await db.deleteAsset(a.id)) removedCount++;
  }
  for (const e of tEmps) {
    if (await db.deleteEmployee(e.id)) removedCount++;
  }

  const removedAssetIds = new Set(tAssets.map((a) => a.id));
  const removedMaintIds = new Set(tMaint.map((m) => m.id));
  const removedTicketIds = new Set(
    store.data.tickets.filter((t) => t.tenantId === tenantId).map((t) => t.id)
  );
  const affectedUserIds = Array.from(
    new Set(
      store.data.memberships
        .filter((m) => m.tenantId === tenantId)
        .map((m) => m.userId)
    )
  );

  await store.mutate((s) => {
    for (const meta of DB_COLLECTIONS) {
      if (!meta.tenantScoped || !meta.tenantField) continue;
      if (!STORE_ARRAY_COLLECTIONS.has(meta.name as keyof SaasState)) continue;
      const arr = s[meta.name as keyof SaasState] as unknown as Array<
        Record<string, unknown>
      >;
      const kept = arr.filter(
        (r) => String(r[meta.tenantField!] ?? '') !== tenantId
      );
      removedCount += arr.length - kept.length;
      (s[meta.name as keyof SaasState] as unknown) = kept;
    }
    s.invitations = s.invitations.filter((i) => i.tenantId !== tenantId);
    s.ticketComments = s.ticketComments.filter(
      (c) => !removedTicketIds.has(c.ticketId)
    );
    for (const aid of removedAssetIds) {
      delete s.assetMeta[aid];
      delete s.customFieldValues[aid];
    }
    for (const mid of removedMaintIds) {
      delete s.maintenanceMeta[mid];
    }
  });

  for (const uid of affectedUserIds) {
    if (uid === actorId) continue;
    const userRec = allUsers.find((u) => u.id === uid);
    if (!userRec || userRec.is_super_admin) continue;
    const hasOtherMembership = store.data.memberships.some((m) => m.userId === uid);
    if (!hasOtherMembership) {
      await db.deleteUser(uid);
    }
  }

  return removedCount;
}

export function registerPlatformDatabaseRoutes(params: {
  app: Express;
  db: ItamsDatabase;
  store: SaasStore;
  requireAuth: RequestHandler;
  requirePlatformSuperAdmin: RequestHandler;
}) {
  const { app, db, store, requireAuth, requirePlatformSuperAdmin } = params;

  // -------------------------------------------------------------------------
  // 1. Database Overview (Counts across all collections & optional tenant scope)
  // -------------------------------------------------------------------------
  app.get(
    '/api/platform/database/overview',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const tenantId = String(req.query.tenantId ?? '').trim() || undefined;
        const [assets, employees, assignments, maintenance, users] = await Promise.all([
          db.listAssets(tenantId ? { tenantId } : undefined),
          db.listEmployees(tenantId ? { tenantId } : undefined),
          db.listAssignments(tenantId ? { tenantId } : undefined),
          db.listMaintenanceLogs(tenantId ? { tenantId } : undefined),
          db.listUsers(),
        ]);

        const tenantUserIds = tenantId
          ? new Set(
              store.data.memberships
                .filter((m) => m.tenantId === tenantId)
                .map((m) => m.userId)
            )
          : null;

        const counts: Record<string, number> = {
          assets: assets.length,
          employees: employees.length,
          assignments: assignments.length,
          maintenance: maintenance.length,
          users: tenantUserIds
            ? users.filter((u) => tenantUserIds.has(u.id)).length
            : users.length,
        };

        for (const meta of DB_COLLECTIONS) {
          if (counts[meta.name] !== undefined) continue;
          if (STORE_ARRAY_COLLECTIONS.has(meta.name as keyof SaasState)) {
            const arr = store.data[meta.name as keyof SaasState] as unknown as Array<
              Record<string, unknown>
            >;
            counts[meta.name] =
              tenantId && meta.tenantField
                ? arr.filter((r) => String(r[meta.tenantField!] ?? '') === tenantId).length
                : arr.length;
          } else {
            counts[meta.name] = 0;
          }
        }

        res.json({
          engine: db.engine,
          collections: DB_COLLECTIONS.map((meta) => ({
            ...meta,
            count: counts[meta.name] ?? 0,
          })),
          tenants: store.data.tenants.map((t) => ({
            id: t.id,
            name: t.name,
            type: t.type,
            planCode: t.planCode,
            status: t.status,
          })),
        });
      } catch (err) {
        console.error('Platform database overview error:', err);
        res.status(500).json({ error: 'Failed to load database overview.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 2. List / Search Records in a Collection
  // -------------------------------------------------------------------------
  app.get(
    '/api/platform/database/records',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const collection = String(req.query.collection ?? 'assets').trim();
        const tenantId = String(req.query.tenantId ?? '').trim() || undefined;
        const q = String(req.query.q ?? '').trim().toLowerCase();
        const limitNum = Math.min(250, Math.max(1, Number(req.query.limit ?? 150) || 150));

        const meta = COLLECTION_META_MAP.get(collection);
        if (!meta) {
          res.status(400).json({ error: `Unsupported database collection "${collection}".` });
          return;
        }

        let rows = await listRecordsForCollection(collection, db, store, tenantId);
        if (q) {
          rows = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
        }

        res.json({
          collection,
          meta,
          totalCount: rows.length,
          records: rows.slice(0, limitNum),
        });
      } catch (err) {
        console.error('List platform database records error:', err);
        res.status(500).json({ error: 'Failed to read collection records.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 3. Create Record in Collection
  // -------------------------------------------------------------------------
  app.post(
    '/api/platform/database/records',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const collection = String(req.body?.collection ?? '').trim();
        const rawRecord = req.body?.record;
        const meta = COLLECTION_META_MAP.get(collection);
        if (!meta || !meta.canCreate) {
          res.status(400).json({
            error: `Creating records directly in "${collection}" is not supported.`,
          });
          return;
        }
        if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) {
          res.status(400).json({ error: 'Record payload must be a valid JSON object.' });
          return;
        }

        const input = { ...(rawRecord as Record<string, unknown>) };
        const now = new Date().toISOString();
        const actor = (req as TenantRequest).authUser!;
        const id =
          typeof input.id === 'string' && input.id.trim()
            ? input.id.trim()
            : `${collection.slice(0, 3).toLowerCase()}-${crypto.randomUUID().slice(0, 8)}`;

        let createdRecord: Record<string, unknown>;

        if (collection === 'assets') {
          const asset: Asset = {
            id,
            asset_tag: String(input.asset_tag || `AV-${crypto.randomUUID().slice(0, 6).toUpperCase()}`),
            name: String(input.name || 'New IT Asset'),
            category: (input.category as Asset['category']) || 'Laptop',
            brand: String(input.brand || 'Generic'),
            model: String(input.model || 'Standard'),
            serial_number: String(input.serial_number || `SN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`),
            purchase_date: String(input.purchase_date || now.slice(0, 10)),
            cost: Number(input.cost ?? 0),
            warranty_expiry: String(input.warranty_expiry || now.slice(0, 10)),
            status: (input.status as Asset['status']) || 'Available',
            assigned_employee_id: (input.assigned_employee_id as string | null) ?? null,
            assigned_date: (input.assigned_date as string | null) ?? null,
            location: String(input.location || 'Main Office'),
            notes: String(input.notes || ''),
            created_at: now,
            updated_at: now,
            tenant_id: String(input.tenant_id || DEFAULT_TENANT_ID),
            org_id: String(input.org_id || 'org-default-01'),
          };
          createdRecord = (await db.createAsset(asset)) as unknown as Record<string, unknown>;
        } else if (collection === 'employees') {
          const emp: Employee = {
            id,
            employee_code: String(input.employee_code || `EMP-${crypto.randomUUID().slice(0, 5).toUpperCase()}`),
            full_name: String(input.full_name || 'New Employee'),
            email: String(input.email || `staff.${crypto.randomUUID().slice(0, 5)}@company.test`),
            department: String(input.department || 'IT Infrastructure'),
            job_title: String(input.job_title || 'Staff Member'),
            phone: String(input.phone || ''),
            location: String(input.location || 'Main Office'),
            status: String(input.status || '').toLowerCase() === 'inactive' ? 'inactive' : 'active',
            created_at: now,
            tenant_id: String(input.tenant_id || DEFAULT_TENANT_ID),
            org_id: String(input.org_id || 'org-default-01'),
          };
          createdRecord = (await db.createEmployee(emp)) as unknown as Record<string, unknown>;
        } else if (collection === 'maintenance') {
          const log: MaintenanceLog = {
            id,
            asset_id: String(input.asset_id || ''),
            issue_description: String(input.issue_description || 'Preventive inspection'),
            maintenance_type:
              (input.maintenance_type as MaintenanceLog['maintenance_type']) || 'Preventive',
            vendor_or_technician: String(input.vendor_or_technician || 'Internal IT'),
            service_date: String(input.service_date || now.slice(0, 10)),
            next_service_date: (input.next_service_date as string | null) ?? null,
            cost: Number(input.cost ?? 0),
            status: (input.status as MaintenanceLog['status']) || 'Scheduled',
            recorded_by_user_id: String(input.recorded_by_user_id || actor.id),
            notes: String(input.notes || ''),
            created_at: now,
            tenant_id: String(input.tenant_id || DEFAULT_TENANT_ID),
            org_id: String(input.org_id || 'org-default-01'),
          };
          createdRecord = (await db.createMaintenanceLog(
            log,
            false
          )) as unknown as Record<string, unknown>;
        } else if (collection === 'users') {
          const email = String(input.email || '').trim().toLowerCase();
          if (!email) {
            res.status(400).json({ error: 'User email is required.' });
            return;
          }
          const existing = await db.findUserByEmail(email);
          if (existing) {
            res.status(409).json({ error: `A user with email "${email}" already exists.` });
            return;
          }
          const rawPass = String(input.password || 'AssetVault@2026');
          createdRecord = (await db.createUser({
            id,
            name: String(input.name || email.split('@')[0]),
            email,
            password_hash: hashPassword(rawPass),
            role: input.role === 'admin' ? 'admin' : 'staff',
            department: String(input.department || 'IT Operations'),
            status: (input.status as 'active' | 'inactive' | 'pending') || 'active',
            created_at: now,
            last_login: null,
            email_verified: input.email_verified !== false,
            mfa_enabled: Boolean(input.mfa_enabled),
            is_super_admin: Boolean(input.is_super_admin),
          })) as unknown as Record<string, unknown>;
        } else if (STORE_ARRAY_COLLECTIONS.has(collection as keyof SaasState)) {
          const record: Record<string, unknown> = {
            ...input,
            id,
            createdAt: input.createdAt || now,
            updatedAt: now,
          };
          if (meta.tenantField === 'tenantId' && !record.tenantId) {
            record.tenantId = DEFAULT_TENANT_ID;
          }
          await store.mutate((s) => {
            const arr = s[collection as keyof SaasState] as unknown as Array<
              Record<string, unknown>
            >;
            arr.unshift(record);
          });
          createdRecord = record;
        } else {
          res.status(400).json({ error: `Collection "${collection}" does not support creation.` });
          return;
        }

        await store.appendAuditLog({
          tenantId: getRecordTenantId(createdRecord, meta) || 'platform',
          orgId: 'platform',
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: 'super_admin',
          action: 'PLATFORM_DB_RECORD_CREATED',
          entityType: collection,
          entityId: id,
          summary: `Super Admin created record ${id} in ${collection}`,
          isPlatform: true,
        });

        res.status(201).json({ record: createdRecord });
      } catch (err) {
        console.error('Create database record error:', err);
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to create record.',
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 4. Update / Edit Record in Collection
  // -------------------------------------------------------------------------
  app.put(
    '/api/platform/database/records/:collection/:id',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const collection = String(req.params.collection ?? '').trim();
        const id = String(req.params.id ?? '').trim();
        const meta = COLLECTION_META_MAP.get(collection);
        if (!meta || !meta.canEdit) {
          res.status(400).json({
            error: `Editing records in "${collection}" is not permitted.`,
          });
          return;
        }
        const patch = req.body?.record;
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
          res.status(400).json({ error: 'Updated record payload must be a JSON object.' });
          return;
        }

        const safePatch: Record<string, unknown> = { ...(patch as Record<string, unknown>) };
        delete safePatch._id;
        delete safePatch.password_hash;
        safePatch.id = id;

        const actor = (req as TenantRequest).authUser!;
        let updated: Record<string, unknown> | null = null;

        if (collection === 'assets') {
          updated = (await db.updateAsset(
            id,
            safePatch as Partial<Asset>
          )) as unknown as Record<string, unknown> | null;
        } else if (collection === 'employees') {
          updated = (await db.updateEmployee(
            id,
            safePatch as Partial<Employee>
          )) as unknown as Record<string, unknown> | null;
        } else if (collection === 'assignments') {
          updated = (await db.updateAssignment(
            id,
            safePatch as Parameters<ItamsDatabase['updateAssignment']>[1]
          )) as unknown as Record<string, unknown> | null;
        } else if (collection === 'maintenance') {
          updated = (await db.updateMaintenanceLog(
            id,
            safePatch as Partial<MaintenanceLog>
          )) as unknown as Record<string, unknown> | null;
        } else if (collection === 'users') {
          const userPatch: Parameters<ItamsDatabase['updateUser']>[1] = {};
          if (typeof safePatch.name === 'string') userPatch.name = safePatch.name;
          if (typeof safePatch.email === 'string') userPatch.email = safePatch.email;
          if (typeof safePatch.role === 'string') {
            userPatch.role = safePatch.role === 'admin' ? 'admin' : 'staff';
          }
          if (typeof safePatch.department === 'string') {
            userPatch.department = safePatch.department;
          }
          if (typeof safePatch.status === 'string') {
            userPatch.status = safePatch.status as 'active' | 'inactive' | 'pending';
          }
          if (typeof safePatch.email_verified === 'boolean') {
            userPatch.email_verified = safePatch.email_verified;
          }
          if (typeof safePatch.mfa_enabled === 'boolean') {
            userPatch.mfa_enabled = safePatch.mfa_enabled;
          }
          if (typeof safePatch.is_super_admin === 'boolean') {
            userPatch.is_super_admin = safePatch.is_super_admin;
          }
          updated = (await db.updateUser(id, userPatch)) as unknown as Record<
            string,
            unknown
          > | null;
        } else if (STORE_ARRAY_COLLECTIONS.has(collection as keyof SaasState)) {
          await store.mutate((s) => {
            const arr = s[collection as keyof SaasState] as unknown as Array<
              Record<string, unknown>
            >;
            const idx = arr.findIndex((item) => String(item.id) === id);
            if (idx === -1) return;
            arr[idx] = {
              ...arr[idx],
              ...safePatch,
              id: arr[idx].id,
              updatedAt: new Date().toISOString(),
            };
            updated = arr[idx];
          });
        }

        if (!updated) {
          res.status(404).json({ error: `Record "${id}" not found in "${collection}".` });
          return;
        }

        await store.appendAuditLog({
          tenantId: getRecordTenantId(updated, meta) || 'platform',
          orgId: 'platform',
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: 'super_admin',
          action: 'PLATFORM_DB_RECORD_UPDATED',
          entityType: collection,
          entityId: id,
          summary: `Super Admin edited record ${id} in ${collection}`,
          isPlatform: true,
        });

        res.json({ record: updated });
      } catch (err) {
        console.error('Update database record error:', err);
        res.status(400).json({
          error: err instanceof Error ? err.message : 'Failed to update record.',
        });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 5. Delete Individual Record from Collection
  // -------------------------------------------------------------------------
  app.delete(
    '/api/platform/database/records/:collection/:id',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const collection = String(req.params.collection ?? '').trim();
        const id = String(req.params.id ?? '').trim();
        const meta = COLLECTION_META_MAP.get(collection);
        if (!meta || !meta.canDelete) {
          res.status(400).json({
            error: `Deleting records from "${collection}" is not permitted.`,
          });
          return;
        }

        const actor = (req as TenantRequest).authUser!;

        if (collection === 'tenants' && id === DEFAULT_TENANT_ID) {
          res.status(400).json({ error: 'Cannot delete the primary platform workspace.' });
          return;
        }
        if (collection === 'users' && id === actor.id) {
          res.status(400).json({ error: 'Cannot delete your currently signed-in account.' });
          return;
        }

        let deleted = false;
        let recordTenantId = 'platform';

        if (collection === 'assets') {
          const existing = await db.getAssetById(id);
          if (existing) recordTenantId = existing.tenant_id || 'platform';
          deleted = await db.deleteAsset(id);
          if (deleted) {
            await store.mutate((s) => {
              delete s.assetMeta[id];
              delete s.customFieldValues[id];
            });
          }
        } else if (collection === 'employees') {
          const existing = await db.getEmployeeById(id);
          if (existing) recordTenantId = existing.tenant_id || 'platform';
          deleted = await db.deleteEmployee(id);
        } else if (collection === 'assignments') {
          const existing = await db.getAssignmentById(id);
          if (existing) recordTenantId = existing.tenant_id || 'platform';
          deleted = await db.deleteAssignment(id);
        } else if (collection === 'maintenance') {
          const existing = await db.getMaintenanceById(id);
          if (existing) recordTenantId = existing.tenant_id || 'platform';
          deleted = await db.deleteMaintenanceLog(id);
          if (deleted) {
            await store.mutate((s) => {
              delete s.maintenanceMeta[id];
            });
          }
        } else if (collection === 'users') {
          deleted = await db.deleteUser(id);
          if (deleted) {
            await store.mutate((s) => {
              s.memberships = s.memberships.filter((m) => m.userId !== id);
              delete s.mfaSecrets[id];
            });
          }
        } else if (collection === 'tenants') {
          const existingTenant = store.data.tenants.find((t) => t.id === id);
          if (existingTenant) {
            recordTenantId = 'platform';
            await purgeTenantCompletely({
              tenantId: id,
              actorId: actor.id,
              db,
              store,
            });
            deleted = true;
          }
        } else if (STORE_ARRAY_COLLECTIONS.has(collection as keyof SaasState)) {
          await store.mutate((s) => {
            const arr = s[collection as keyof SaasState] as unknown as Array<
              Record<string, unknown>
            >;
            const found = arr.find((item) => String(item.id) === id);
            if (!found) return;
            recordTenantId = getRecordTenantId(found, meta) || 'platform';
            (s[collection as keyof SaasState] as unknown) = arr.filter(
              (item) => String(item.id) !== id
            );
            if (collection === 'tickets') {
              s.ticketComments = s.ticketComments.filter((c) => c.ticketId !== id);
            }
            deleted = true;
          });
        }

        if (!deleted) {
          res.status(404).json({ error: `Record "${id}" not found in "${collection}".` });
          return;
        }

        await store.appendAuditLog({
          tenantId: recordTenantId,
          orgId: 'platform',
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: 'super_admin',
          action: 'PLATFORM_DB_RECORD_DELETED',
          entityType: collection,
          entityId: id,
          summary: `Super Admin deleted record ${id} from ${collection}`,
          isPlatform: true,
        });

        res.json({ ok: true });
      } catch (err) {
        console.error('Delete database record error:', err);
        res.status(500).json({ error: 'Failed to delete database record.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 6. Targeted Tenant Data Deletion / Workspace Reset
  // -------------------------------------------------------------------------
  app.post(
    '/api/platform/database/tenant-operations',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const tenantId = String(req.body?.tenantId ?? '').trim();
        const action = String(req.body?.action ?? '').trim();
        const targetCollection = String(req.body?.collection ?? '').trim();

        const tenant = store.data.tenants.find((t) => t.id === tenantId);
        if (!tenant) {
          res.status(404).json({ error: 'Tenant not found.' });
          return;
        }

        const actor = (req as TenantRequest).authUser!;
        let removedCount = 0;

        if (action === 'delete_collection_data') {
          const meta = COLLECTION_META_MAP.get(targetCollection);
          if (!meta || !meta.tenantScoped || targetCollection === 'tenants') {
            res.status(400).json({
              error: `Collection "${targetCollection}" cannot be cleared per-tenant.`,
            });
            return;
          }

          if (targetCollection === 'assets') {
            const list = await db.listAssets({ tenantId });
            for (const a of list) {
              if (await db.deleteAsset(a.id)) removedCount++;
            }
            await store.mutate((s) => {
              for (const a of list) {
                delete s.assetMeta[a.id];
                delete s.customFieldValues[a.id];
              }
            });
          } else if (targetCollection === 'employees') {
            const list = await db.listEmployees({ tenantId });
            for (const e of list) {
              if (await db.deleteEmployee(e.id)) removedCount++;
            }
          } else if (targetCollection === 'assignments') {
            const list = await db.listAssignments({ tenantId });
            for (const asg of list) {
              if (await db.deleteAssignment(asg.id)) removedCount++;
            }
          } else if (targetCollection === 'maintenance') {
            const list = await db.listMaintenanceLogs({ tenantId });
            for (const m of list) {
              if (await db.deleteMaintenanceLog(m.id)) removedCount++;
            }
          } else if (STORE_ARRAY_COLLECTIONS.has(targetCollection as keyof SaasState)) {
            await store.mutate((s) => {
              const arr = s[targetCollection as keyof SaasState] as unknown as Array<
                Record<string, unknown>
              >;
              const before = arr.length;
              const filtered = arr.filter(
                (r) => String(r[meta.tenantField!] ?? '') !== tenantId
              );
              removedCount = before - filtered.length;
              (s[targetCollection as keyof SaasState] as unknown) = filtered;
            });
          }

          await store.appendAuditLog({
            tenantId,
            orgId: 'platform',
            actorUserId: actor.id,
            actorEmail: actor.email,
            actorRole: 'super_admin',
            action: 'PLATFORM_TENANT_COLLECTION_CLEARED',
            entityType: targetCollection,
            entityId: tenantId,
            summary: `Cleared ${removedCount} ${targetCollection} record(s) for tenant ${tenant.name}`,
            isPlatform: true,
          });

          res.json({
            ok: true,
            removedCount,
            message: `Deleted ${removedCount} record(s) from ${targetCollection} for ${tenant.name}.`,
          });
          return;
        }

        if (action === 'reset_tenant_workspace') {
          const [tAssets, tEmps, tAsgs, tMaint] = await Promise.all([
            db.listAssets({ tenantId }),
            db.listEmployees({ tenantId }),
            db.listAssignments({ tenantId }),
            db.listMaintenanceLogs({ tenantId }),
          ]);
          for (const asg of tAsgs) {
            if (await db.deleteAssignment(asg.id)) removedCount++;
          }
          for (const m of tMaint) {
            if (await db.deleteMaintenanceLog(m.id)) removedCount++;
          }
          for (const a of tAssets) {
            if (await db.deleteAsset(a.id)) removedCount++;
          }
          for (const e of tEmps) {
            if (await db.deleteEmployee(e.id)) removedCount++;
          }

          const removedAssetIds = new Set(tAssets.map((a) => a.id));
          const removedMaintIds = new Set(tMaint.map((m) => m.id));
          const removedTicketIds = new Set(
            store.data.tickets.filter((t) => t.tenantId === tenantId).map((t) => t.id)
          );

          await store.mutate((s) => {
            const operationalCollections: Array<keyof SaasState> = [
              'assetTransfers',
              'softwareLicences',
              'vendors',
              'purchaseRequests',
              'purchaseOrders',
              'tickets',
              'incidents',
              'problems',
              'changes',
              'serviceRequests',
              'contracts',
              'knowledgeArticles',
              'customFields',
              'attachments',
              'auditLogs',
            ];
            for (const key of operationalCollections) {
              const arr = s[key] as unknown as Array<Record<string, unknown>>;
              const kept = arr.filter((r) => String(r.tenantId ?? '') !== tenantId);
              removedCount += arr.length - kept.length;
              (s[key] as unknown) = kept;
            }
            s.ticketComments = s.ticketComments.filter(
              (c) => !removedTicketIds.has(c.ticketId)
            );
            for (const aid of removedAssetIds) {
              delete s.assetMeta[aid];
              delete s.customFieldValues[aid];
            }
            for (const mid of removedMaintIds) {
              delete s.maintenanceMeta[mid];
            }
          });

          await store.appendAuditLog({
            tenantId,
            orgId: 'platform',
            actorUserId: actor.id,
            actorEmail: actor.email,
            actorRole: 'super_admin',
            action: 'PLATFORM_TENANT_WORKSPACE_RESET',
            entityType: 'tenant',
            entityId: tenantId,
            summary: `Reset operational database for tenant ${tenant.name} (${removedCount} records cleared)`,
            isPlatform: true,
          });

          res.json({
            ok: true,
            removedCount,
            message: `Reset operational data for "${tenant.name}" (${removedCount} records cleared). Tenant profile, orgs, and users remain intact.`,
          });
          return;
        }

        if (action === 'delete_tenant_completely') {
          if (tenantId === DEFAULT_TENANT_ID) {
            res.status(400).json({
              error: 'Cannot completely delete the primary platform workspace.',
            });
            return;
          }

          removedCount = await purgeTenantCompletely({
            tenantId,
            actorId: actor.id,
            db,
            store,
          });

          await store.appendAuditLog({
            tenantId: 'platform',
            orgId: 'platform',
            actorUserId: actor.id,
            actorEmail: actor.email,
            actorRole: 'super_admin',
            action: 'PLATFORM_TENANT_PURGED',
            entityType: 'tenant',
            entityId: tenantId,
            summary: `Purged tenant "${tenant.name}" and ${removedCount} associated records`,
            isPlatform: true,
          });

          res.json({
            ok: true,
            removedCount,
            message: `Deleted tenant "${tenant.name}" and all ${removedCount} associated database records.`,
          });
          return;
        }

        res.status(400).json({ error: 'Unsupported tenant database operation.' });
      } catch (err) {
        console.error('Tenant database operation error:', err);
        res.status(500).json({ error: 'Failed to execute tenant database operation.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 7. Reset Individual Database / Collection
  // -------------------------------------------------------------------------
  app.post(
    '/api/platform/database/reset-collection',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const collection = String(req.body?.collection ?? '').trim();
        const tenantId = String(req.body?.tenantId ?? '').trim() || undefined;
        const confirm = String(req.body?.confirm ?? '').trim();

        const meta = COLLECTION_META_MAP.get(collection);
        if (!meta || !meta.canReset) {
          res.status(400).json({
            error: `Collection "${collection}" cannot be individually reset.`,
          });
          return;
        }

        const expectedConfirm = `RESET_${collection.toUpperCase()}`;
        if (confirm !== expectedConfirm) {
          res.status(400).json({
            error: `Confirmation text "${expectedConfirm}" is required.`,
          });
          return;
        }

        const actor = (req as TenantRequest).authUser!;
        let removedCount = 0;

        if (collection === 'plans') {
          const prevLen = store.data.plans.length;
          await store.mutate((s) => {
            s.plans = createDefaultPlans();
          });
          removedCount = prevLen;
          await store.appendAuditLog({
            tenantId: 'platform',
            orgId: 'platform',
            actorUserId: actor.id,
            actorEmail: actor.email,
            actorRole: 'super_admin',
            action: 'PLATFORM_COLLECTION_RESET',
            entityType: 'plans',
            entityId: 'plans',
            summary: 'Reset subscription plans to default GH₵ tiers',
            isPlatform: true,
          });
          res.json({
            ok: true,
            removedCount,
            message: 'Subscription plans restored to default tiers.',
          });
          return;
        }

        if (collection === 'assets') {
          const list = await db.listAssets(tenantId ? { tenantId } : undefined);
          for (const a of list) {
            if (await db.deleteAsset(a.id)) removedCount++;
          }
          await store.mutate((s) => {
            for (const a of list) {
              delete s.assetMeta[a.id];
              delete s.customFieldValues[a.id];
            }
          });
        } else if (collection === 'employees') {
          const list = await db.listEmployees(tenantId ? { tenantId } : undefined);
          for (const e of list) {
            if (await db.deleteEmployee(e.id)) removedCount++;
          }
        } else if (collection === 'assignments') {
          const list = await db.listAssignments(tenantId ? { tenantId } : undefined);
          for (const asg of list) {
            if (await db.deleteAssignment(asg.id)) removedCount++;
          }
        } else if (collection === 'maintenance') {
          const list = await db.listMaintenanceLogs(tenantId ? { tenantId } : undefined);
          for (const m of list) {
            if (await db.deleteMaintenanceLog(m.id)) removedCount++;
          }
        } else if (STORE_ARRAY_COLLECTIONS.has(collection as keyof SaasState)) {
          await store.mutate((s) => {
            const arr = s[collection as keyof SaasState] as unknown as Array<
              Record<string, unknown>
            >;
            if (tenantId && meta.tenantField) {
              const kept = arr.filter(
                (r) => String(r[meta.tenantField!] ?? '') !== tenantId
              );
              removedCount = arr.length - kept.length;
              (s[collection as keyof SaasState] as unknown) = kept;
            } else {
              removedCount = arr.length;
              (s[collection as keyof SaasState] as unknown) = [];
            }
            if (collection === 'tickets' && !tenantId) {
              s.ticketComments = [];
            }
          });
        }

        await store.appendAuditLog({
          tenantId: tenantId || 'platform',
          orgId: 'platform',
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: 'super_admin',
          action: 'PLATFORM_COLLECTION_RESET',
          entityType: collection,
          entityId: tenantId || 'all',
          summary: `Reset collection ${collection}${tenantId ? ` for tenant ${tenantId}` : ' (all tenants)'} (${removedCount} records cleared)`,
          isPlatform: true,
        });

        res.json({
          ok: true,
          removedCount,
          message: `Reset "${meta.label}" (${removedCount} records cleared${
            tenantId ? ` for ${tenantId}` : ''
          }).`,
        });
      } catch (err) {
        console.error('Reset individual collection error:', err);
        res.status(500).json({ error: 'Failed to reset individual collection.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 8. Export Sanitized Snapshot for Cloud Firestore Sync
  // -------------------------------------------------------------------------
  app.get(
    '/api/platform/database/snapshot',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const tenantId = String(req.query.tenantId ?? '').trim() || undefined;
        const scope = tenantId ? { tenantId } : undefined;

        const [assets, employees, assignments, maintenance, users] = await Promise.all([
          db.listAssets(scope),
          db.listEmployees(scope),
          db.listAssignments(scope),
          db.listMaintenanceLogs(scope),
          db.listUsers(),
        ]);

        const filterTenant = <T extends { tenantId: string }>(items: T[]): T[] =>
          tenantId ? items.filter((i) => i.tenantId === tenantId) : items;

        res.json({
          generatedAt: new Date().toISOString(),
          plans: store.data.plans,
          platformSettings: store.data.platformSettings,
          tenants: tenantId
            ? store.data.tenants.filter((t) => t.id === tenantId)
            : store.data.tenants,
          clientOrganisations: filterTenant(store.data.clientOrganisations),
          locations: filterTenant(store.data.locations),
          departments: filterTenant(store.data.departments),
          memberships: filterTenant(store.data.memberships),
          subscriptions: filterTenant(store.data.subscriptions),
          payments: filterTenant(store.data.payments),
          invoices: filterTenant(store.data.invoices),
          users: users.map((u) => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            department: u.department,
            status: u.status,
            is_super_admin: Boolean(u.is_super_admin),
          })),
          assets,
          employees,
          assignments,
          maintenance,
          assetTransfers: filterTenant(store.data.assetTransfers),
          softwareLicences: filterTenant(store.data.softwareLicences),
          vendors: filterTenant(store.data.vendors),
          purchaseRequests: filterTenant(store.data.purchaseRequests),
          purchaseOrders: filterTenant(store.data.purchaseOrders),
          tickets: filterTenant(store.data.tickets),
          incidents: filterTenant(store.data.incidents),
          problems: filterTenant(store.data.problems),
          changes: filterTenant(store.data.changes),
          serviceCatalogue: filterTenant(store.data.serviceCatalogue),
          serviceRequests: filterTenant(store.data.serviceRequests),
          slaPolicies: filterTenant(store.data.slaPolicies),
          contracts: filterTenant(store.data.contracts),
          knowledgeArticles: filterTenant(store.data.knowledgeArticles),
          customFields: filterTenant(store.data.customFields),
          auditLogs: filterTenant(store.data.auditLogs).slice(0, 100),
          platformAuditLogs: store.data.platformAuditLogs.slice(0, 100),
        });
      } catch (err) {
        console.error('Database snapshot error:', err);
        res.status(500).json({ error: 'Failed to build database snapshot.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // 9. Record Firestore Console Mutation Audit Log
  // -------------------------------------------------------------------------
  app.post(
    '/api/platform/audit-logs',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const actor = (req as TenantRequest).authUser!;
        const action = String(req.body?.action ?? 'FIRESTORE_DOCUMENT_UPDATED')
          .trim()
          .slice(0, 80);
        const entityType = String(req.body?.entityType ?? 'firestore_doc')
          .trim()
          .slice(0, 80);
        const entityId = String(req.body?.entityId ?? 'unknown')
          .trim()
          .slice(0, 128);
        const tenantId = String(req.body?.tenantId ?? 'platform')
          .trim()
          .slice(0, 128);
        const summary = String(req.body?.summary ?? 'Firestore record modified')
          .trim()
          .slice(0, 400);

        if (!action || !summary) {
          res.status(400).json({ error: 'Audit action and summary are required.' });
          return;
        }

        const entry = await store.appendAuditLog({
          tenantId: tenantId || 'platform',
          orgId: 'platform',
          actorUserId: actor.id,
          actorEmail: actor.email,
          actorRole: 'super_admin',
          action,
          entityType,
          entityId,
          summary,
          isPlatform: true,
        });

        res.status(201).json({ auditLog: entry });
      } catch (err) {
        console.error('Record platform audit log error:', err);
        res.status(500).json({ error: 'Failed to record platform audit log.' });
      }
    }
  );
}
