import type {
  Asset,
  AssetAssignment,
  DashboardSummary,
  Employee,
  MaintenanceLog,
  SystemNotification,
  User,
  UserRole,
} from '../types/itams.ts';
import type {
  AssetTransfer,
  AttachmentItem,
  AuditLogEntry,
  BillingCycle,
  ChangeRequest,
  ClientOrganisation,
  CurrencyCode,
  CustomFieldDef,
  DepartmentItem,
  EmailOutboxEntry,
  Incident,
  InvoiceRecord,
  KnowledgeArticle,
  LocationItem,
  PaymentTransaction,
  PlanCode,
  PlatformSettings,
  ProblemRecord,
  PurchaseOrder,
  PurchaseRequest,
  ScheduledReportConfig,
  ServiceCatalogueItem,
  ServiceContract,
  ServiceRequest,
  SlaPolicy,
  SoftwareLicence,
  SubscriptionPlan,
  Tenant,
  TenantApiKey,
  TenantContextPayload,
  TenantInvitation,
  TenantRole,
  TenantSubscription,
  TenantType,
  Ticket,
  TicketComment,
  TicketPriority,
  TicketStatus,
  Vendor,
  WebhookDelivery,
  WebhookEndpoint,
} from '../types/saas.ts';

const TOKEN_STORAGE_KEY = 'assetvault_session_token';
const TENANT_STORAGE_KEY = 'assetvault_active_tenant_id';
const ORG_STORAGE_KEY = 'assetvault_active_org_id';

const readCache = new Map<string, unknown>();

function cacheKey(
  path: string,
  tenantId: string | null = getActiveTenantId(),
  orgId: string | null = getActiveOrgId()
): string {
  return `${tenantId || ''}|${orgId || ''}|${path}`;
}

export function clearApiCache(): void {
  readCache.clear();
}

export function getStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      readCache.clear();
    }
  } catch {
    // Ignore storage errors
  }
}

