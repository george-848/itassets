import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MongoClient, type Db } from 'mongodb';
import { createDefaultPlans } from './entitlements.ts';
import { getPaystackPublicKeyHint, isPaystackLiveConfigured } from './paystack.ts';
import { BOOTSTRAP_SUPER_ADMIN_EMAIL } from './rbac.ts';
import type { AssetSpecs } from '../src/types/itams.ts';
import type {
  AuditLogEntry,
  AssetTransfer,
  ChangeRequest,
  ClientOrganisation,
  CustomFieldDef,
  DepartmentItem,
  Incident,
  InvoiceRecord,
  KnowledgeArticle,
  LocationItem,
  PaymentTransaction,
  PlatformSettings,
  ProblemRecord,
  PurchaseOrder,
  PurchaseRequest,
  ServiceCatalogueItem,
  ServiceContract,
  ServiceRequest,
  SlaPolicy,
  SoftwareLicence,
  SubscriptionPlan,
  Tenant,
  TenantInvitation,
  TenantSubscription,
  Ticket,
  TicketComment,
  UserMembership,
  Vendor,
} from '../src/types/saas.ts';

export const DEFAULT_TENANT_ID = 'ten-default-01';
export const DEFAULT_ORG_ID = 'org-default-01';

export interface AssetExtendedMeta {
  location_id?: string;
  department_id?: string;
  vendor_id?: string | null;
  purchase_order_id?: string | null;
  barcode_value?: string;
  qr_payload?: string;
  specs?: AssetSpecs;
  depreciation_method?: 'straight_line' | 'declining_balance' | 'none';
  useful_life_years?: number;
  salvage_value?: number;
  disposal_status?: 'none' | 'pending_approval' | 'approved' | 'disposed';
  disposal_reason?: string;
  disposal_date?: string | null;
  disposal_approved_by?: string | null;
}

export interface MaintenanceExtendedMeta {
  ticket_id?: string | null;
  downtime_minutes?: number;
}

export interface SaasState {
  plans: SubscriptionPlan[];
  tenants: Tenant[];
  clientOrganisations: ClientOrganisation[];
  locations: LocationItem[];
  departments: DepartmentItem[];
  memberships: UserMembership[];
  invitations: TenantInvitation[];
  subscriptions: TenantSubscription[];
  payments: PaymentTransaction[];
  invoices: InvoiceRecord[];
  assetMeta: Record<string, AssetExtendedMeta>;
  maintenanceMeta: Record<string, MaintenanceExtendedMeta>;
  assetTransfers: AssetTransfer[];
  softwareLicences: SoftwareLicence[];
  vendors: Vendor[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  tickets: Ticket[];
  ticketComments: TicketComment[];
  incidents: Incident[];
  problems: ProblemRecord[];
  changes: ChangeRequest[];
  serviceCatalogue: ServiceCatalogueItem[];
  serviceRequests: ServiceRequest[];
  slaPolicies: SlaPolicy[];
  contracts: ServiceContract[];
  knowledgeArticles: KnowledgeArticle[];
  auditLogs: AuditLogEntry[];
  platformAuditLogs: AuditLogEntry[];
  customFields: CustomFieldDef[];
  platformSettings: PlatformSettings;
  verificationTokens: Array<{
    token: string;
    userId: string;
    email: string;
    expiresAt: string;
  }>;
  passwordResetTokens: Array<{
    token: string;
    userId: string;
    email: string;
    expiresAt: string;
  }>;
  processedWebhookRefs: string[];
  alertJobHistory: Array<{ key: string; triggeredAt: string }>;
}

function createInitialSaasState(): SaasState {
  const now = new Date().toISOString();
  const oneYearLater = new Date(
    Date.now() + 365 * 24 * 60 * 60 * 1000
  ).toISOString();
  const plans = createDefaultPlans();

  const defaultTenant: Tenant = {
    id: DEFAULT_TENANT_ID,
    name: 'AssetVault Enterprise',
    slug: 'assetvault-enterprise',
    type: 'company',
    status: 'active',
    ownerUserId: 'usr-admin-01',
    planCode: 'business',
    deploymentMode: 'shared_cloud',
    supportEmail: 'support@assetvault.io',
    country: 'Ghana',
    createdAt: now,
    updatedAt: now,
  };

  const defaultOrg: ClientOrganisation = {
    id: DEFAULT_ORG_ID,
    tenantId: DEFAULT_TENANT_ID,
    name: 'Main Corporate HQ',
    code: 'HQ-01',
    industry: 'Technology & Operations',
    contactName: 'IT Operations Desk',
    contactEmail: 'admin@assetvault.io',
    contactPhone: '+233 30 000 0000',
    address: 'Airport City, Accra',
    status: 'active',
    isDefault: true,
    createdAt: now,
    updatedAt: now,
  };

  const defaultLocation: LocationItem = {
    id: 'loc-default-01',
    tenantId: DEFAULT_TENANT_ID,
    orgId: DEFAULT_ORG_ID,
    name: 'Main HQ Vault',
    code: 'LOC-HQ-01',
    city: 'Accra',
    country: 'Ghana',
    address: 'Airport City, Accra',
    status: 'active',
    createdAt: now,
  };

  const defaultDepartment: DepartmentItem = {
    id: 'dept-default-01',
    tenantId: DEFAULT_TENANT_ID,
    orgId: DEFAULT_ORG_ID,
    name: 'IT Infrastructure',
    code: 'DEPT-IT',
    managerName: 'System Administrator',
    costCenter: 'CC-100',
    status: 'active',
    createdAt: now,
  };

  const defaultSub: TenantSubscription = {
    id: 'sub-default-01',
    tenantId: DEFAULT_TENANT_ID,
    planCode: 'business',
    billingCycle: 'annual',
    status: 'active',
    trialEndsAt: null,
    currentPeriodStart: now,
    currentPeriodEnd: oneYearLater,
    graceEndsAt: null,
    cancelAtPeriodEnd: false,
    amountGhs: 6990,
    updatedAt: now,
  };

  const defaultMemberships: UserMembership[] = [
    {
      id: `usr-admin-01_${DEFAULT_TENANT_ID}`,
      userId: 'usr-admin-01',
      tenantId: DEFAULT_TENANT_ID,
      role: 'tenant_owner',
      status: 'active',
      orgAccessMode: 'all',
      allowedOrgIds: [],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `usr-superadmin-01_${DEFAULT_TENANT_ID}`,
      userId: 'usr-superadmin-01',
      tenantId: DEFAULT_TENANT_ID,
      role: 'tenant_owner',
      status: 'active',
      orgAccessMode: 'all',
      allowedOrgIds: [],
      createdAt: now,
      updatedAt: now,
    },
  ];

  const defaultSlaPolicies: SlaPolicy[] = [
    {
      id: 'sla-urgent-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'Urgent P1 SLA',
      priority: 'Urgent',
      firstResponseMinutes: 15,
      resolutionMinutes: 240,
      businessHoursOnly: false,
      escalationMinutesBeforeBreach: 30,
      isDefault: true,
      createdAt: now,
    },
    {
      id: 'sla-high-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'High P2 SLA',
      priority: 'High',
      firstResponseMinutes: 60,
      resolutionMinutes: 480,
      businessHoursOnly: true,
      escalationMinutesBeforeBreach: 60,
      isDefault: true,
      createdAt: now,
    },
    {
      id: 'sla-medium-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'Medium P3 SLA',
      priority: 'Medium',
      firstResponseMinutes: 240,
      resolutionMinutes: 1440,
      businessHoursOnly: true,
      escalationMinutesBeforeBreach: 120,
      isDefault: true,
      createdAt: now,
    },
    {
      id: 'sla-low-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'Low P4 SLA',
      priority: 'Low',
      firstResponseMinutes: 480,
      resolutionMinutes: 2880,
      businessHoursOnly: true,
      escalationMinutesBeforeBreach: 240,
      isDefault: true,
      createdAt: now,
    },
  ];

  const defaultCatalogue: ServiceCatalogueItem[] = [
    {
      id: 'cat-laptop-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'Standard Workstation / Laptop Provisioning',
      category: 'Hardware',
      description: 'Request a new corporate laptop with standard security baseline and MDM enrollment.',
      estimatedFulfilmentHours: 24,
      requiresApproval: true,
      defaultCostGhs: 14500,
      status: 'active',
    },
    {
      id: 'cat-m365-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'Microsoft 365 & Collaboration Licence',
      category: 'Software',
      description: 'Assign an enterprise productivity licence seat to an employee.',
      estimatedFulfilmentHours: 4,
      requiresApproval: true,
      defaultCostGhs: 1800,
      status: 'active',
    },
    {
      id: 'cat-vpn-01',
      tenantId: DEFAULT_TENANT_ID,
      orgId: DEFAULT_ORG_ID,
      name: 'VPN & Zero-Trust Network Access',
      category: 'Access',
      description: 'Provision remote VPN certificate and MFA onboarding.',
      estimatedFulfilmentHours: 2,
      requiresApproval: false,
      defaultCostGhs: 0,
      status: 'active',
    },
  ];

  return {
    plans,
    tenants: [defaultTenant],
    clientOrganisations: [defaultOrg],
    locations: [defaultLocation],
    departments: [defaultDepartment],
    memberships: defaultMemberships,
    invitations: [],
    subscriptions: [defaultSub],
    payments: [],
    invoices: [],
    assetMeta: {},
    maintenanceMeta: {},
    assetTransfers: [],
    softwareLicences: [],
    vendors: [],
    purchaseRequests: [],
    purchaseOrders: [],
    tickets: [],
    ticketComments: [],
    incidents: [],
    problems: [],
    changes: [],
    serviceCatalogue: defaultCatalogue,
    serviceRequests: [],
    slaPolicies: defaultSlaPolicies,
    contracts: [],
    knowledgeArticles: [
      {
        id: 'kb-welcome-01',
        tenantId: DEFAULT_TENANT_ID,
        orgId: DEFAULT_ORG_ID,
        title: 'IT Equipment Onboarding & Handover Policy',
        category: 'Policies & Governance',
        visibility: 'public_portal',
        summary: 'Standard operating procedure for issuing laptops, signing handover receipts, and returning equipment.',
        content:
          'All corporate IT assets must be registered with a unique Asset Tag and Serial Number prior to assignment. Employees receive a digital handover number (HO-YYYY-XXXX) upon issuance and must return hardware in verified condition upon role transition or offboarding.',
        tags: ['onboarding', 'handover', 'policy'],
        helpfulCount: 1,
        authorName: 'IT Infrastructure',
        updatedAt: now,
      },
    ],
    auditLogs: [],
    platformAuditLogs: [],
    customFields: [],
    platformSettings: {
      platformName: 'AssetVault IT',
      supportEmail: 'support@assetvault.io',
      defaultCurrency: 'GHS',
      trialDays: 14,
      gracePeriodDays: 7,
      paystackConfigured: isPaystackLiveConfigured(),
      paystackPublicKeyHint: getPaystackPublicKeyHint(),
      smtpConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER),
      maintenanceMode: false,
      updatedAt: now,
    },
    verificationTokens: [],
    passwordResetTokens: [],
    processedWebhookRefs: [],
    alertJobHistory: [],
  };
}