export function getActiveTenantId(): string | null {
  try {
    return window.localStorage.getItem(TENANT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveTenantId(tenantId: string | null): void {
  try {
    const prev = getActiveTenantId();
    if (prev !== tenantId) {
      readCache.clear();
    }
    if (tenantId) {
      window.localStorage.setItem(TENANT_STORAGE_KEY, tenantId);
    } else {
      window.localStorage.removeItem(TENANT_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function getActiveOrgId(): string | null {
  try {
    return window.localStorage.getItem(ORG_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrgId(orgId: string | null): void {
  try {
    const prev = getActiveOrgId();
    if (prev !== orgId) {
      readCache.clear();
    }
    if (orgId) {
      window.localStorage.setItem(ORG_STORAGE_KEY, orgId);
    } else {
      window.localStorage.removeItem(ORG_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  options: { skipAuth?: boolean } = {}
): Promise<T> {
  const token = options.skipAuth ? null : getStoredToken();
  const activeTenantId = options.skipAuth ? null : getActiveTenantId();
  const activeOrgId = options.skipAuth ? null : getActiveOrgId();
  const method = (init.method || 'GET').toUpperCase();

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!options.skipAuth) {
    if (activeTenantId) headers.set('X-Tenant-Id', activeTenantId);
    if (activeOrgId) headers.set('X-Org-Id', activeOrgId);
  }

  const res = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      const trimmed = text.trim();
      const isHtml =
        trimmed.startsWith('<') || trimmed.toLowerCase().includes('<html');
      data = {
        error:
          isHtml && res.status === 403
            ? 'Session proxy returned HTTP 403. Reload the preview page (and allow third-party cookies) and try again.'
            : isHtml
              ? `Server returned HTTP ${res.status}. Please refresh the page and try again.`
              : trimmed,
      };
    }
  }

  if (!res.ok) {
    const message =
      typeof data.error === 'string' && data.error
        ? data.error
        : `Request failed with status ${res.status}`;
    const code = typeof data.code === 'string' ? data.code : undefined;
    throw new ApiError(message, res.status, code);
  }

  if (!options.skipAuth) {
    if (method === 'GET') {
      readCache.set(cacheKey(path, activeTenantId, activeOrgId), data);
    } else {
      readCache.clear();
    }
  }

  return data as T;
}

export interface ExtendedUser extends User {
  tenant_role?: TenantRole;
  org_access_mode?: 'all' | 'selected';
  allowed_org_ids?: string[];
  membership_status?: string;
}

export interface ExtendedTenantContext extends TenantContextPayload {
  isAllOrgsView: boolean;
  isSuperAdmin: boolean;
}

export interface WorkspaceBootstrapPayload {
  user: User;
  engine: string;
  context: ExtendedTenantContext;
  dashboard: DashboardSummary | null;
  assets: Asset[];
  employees: Employee[];
  assignments: AssetAssignment[];
  maintenanceLogs: MaintenanceLog[];
  notifications: SystemNotification[];
  users: ExtendedUser[];
  tickets: Ticket[];
  licences: SoftwareLicence[];
  purchaseOrders: PurchaseOrder[];
}

const PUBLIC_PLANS_CACHE_KEY = 'assetvault_public_plans_v1';
const PUBLIC_PLANS_TTL_MS = 60_000;
let cachedPublicPlans: {
  expiresAt: number;
  data: { plans: SubscriptionPlan[]; currency: 'GHS' };
} | null = null;
let publicPlansInFlight: Promise<{
  plans: SubscriptionPlan[];
  currency: 'GHS';
}> | null = null;

export type PlatformDbCollectionCategory =
  | 'Core SaaS'
  | 'ITAM & Custody'
  | 'ITSM & Helpdesk'
  | 'Procurement & Vendors'
  | 'Governance & Logs';

export interface PlatformDbCollectionMeta {
  name: string;
  label: string;
  category: PlatformDbCollectionCategory;
  tenantScoped: boolean;
  tenantField: 'tenantId' | 'tenant_id' | 'id' | null;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReset: boolean;
  count: number;
}

export interface PlatformDbSnapshot {
  generatedAt: string;
  plans: SubscriptionPlan[];
  platformSettings: PlatformSettings;
  tenants: Tenant[];
  clientOrganisations: ClientOrganisation[];
  locations: LocationItem[];
  departments: DepartmentItem[];
  memberships: Array<Record<string, unknown>>;
  subscriptions: TenantSubscription[];
  payments: PaymentTransaction[];
  invoices: InvoiceRecord[];
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
    department: string;
    status: string;
    is_super_admin: boolean;
  }>;
  assets: Asset[];
  employees: Employee[];
  assignments: AssetAssignment[];
  maintenance: MaintenanceLog[];
  assetTransfers: AssetTransfer[];
  softwareLicences: SoftwareLicence[];
  vendors: Vendor[];
  purchaseRequests: PurchaseRequest[];
  purchaseOrders: PurchaseOrder[];
  tickets: Ticket[];
  incidents: Incident[];
  problems: ProblemRecord[];
  changes: ChangeRequest[];
  serviceCatalogue: ServiceCatalogueItem[];
  serviceRequests: ServiceRequest[];
  slaPolicies: SlaPolicy[];
  contracts: ServiceContract[];
  knowledgeArticles: KnowledgeArticle[];
  customFields: CustomFieldDef[];
  auditLogs: AuditLogEntry[];
  platformAuditLogs: AuditLogEntry[];
}

export const api = {
  // Auth & Workspace Onboarding
  login: (email: string, password: string) =>
    request<
      | { token: string; user: User; engine: string; mfaRequired?: false }
      | { mfaRequired: true; mfaChallengeToken: string; email: string }
    >(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      },
      { skipAuth: true }
    ),
  verifyMfaLogin: (mfaChallengeToken: string, code: string) =>
    request<{ token: string; user: User; engine: string }>(
      '/api/auth/mfa/verify',
      {
        method: 'POST',
        body: JSON.stringify({ mfaChallengeToken, code }),
      },
      { skipAuth: true }
    ),
  getMfaStatus: () =>
    request<{ enabled: boolean; enrolled: boolean; recoveryCodesRemaining: number }>(
      '/api/auth/mfa/status'
    ),
  setupMfa: () =>
    request<{ secret: string; qrDataUrl: string; recoveryCodes: string[] }>(
      '/api/auth/mfa/setup',
      { method: 'POST' }
    ),
  enableMfa: (code: string) =>
    request<{ ok: boolean; recoveryCodes: string[] }>('/api/auth/mfa/enable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  disableMfa: (code: string) =>
    request<{ ok: boolean }>('/api/auth/mfa/disable', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  register: (payload: {
    name: string;
    email: string;
    password: string;
    companyName: string;
    tenantType: TenantType;
    planCode: PlanCode;
    country?: string;
    industry?: string;
  }) =>
    request<{ token: string; user: User; tenant: Tenant; engine: string }>(
      '/api/auth/register',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      },
      { skipAuth: true }
    ),
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message: string; testResetToken?: string }>(
      '/api/auth/forgot-password',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      },
      { skipAuth: true }
    ),
  resetPassword: (token: string, newPassword: string) =>
    request<{ ok: boolean }>(
      '/api/auth/reset-password',
      {
        method: 'POST',
        body: JSON.stringify({ token, newPassword }),
      },
      { skipAuth: true }
    ),
  acceptInvitation: (token: string, password: string) =>
    request<{ token: string; user: User }>(
      '/api/invitations/accept',
      {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      },
      { skipAuth: true }
    ),
  loginWithGoogle: (googleAccessToken: string) =>
    request<{ token: string; user: User; engine: string }>(
      '/api/auth/google',
      {
        method: 'POST',
        body: JSON.stringify({ accessToken: googleAccessToken }),
      },
      { skipAuth: true }
    ),
  getGitHubAuthUrl: () =>
    request<{ url: string; redirectUri: string }>(
      '/api/auth/github/url',
      {
        method: 'POST',
        body: JSON.stringify({ origin: window.location.origin }),
      },
      { skipAuth: true }
    ),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User; engine: string }>('/api/auth/me'),
  getContext: () => request<ExtendedTenantContext>('/api/auth/context'),
  peekCache: <T>(path: string): T | null =>
    (readCache.get(cacheKey(path)) as T | undefined) ?? null,
  bootstrap: async () => {
    const boot = await request<WorkspaceBootstrapPayload>('/api/bootstrap');
    const resolvedTid = boot.context.tenant.id;
    const resolvedOid = boot.context.isAllOrgsView ? 'all' : boot.context.activeOrg.id;
    const seedScope = (tid: string | null, oid: string | null) => {
      if (boot.dashboard) {
        readCache.set(cacheKey('/api/dashboard', tid, oid), boot.dashboard);
      }
      readCache.set(cacheKey('/api/assets', tid, oid), { assets: boot.assets });
      readCache.set(cacheKey('/api/employees', tid, oid), { employees: boot.employees });
      readCache.set(cacheKey('/api/assignments', tid, oid), { assignments: boot.assignments });
      readCache.set(cacheKey('/api/maintenance', tid, oid), { maintenanceLogs: boot.maintenanceLogs });
      readCache.set(cacheKey('/api/notifications', tid, oid), { notifications: boot.notifications });
      readCache.set(cacheKey('/api/users', tid, oid), { users: boot.users });
      readCache.set(cacheKey('/api/tickets', tid, oid), { tickets: boot.tickets });
      readCache.set(cacheKey('/api/licences', tid, oid), {
        licences: boot.licences,
        canViewKeys: boot.context.permissions.includes('licences.view_keys'),
      });
    };
    seedScope(resolvedTid, resolvedOid);
    seedScope(getActiveTenantId(), getActiveOrgId());
    return boot;
  },
  getPublicPlans: () => {
    const now = Date.now();
    if (cachedPublicPlans && cachedPublicPlans.expiresAt > now) {
      return Promise.resolve(cachedPublicPlans.data);
    }
    try {
      const raw = window.sessionStorage.getItem(PUBLIC_PLANS_CACHE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          expiresAt: number;
          data: { plans: SubscriptionPlan[]; currency: 'GHS' };
        };
        if (parsed && parsed.expiresAt > now && Array.isArray(parsed.data?.plans)) {
          cachedPublicPlans = parsed;
          return Promise.resolve(parsed.data);
        }
      }
    } catch {
      // Ignore storage errors
    }
    if (!publicPlansInFlight) {
      publicPlansInFlight = request<{ plans: SubscriptionPlan[]; currency: 'GHS' }>(
        '/api/billing/plans',
        {},
        { skipAuth: true }
      )
        .then((data) => {
          const entry = { expiresAt: Date.now() + PUBLIC_PLANS_TTL_MS, data };
          cachedPublicPlans = entry;
          try {
            window.sessionStorage.setItem(
              PUBLIC_PLANS_CACHE_KEY,
              JSON.stringify(entry)
            );
          } catch {
            // Ignore storage quota errors
          }
          return data;
        })
        .finally(() => {
          publicPlansInFlight = null;
        });
    }
    return publicPlansInFlight;
  },

  // Dashboard
  getDashboard: () => request<DashboardSummary>('/api/dashboard'),

  // Assets
  listAssets: () => request<{ assets: Asset[] }>('/api/assets'),
  getAssetDetail: (id: string) =>
    request<{
      asset: Asset;
      assignments: AssetAssignment[];
      maintenanceLogs: MaintenanceLog[];
      tickets?: Ticket[];
      transfers?: AssetTransfer[];
    }>(`/api/assets/${encodeURIComponent(id)}`),
  createAsset: (payload: Partial<Asset>) =>
    request<{ asset: Asset }>('/api/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  importAssets: (assetsPayload: Array<Partial<Asset>>) =>
    request<{
      importedCount: number;
      skipped: Array<{ row: number; reason: string }>;
      assets: Asset[];
    }>('/api/assets/import', {
      method: 'POST',
      body: JSON.stringify({ assets: assetsPayload }),
    }),
  updateAsset: (id: string, payload: Partial<Asset>) =>
    request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  transferAsset: (
    id: string,
    payload: {
      toLocation: string;
      toOrgId?: string;
      toDepartment?: string;
      reason: string;
    }
  ) =>
    request<{ transfer: AssetTransfer }>(
      `/api/assets/${encodeURIComponent(id)}/transfer`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  disposeAsset: (id: string, reason: string) =>
    request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}/dispose`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  deleteAsset: (id: string) =>
    request<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Employees
  listEmployees: () => request<{ employees: Employee[] }>('/api/employees'),
  getEmployeeDetail: (id: string) =>
    request<{
      employee: Employee;
      assignedAssets: Asset[];
      assignments: AssetAssignment[];
    }>(`/api/employees/${encodeURIComponent(id)}`),
  createEmployee: (payload: Partial<Employee>) =>
    request<{ employee: Employee }>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateEmployee: (id: string, payload: Partial<Employee>) =>
    request<{ employee: Employee }>(`/api/employees/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteEmployee: (id: string) =>
    request<{ ok: boolean }>(`/api/employees/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Assignments
  listAssignments: () =>
    request<{ assignments: AssetAssignment[] }>('/api/assignments'),
  assignAsset: (payload: {
    asset_id: string;
    employee_id: string;
    assigned_date: string;
    condition_out: string;
    notes: string;
  }) =>
    request<{ assignment: AssetAssignment }>('/api/assignments/assign', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  returnAsset: (
    assignmentId: string,
    payload: {
      returned_date: string;
      condition_in: string;
      return_status: 'Available' | 'Under Maintenance' | 'Damaged';
      notes: string;
    }
  ) =>
    request<{ assignment: AssetAssignment }>(
      `/api/assignments/${encodeURIComponent(assignmentId)}/return`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // Maintenance
  listMaintenance: () =>
    request<{ maintenanceLogs: MaintenanceLog[] }>('/api/maintenance'),
  createMaintenance: (payload: {
    asset_id: string;
    issue_description: string;
    maintenance_type: string;
    vendor_or_technician: string;
    service_date: string;
    next_service_date: string | null;
    cost: number;
    status: string;
    notes: string;
    set_asset_under_maintenance: boolean;
    ticket_id?: string | null;
    downtime_minutes?: number;
  }) =>
    request<{ maintenanceLog: MaintenanceLog }>('/api/maintenance', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMaintenance: (id: string, payload: Partial<MaintenanceLog>) =>
    request<{ maintenanceLog: MaintenanceLog }>(
      `/api/maintenance/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deleteMaintenance: (id: string) =>
    request<{ ok: boolean }>(`/api/maintenance/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Notifications
  listNotifications: () =>
    request<{ notifications: SystemNotification[] }>('/api/notifications'),
  acknowledgeNotifications: (alertKeys: string[]) =>
    request<{ notifications: SystemNotification[] }>(
      '/api/notifications/acknowledge',
      {
        method: 'POST',
        body: JSON.stringify({ alertKeys }),
      }
    ),

  // Users & Invitations
  listUsers: () => request<{ users: ExtendedUser[] }>('/api/users'),
  createUser: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    tenant_role?: TenantRole;
    department: string;
    status: 'active' | 'pending' | 'inactive';
    org_access_mode?: 'all' | 'selected';
    allowed_org_ids?: string[];
    mfa_enabled?: boolean;
  }) =>
    request<{ user: ExtendedUser }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    id: string,
    payload: {
      name: string;
      email: string;
      role: UserRole;
      tenant_role?: TenantRole;
      department: string;
      status: 'active' | 'pending' | 'inactive';
      password?: string;
      org_access_mode?: 'all' | 'selected';
      allowed_org_ids?: string[];
      mfa_enabled?: boolean;
    }
  ) =>
    request<{ user: ExtendedUser }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  listInvitations: () =>
    request<{ invitations: TenantInvitation[] }>('/api/invitations'),
  createInvitation: (payload: {
    email: string;
    name: string;
    role: TenantRole;
    orgAccessMode?: 'all' | 'selected';
    allowedOrgIds?: string[];
  }) =>
    request<{ invitation: TenantInvitation }>('/api/invitations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteInvitation: (id: string) =>
    request<{ ok: boolean }>(`/api/invitations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Org Structure (Client Orgs, Locations, Departments)
  listOrgs: () =>
    request<{
      organisations: ClientOrganisation[];
      locations: LocationItem[];
      departments: DepartmentItem[];
    }>('/api/orgs'),
  createClientOrg: (payload: Partial<ClientOrganisation>) =>
    request<{ organisation: ClientOrganisation }>(
      '/api/orgs/client-organisations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  createLocation: (payload: Partial<LocationItem>) =>
    request<{ location: LocationItem }>('/api/orgs/locations', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createDepartment: (payload: Partial<DepartmentItem>) =>
    request<{ department: DepartmentItem }>('/api/orgs/departments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteClientOrg: (id: string) =>
    request<{ ok: boolean }>(
      `/api/orgs/client-organisations/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
  deleteLocation: (id: string) =>
    request<{ ok: boolean }>(`/api/orgs/locations/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  deleteDepartment: (id: string) =>
    request<{ ok: boolean }>(
      `/api/orgs/departments/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),

  // Helpdesk Ticketing
  listTickets: () => request<{ tickets: Ticket[] }>('/api/tickets'),
  getTicketDetail: (id: string) =>
    request<{ ticket: Ticket; comments: TicketComment[] }>(
      `/api/tickets/${encodeURIComponent(id)}`
    ),
  createTicket: (payload: {
    subject: string;
    description: string;
    category: Ticket['category'];
    priority: TicketPriority;
    assetId?: string | null;
    orgId?: string;
  }) =>
    request<{ ticket: Ticket }>('/api/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTicket: (
    id: string,
    payload: {
      status?: TicketStatus;
      priority?: TicketPriority;
      assigneeId?: string | null;
      csatRating?: number;
      csatFeedback?: string;
    }
  ) =>
    request<{ ticket: Ticket }>(`/api/tickets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  addTicketComment: (
    id: string,
    payload: { body: string; isInternal: boolean }
  ) =>
    request<{ comment: TicketComment }>(
      `/api/tickets/${encodeURIComponent(id)}/comments`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  // ITSM Suite
  getItsm: () =>
    request<{
      incidents: Incident[];
      problems: ProblemRecord[];
      changes: ChangeRequest[];
      catalogue: ServiceCatalogueItem[];
      serviceRequests: ServiceRequest[];
    }>('/api/itsm'),
  createIncident: (payload: Partial<Incident>) =>
    request<{ incident: Incident }>('/api/itsm/incidents', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateIncident: (id: string, payload: Partial<Incident>) =>
    request<{ incident: Incident }>(
      `/api/itsm/incidents/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  createProblem: (payload: Partial<ProblemRecord>) =>
    request<{ problem: ProblemRecord }>('/api/itsm/problems', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createChange: (payload: Partial<ChangeRequest>) =>
    request<{ change: ChangeRequest }>('/api/itsm/changes', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approveChange: (id: string, decision: 'Approved' | 'Rejected') =>
    request<{ change: ChangeRequest }>(
      `/api/itsm/changes/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }
    ),
  createServiceRequest: (payload: {
    catalogueItemId: string;
    justification: string;
  }) =>
    request<{ serviceRequest: ServiceRequest }>('/api/itsm/service-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  approveServiceRequest: (
    id: string,
    status: 'Approved' | 'Rejected' | 'Fulfilled'
  ) =>
    request<{ serviceRequest: ServiceRequest }>(
      `/api/itsm/service-requests/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ status }),
      }
    ),

  // SLA Policies & Contracts
  listSlaPolicies: () => request<{ policies: SlaPolicy[] }>('/api/sla-policies'),
  createSlaPolicy: (payload: Partial<SlaPolicy>) =>
    request<{ policy: SlaPolicy }>('/api/sla-policies', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listContracts: () =>
    request<{ contracts: ServiceContract[] }>('/api/contracts'),
  createContract: (payload: Partial<ServiceContract>) =>
    request<{ contract: ServiceContract }>('/api/contracts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Software Licences
  listLicences: () =>
    request<{ licences: SoftwareLicence[]; canViewKeys: boolean }>(
      '/api/licences'
    ),
  createLicence: (payload: Partial<SoftwareLicence>) =>
    request<{ licence: SoftwareLicence }>('/api/licences', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Procurement
  getProcurement: () =>
    request<{
      vendors: Vendor[];
      purchaseRequests: PurchaseRequest[];
      purchaseOrders: PurchaseOrder[];
    }>('/api/procurement'),
  createVendor: (payload: Partial<Vendor>) =>
    request<{ vendor: Vendor }>('/api/procurement/vendors', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  createPurchaseRequest: (payload: Partial<PurchaseRequest>) =>
    request<{ purchaseRequest: PurchaseRequest }>(
      '/api/procurement/purchase-requests',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  approvePurchaseRequest: (id: string, decision: 'Approved' | 'Rejected') =>
    request<{ purchaseRequest: PurchaseRequest }>(
      `/api/procurement/purchase-requests/${encodeURIComponent(id)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ decision }),
      }
    ),
  createPurchaseOrder: (payload: Partial<PurchaseOrder>) =>
    request<{ purchaseOrder: PurchaseOrder }>(
      '/api/procurement/purchase-orders',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  receivePurchaseOrder: (id: string) =>
    request<{ purchaseOrder: PurchaseOrder; createdAssets: Asset[] }>(
      `/api/procurement/purchase-orders/${encodeURIComponent(id)}/receive`,
      {
        method: 'POST',
      }
    ),

  // Knowledge Base & Audit Logs & Jobs
  listKb: () => request<{ articles: KnowledgeArticle[] }>('/api/kb'),
  createKbArticle: (payload: Partial<KnowledgeArticle>) =>
    request<{ article: KnowledgeArticle }>('/api/kb', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  listAuditLogs: () => request<{ auditLogs: AuditLogEntry[] }>('/api/audit-logs'),
  runComplianceJobs: () =>
    request<{ ok: boolean; escalatedCount: number; alertsRecorded: number }>(
      '/api/jobs/run',
      { method: 'POST' }
    ),

  // Subscription & Paystack Billing
  getBilling: () =>
    request<{
      subscription: TenantSubscription;
      plan: SubscriptionPlan;
      plans: SubscriptionPlan[];
      payments: PaymentTransaction[];
      invoices: InvoiceRecord[];
      paystackConfigured: boolean;
    }>('/api/billing/subscription'),
  initPaystack: (planCode: PlanCode, billingCycle: BillingCycle) =>
    request<{
      payment: PaymentTransaction;
      mode: 'live' | 'test_simulation';
      authorizationUrl: string;
      reference: string;
    }>('/api/billing/subscribe/initialize', {
      method: 'POST',
      body: JSON.stringify({ planCode, billingCycle }),
    }),
  verifyPaystack: (reference: string) =>
    request<{
      ok: boolean;
      mode: 'live' | 'test_simulation';
      payment: PaymentTransaction;
      subscription: TenantSubscription | null;
      invoice: InvoiceRecord;
    }>('/api/billing/subscribe/verify', {
      method: 'POST',
      body: JSON.stringify({ reference }),
    }),

  // Platform Super Admin
  getPlatformOverview: () =>
    request<{
      kpis: {
        totalTenants: number;
        companyTenants: number;
        mspTenants: number;
        activeSubscriptions: number;
        trialTenants: number;
        totalUsers: number;
        totalAssets: number;
        mrrGhs: number;
        arrGhs: number;
        totalRevenueGhs: number;
      };
      tenants: Array<{
        tenant: Tenant;
        subscription: TenantSubscription | null;
        orgCount: number;
        userCount: number;
        assetCount: number;
      }>;
      plans: SubscriptionPlan[];
      payments: PaymentTransaction[];
      settings: PlatformSettings;
      platformAuditLogs: AuditLogEntry[];
    }>('/api/platform/overview'),
  createPlatformTenant: (payload: {
    companyName: string;
    tenantType: TenantType;
    ownerEmail: string;
    ownerName?: string;
    ownerPassword?: string;
    country?: string;
    industry?: string;
    primaryClientName?: string;
    primaryClientCode?: string;
    planCode: PlanCode;
    billingCycle: BillingCycle;
    subscriptionStatus: 'active' | 'trialing';
    trialDays?: number;
    deploymentMode?: Tenant['deploymentMode'];
    customDomain?: string;
    dedicatedProjectId?: string;
    recordInitialPayment?: boolean;
  }) =>
    request<{
      tenant: Tenant;
      subscription: TenantSubscription;
      owner: { id: string; name: string; email: string; isExisting: boolean };
      invoice: InvoiceRecord | null;
    }>('/api/platform/tenants', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePlatformTenant: (
    id: string,
    payload: {
      status?: Tenant['status'];
      planCode?: PlanCode;
      subscriptionStatus?: TenantSubscription['status'];
      deploymentMode?: Tenant['deploymentMode'];
      dedicatedConfig?: Tenant['dedicatedConfig'];
    }
  ) =>
    request<{ tenant: Tenant; subscription: TenantSubscription | null }>(
      `/api/platform/tenants/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  deletePlatformTenant: (id: string) =>
    request<{ ok: boolean }>(
      `/api/platform/tenants/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
  updatePlatformPlan: (
    code: PlanCode,
    payload: Partial<SubscriptionPlan>
  ) =>
    request<{ plan: SubscriptionPlan }>(
      `/api/platform/plans/${encodeURIComponent(code)}`,
      {
        method: 'PUT',
        body: JSON.stringify(payload),
      }
    ),
  recordManualPayment: (payload: {
    tenantId: string;
    planCode: PlanCode;
    billingCycle: BillingCycle;
    amountGhs: number;
  }) =>
    request<{
      payment: PaymentTransaction;
      subscription: TenantSubscription | null;
      invoice: InvoiceRecord;
    }>('/api/platform/payments/manual', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  refundPayment: (id: string, reason: string) =>
    request<{ payment: PaymentTransaction }>(
      `/api/platform/payments/${encodeURIComponent(id)}/refund`,
      {
        method: 'POST',
        body: JSON.stringify({ reason }),
      }
    ),
  updatePlatformSettings: (payload: Partial<PlatformSettings>) =>
    request<{ settings: PlatformSettings }>('/api/platform/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  resetPlatformDatabase: (confirm: string) =>
    request<{ ok: boolean; message: string }>('/api/platform/reset-database', {
      method: 'POST',
      body: JSON.stringify({ confirm }),
    }),
  getPlatformEmailOutbox: () =>
    request<{ outbox: EmailOutboxEntry[] }>('/api/platform/email/outbox'),
  sendPlatformTestEmail: (to: string) =>
    request<{ ok: boolean; entry: EmailOutboxEntry }>('/api/platform/email/test', {
      method: 'POST',
      body: JSON.stringify({ to }),
    }),

  // Platform Super Admin Database Manager (/api/platform/database/*)
  getPlatformDatabaseOverview: (tenantId?: string) =>
    request<{
      engine: string;
      collections: PlatformDbCollectionMeta[];
      tenants: Array<{
        id: string;
        name: string;
        type: TenantType;
        planCode: PlanCode;
        status: Tenant['status'];
      }>;
    }>(
      tenantId
        ? `/api/platform/database/overview?tenantId=${encodeURIComponent(tenantId)}`
        : '/api/platform/database/overview'
    ),
  getPlatformDatabaseRecords: (params: {
    collection: string;
    tenantId?: string;
    q?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('collection', params.collection);
    if (params.tenantId) qs.set('tenantId', params.tenantId);
    if (params.q) qs.set('q', params.q);
    if (params.limit) qs.set('limit', String(params.limit));
    return request<{
      collection: string;
      meta: PlatformDbCollectionMeta;
      totalCount: number;
      records: Array<Record<string, unknown>>;
    }>(`/api/platform/database/records?${qs.toString()}`);
  },
  createPlatformDatabaseRecord: (
    collection: string,
    record: Record<string, unknown>
  ) =>
    request<{ record: Record<string, unknown> }>('/api/platform/database/records', {
      method: 'POST',
      body: JSON.stringify({ collection, record }),
    }),
  updatePlatformDatabaseRecord: (
    collection: string,
    id: string,
    record: Record<string, unknown>
  ) =>
    request<{ record: Record<string, unknown> }>(
      `/api/platform/database/records/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ record }),
      }
    ),
  deletePlatformDatabaseRecord: (collection: string, id: string) =>
    request<{ ok: boolean }>(
      `/api/platform/database/records/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
      }
    ),
  runPlatformTenantDatabaseOp: (payload: {
    tenantId: string;
    action:
      | 'delete_collection_data'
      | 'reset_tenant_workspace'
      | 'delete_tenant_completely';
    collection?: string;
  }) =>
    request<{ ok: boolean; removedCount: number; message: string }>(
      '/api/platform/database/tenant-operations',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  resetPlatformIndividualCollection: (payload: {
    collection: string;
    tenantId?: string;
    confirm: string;
  }) =>
    request<{ ok: boolean; removedCount: number; message: string }>(
      '/api/platform/database/reset-collection',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  getPlatformDatabaseSnapshot: (tenantId?: string) =>
    request<PlatformDbSnapshot>(
      tenantId
        ? `/api/platform/database/snapshot?tenantId=${encodeURIComponent(tenantId)}`
        : '/api/platform/database/snapshot'
    ),
  recordPlatformAuditLog: (payload: {
    action: string;
    entityType: string;
    entityId: string;
    tenantId?: string;
    summary: string;
  }) =>
    request<{ auditLog: AuditLogEntry }>('/api/platform/audit-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // Workspace Settings & Currency
  updateWorkspaceSettings: (payload: {
    name?: string;
    country?: string;
    supportEmail?: string;
    currency?: CurrencyCode;
  }) =>
    request<{ tenant: Tenant }>('/api/workspace/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  // Document & Image Attachments
  getAttachments: (
    entityType: AttachmentItem['entityType'],
    entityId: string
  ) =>
    request<{ attachments: AttachmentItem[] }>(
      `/api/attachments?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`
    ),
  uploadAttachment: (payload: {
    entityType: AttachmentItem['entityType'];
    entityId: string;
    orgId?: string;
    fileName: string;
    mimeType: string;
    dataUrl: string;
  }) =>
    request<{ attachment: AttachmentItem }>('/api/attachments', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteAttachment: (id: string) =>
    request<{ ok: boolean }>(`/api/attachments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  // Custom Fields Builder & Values
  getCustomFields: (entityType?: CustomFieldDef['entityType']) =>
    request<{ fields: CustomFieldDef[] }>(
      entityType
        ? `/api/custom-fields?entityType=${encodeURIComponent(entityType)}`
        : '/api/custom-fields'
    ),
  createCustomField: (payload: {
    entityType: CustomFieldDef['entityType'];
    label: string;
    fieldType: CustomFieldDef['fieldType'];
    options?: string[];
    required?: boolean;
  }) =>
    request<{ field: CustomFieldDef }>('/api/custom-fields', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteCustomField: (id: string) =>
    request<{ ok: boolean }>(`/api/custom-fields/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  getCustomFieldValues: (
    entityType: CustomFieldDef['entityType'],
    entityId: string
  ) =>
    request<{ values: Record<string, string> }>(
      `/api/custom-fields/values/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`
    ),
  saveCustomFieldValues: (
    entityType: CustomFieldDef['entityType'],
    entityId: string,
    values: Record<string, string>
  ) =>
    request<{ values: Record<string, string> }>(
      `/api/custom-fields/values/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ values }),
      }
    ),

  // API Keys & Outbound Webhooks
  getApiKeys: () => request<{ apiKeys: TenantApiKey[] }>('/api/integrations/api-keys'),
  createApiKey: (name: string, scopes: string[]) =>
    request<{ apiKey: TenantApiKey; plaintextKey: string }>(
      '/api/integrations/api-keys',
      {
        method: 'POST',
        body: JSON.stringify({ name, scopes }),
      }
    ),
  revokeApiKey: (id: string) =>
    request<{ ok: boolean }>(
      `/api/integrations/api-keys/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  getWebhooks: () =>
    request<{ webhooks: WebhookEndpoint[]; deliveries: WebhookDelivery[] }>(
      '/api/integrations/webhooks'
    ),
  createWebhook: (payload: { name: string; url: string; events: string[] }) =>
    request<{ webhook: WebhookEndpoint; signingSecret: string }>(
      '/api/integrations/webhooks',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  testWebhook: (id: string) =>
    request<{ delivery: WebhookDelivery | null }>(
      `/api/integrations/webhooks/${encodeURIComponent(id)}/test`,
      { method: 'POST' }
    ),
  deleteWebhook: (id: string) =>
    request<{ ok: boolean }>(
      `/api/integrations/webhooks/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),

  // Scheduled Reports & Email Outbox
  getScheduledReports: () =>
    request<{ schedules: ScheduledReportConfig[]; outbox: EmailOutboxEntry[] }>(
      '/api/automation/schedules'
    ),
  createScheduledReport: (payload: {
    name: string;
    reportType: ScheduledReportConfig['reportType'];
    frequency: ScheduledReportConfig['frequency'];
    recipients: string[];
  }) =>
    request<{ schedule: ScheduledReportConfig }>('/api/automation/schedules', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  runScheduledReport: (id: string) =>
    request<{
      ok: boolean;
      schedule: ScheduledReportConfig;
      digest: { subject: string; text: string };
    }>(`/api/automation/schedules/${encodeURIComponent(id)}/run`, {
      method: 'POST',
    }),
  deleteScheduledReport: (id: string) =>
    request<{ ok: boolean }>(
      `/api/automation/schedules/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  runComplianceSweep: (forceReports = false) =>
    request<{
      ok: boolean;
      escalatedCount: number;
      alertsRecorded: number;
      reportsDispatched: number;
    }>('/api/jobs/run', {
      method: 'POST',
      body: JSON.stringify({ forceReports }),
    }),
};