export class SaasStore {
  private state: SaasState;
  private sqliteDb: DatabaseSync | null = null;
  private mongoClient: MongoClient | null = null;
  private mongoDb: Db | null = null;
  private readonly sqlitePath: string;
  private initialized = false;

  constructor(sqlitePathOverride?: string) {
    this.sqlitePath =
      sqlitePathOverride ||
      path.resolve(process.cwd(), 'data', 'it_assets.db');
    this.state = createInitialSaasState();
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    const mongoUri = (process.env.MONGODB_URI || '')
      .trim()
      .replace(/^MONGODB_URI=/, '')
      .replace(/^["']|["']$/g, '')
      .trim();

    if (mongoUri && !process.env.ITAMS_FORCE_SQLITE) {
      try {
        const dbName =
          process.env.MONGODB_DB_NAME?.trim().replace(/^["']|["']$/g, '') ||
          'assetvault_it';
        this.mongoClient = new MongoClient(mongoUri, {
          serverSelectionTimeoutMS: 8000,
          connectTimeoutMS: 8000,
          family: 4,
        });
        await this.mongoClient.connect();
        this.mongoDb = this.mongoClient.db(dbName);
        const existing = await this.mongoDb
          .collection<{ _id: string; payload: SaasState }>('saas_state')
          .findOne({ _id: 'singleton' });
        if (existing?.payload) {
          this.state = { ...createInitialSaasState(), ...existing.payload };
        } else {
          await this.mongoDb
            .collection<{ _id: string; payload: SaasState }>('saas_state')
            .updateOne(
              { _id: 'singleton' },
              { $set: { payload: this.state } },
              { upsert: true }
            );
        }
        this.initialized = true;
        return;
      } catch {
        try {
          await this.mongoClient?.close();
        } catch {
          // Ignore
        }
        this.mongoClient = null;
        this.mongoDb = null;
      }
    }

    const { DatabaseSync } = await import('node:sqlite');
    fs.mkdirSync(path.dirname(this.sqlitePath), { recursive: true });
    this.sqliteDb = new DatabaseSync(this.sqlitePath);
    this.sqliteDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS saas_kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    const row = this.sqliteDb
      .prepare('SELECT value FROM saas_kv WHERE key = ?')
      .get('state_v1') as { value?: string } | undefined;

    if (row?.value) {
      try {
        const parsed = JSON.parse(row.value) as Partial<SaasState>;
        this.state = { ...createInitialSaasState(), ...parsed };
      } catch {
        this.state = createInitialSaasState();
      }
    } else {
      await this.persist();
    }

    // Always keep runtime payment/SMTP config flags synced from env
    this.state.platformSettings.paystackConfigured = isPaystackLiveConfigured();
    this.state.platformSettings.paystackPublicKeyHint = getPaystackPublicKeyHint();
    this.state.platformSettings.smtpConfigured = Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER
    );

    this.initialized = true;
  }

  get data(): SaasState {
    return this.state;
  }

  async persist(): Promise<void> {
    const now = new Date().toISOString();
    if (this.mongoDb) {
      await this.mongoDb
        .collection<{ _id: string; payload: SaasState }>('saas_state')
        .updateOne(
          { _id: 'singleton' },
          { $set: { payload: this.state } },
          { upsert: true }
        );
      return;
    }
    if (this.sqliteDb) {
      this.sqliteDb
        .prepare(
          `INSERT INTO saas_kv (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .run('state_v1', JSON.stringify(this.state), now);
    }
  }

  async mutate<T>(fn: (state: SaasState) => T | Promise<T>): Promise<T> {
    const result = await fn(this.state);
    await this.persist();
    return result;
  }

  async resetToCleanState(): Promise<void> {
    this.state = createInitialSaasState();
    await this.persist();
  }

  async appendAuditLog(params: {
    tenantId: string;
    orgId: string;
    actorUserId: string;
    actorEmail: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    summary: string;
    isPlatform?: boolean;
  }): Promise<AuditLogEntry> {
    const entry: AuditLogEntry = {
      id: `aud-${crypto.randomUUID().slice(0, 10)}`,
      tenantId: params.tenantId,
      orgId: params.orgId,
      actorUserId: params.actorUserId,
      actorEmail: params.actorEmail,
      actorRole: params.actorRole,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      summary: params.summary,
      createdAt: new Date().toISOString(),
    };
    if (params.isPlatform) {
      this.state.platformAuditLogs.unshift(entry);
      if (this.state.platformAuditLogs.length > 2000) {
        this.state.platformAuditLogs.length = 2000;
      }
    } else {
      this.state.auditLogs.unshift(entry);
      if (this.state.auditLogs.length > 5000) {
        this.state.auditLogs.length = 5000;
      }
    }
    await this.persist();
    return entry;
  }

  ensureUserMembership(params: {
    userId: string;
    email: string;
    defaultRole?: UserMembership['role'];
  }): UserMembership {
    const existing = this.state.memberships.find(
      (m) => m.userId === params.userId && m.status === 'active'
    );
    if (existing) return existing;

    const now = new Date().toISOString();
    const isBootSuperAdmin =
      params.email.trim().toLowerCase() === BOOTSTRAP_SUPER_ADMIN_EMAIL;
    const role: UserMembership['role'] =
      isBootSuperAdmin
        ? 'tenant_owner'
        : params.defaultRole || 'tenant_owner';

    const created: UserMembership = {
      id: `${params.userId}_${DEFAULT_TENANT_ID}`,
      userId: params.userId,
      tenantId: DEFAULT_TENANT_ID,
      role,
      status: 'active',
      orgAccessMode: 'all',
      allowedOrgIds: [],
      createdAt: now,
      updatedAt: now,
    };
    this.state.memberships.push(created);
    return created;
  }

  seedTenantDefaults(params: {
    tenant: Tenant;
    defaultOrg: ClientOrganisation;
    ownerMembership: UserMembership;
    subscription: TenantSubscription;
  }): void {
    const now = new Date().toISOString();
    this.state.tenants.push(params.tenant);
    this.state.clientOrganisations.push(params.defaultOrg);
    this.state.memberships.push(params.ownerMembership);
    this.state.subscriptions.push(params.subscription);

    this.state.locations.push({
      id: `loc-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: params.tenant.id,
      orgId: params.defaultOrg.id,
      name: 'Main Office',
      code: 'LOC-01',
      city: 'Accra',
      country: params.tenant.country || 'Ghana',
      address: params.defaultOrg.address || 'Headquarters',
      status: 'active',
      createdAt: now,
    });

    this.state.departments.push({
      id: `dept-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: params.tenant.id,
      orgId: params.defaultOrg.id,
      name: 'IT Infrastructure',
      code: 'DEPT-IT',
      managerName: 'IT Lead',
      costCenter: 'CC-100',
      status: 'active',
      createdAt: now,
    });

    const priorities: Array<{
      p: SlaPolicy['priority'];
      fr: number;
      res: number;
      esc: number;
    }> = [
      { p: 'Urgent', fr: 15, res: 240, esc: 30 },
      { p: 'High', fr: 60, res: 480, esc: 60 },
      { p: 'Medium', fr: 240, res: 1440, esc: 120 },
      { p: 'Low', fr: 480, res: 2880, esc: 240 },
    ];
    for (const row of priorities) {
      this.state.slaPolicies.push({
        id: `sla-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: params.tenant.id,
        orgId: params.defaultOrg.id,
        name: `${row.p} Default SLA`,
        priority: row.p,
        firstResponseMinutes: row.fr,
        resolutionMinutes: row.res,
        businessHoursOnly: row.p !== 'Urgent',
        escalationMinutesBeforeBreach: row.esc,
        isDefault: true,
        createdAt: now,
      });
    }

    this.state.serviceCatalogue.push({
      id: `cat-${crypto.randomUUID().slice(0, 8)}`,
      tenantId: params.tenant.id,
      orgId: params.defaultOrg.id,
      name: 'New Laptop & Onboarding Bundle',
      category: 'Hardware',
      description: 'Provision standard workstation laptop and access credentials.',
      estimatedFulfilmentHours: 24,
      requiresApproval: true,
      defaultCostGhs: 14500,
      status: 'active',
    });
  }
}

let sharedSaasStorePromise: Promise<SaasStore> | null = null;

export function getSharedSaasStore(): Promise<SaasStore> {
  if (!sharedSaasStorePromise) {
    const store = new SaasStore();
    sharedSaasStorePromise = store
      .init()
      .then(() => store)
      .catch((err) => {
        sharedSaasStorePromise = null;
        throw err;
      });
  }
  return sharedSaasStorePromise;
}
