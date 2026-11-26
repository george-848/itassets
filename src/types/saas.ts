export type TenantType = 'company' | 'msp';
export type TenantStatus = 'active' | 'trial' | 'grace' | 'suspended';
export type DeploymentMode = 'shared_cloud' | 'dedicated_enterprise';
export type PlanCode = 'starter' | 'professional' | 'business' | 'enterprise';
export type BillingCycle = 'monthly' | 'annual';
export type CurrencyCode = 'USD' | 'GHS' | 'EUR' | 'GBP';

export type TenantRole =
  | 'tenant_owner'
  | 'tenant_admin'
  | 'it_manager'
  | 'it_technician'
  | 'asset_manager'
  | 'dept_manager'
  | 'employee'
  | 'auditor'
  | 'msp_admin'
  | 'msp_manager'
  | 'msp_technician'
  | 'msp_viewer';

export type PermissionCode =
  | 'dashboard.read'
  | 'assets.read'
  | 'assets.create'
  | 'assets.update'
  | 'assets.delete'
  | 'assets.import'
  | 'assets.transfer'
  | 'assets.dispose'
  | 'assignments.read'
  | 'assignments.manage'
  | 'maintenance.read'
  | 'maintenance.manage'
  | 'employees.read'
  | 'employees.manage'
  | 'tickets.read'
  | 'tickets.create'
  | 'tickets.assign'
  | 'tickets.resolve'
  | 'tickets.internal_notes'
  | 'itsm.read'
  | 'itsm.manage'
  | 'itsm.approve'
  | 'sla.read'
  | 'sla.manage'
  | 'contracts.read'
  | 'contracts.manage'
  | 'licences.read'
  | 'licences.manage'
  | 'licences.view_keys'
  | 'procurement.read'
  | 'procurement.create'
  | 'procurement.approve'
  | 'kb.read'
  | 'kb.manage'
  | 'org.read'
  | 'org.manage'
  | 'users.read'
  | 'users.manage'
  | 'reports.read'
  | 'audit.read'
  | 'billing.read'
  | 'billing.manage'
  | 'platform.manage';

export type FeatureKey =
  | 'msp_mode'
  | 'helpdesk'
  | 'itsm_suite'
  | 'sla_automation'
  | 'software_licences'
  | 'procurement'
  | 'knowledge_base'
  | 'bulk_import'
  | 'qr_barcode'
  | 'audit_logs'
  | 'custom_fields'
  | 'api_webhooks'
  | 'sso_scim'
  | 'dedicated_deployment';

export interface PlanLimits {
  maxAssets: number | null;
  maxUsers: number | null;
  maxLocations: number | null;
  maxClientOrgs: number | null;
  maxTicketsPerMonth: number | null;
  maxStorageMb?: number | null;
}

export interface SubscriptionPlan {
  id: string;
  code: PlanCode;
  name: string;
  tagline: string;
  monthlyPriceGhs: number;
  annualPriceGhs: number;
  isPublic: boolean;
  isCustomAnnual?: boolean;
  limits: PlanLimits;
  features: FeatureKey[];
  updatedAt: string;
}

export interface TenantSubscription {
  id: string;
  tenantId: string;
  planCode: PlanCode;
  billingCycle: BillingCycle;
  status: 'trialing' | 'active' | 'grace_period' | 'past_due' | 'cancelled' | 'expired';
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  graceEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  amountGhs: number;
  customOverrides?: Partial<PlanLimits> & { features?: FeatureKey[] };
  updatedAt: string;
}

export interface PaymentTransaction {
  id: string;
  tenantId: string;
  subscriptionId: string;
  reference: string;
  provider: 'paystack' | 'manual';
  planCode: PlanCode;
  billingCycle: BillingCycle;
  amountGhs: number;
  currency: 'GHS';
  status: 'pending' | 'success' | 'failed' | 'refunded';
  channel?: string;
  paidAt: string | null;
  refundedAt?: string | null;
  refundReason?: string | null;
  createdBy: string;
  createdAt: string;
}

export interface InvoiceRecord {
  id: string;
  invoiceNumber: string;
  tenantId: string;
  paymentId: string;
  planName: string;
  billingCycle: BillingCycle;
  amountGhs: number;
  status: 'paid' | 'pending' | 'refunded' | 'void';
  issuedAt: string;
  dueAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  type: TenantType;
  status: TenantStatus;
  ownerUserId: string;
  planCode: PlanCode;
  deploymentMode: DeploymentMode;
  dedicatedConfig?: {
    dedicatedProjectId?: string;
    dedicatedRegion?: string;
    customDomain?: string;
    isolationTier?: 'dedicated_schema' | 'dedicated_cluster';
  };
  supportEmail: string;
  country: string;
  currency?: CurrencyCode;
  createdAt: string;
  updatedAt: string;
}

export interface ClientOrganisation {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  industry: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  address: string;
  status: 'active' | 'inactive';
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocationItem {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  code: string;
  city: string;
  country: string;
  address: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface DepartmentItem {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  code: string;
  managerName: string;
  costCenter: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface UserMembership {
  id: string;
  userId: string;
  tenantId: string;
  role: TenantRole;
  status: 'active' | 'invited' | 'suspended';
  orgAccessMode: 'all' | 'selected';
  allowedOrgIds: string[];
  customPermissions?: PermissionCode[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantInvitation {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: TenantRole;
  orgAccessMode: 'all' | 'selected';
  allowedOrgIds: string[];
  token: string;
  status: 'pending' | 'accepted' | 'revoked';
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

export interface AssetTransfer {
  id: string;
  tenantId: string;
  orgId: string;
  assetId: string;
  assetTag: string;
  assetName: string;
  fromLocation: string;
  toLocation: string;
  fromOrgId: string;
  toOrgId: string;
  fromDepartment: string;
  toDepartment: string;
  reason: string;
  transferredBy: string;
  transferredAt: string;
}

export interface SoftwareLicence {
  id: string;
  tenantId: string;
  orgId: string;
  softwareName: string;
  vendor: string;
  licenceType: 'Per Seat' | 'Site' | 'Enterprise' | 'Subscription';
  licenceKey: string;
  maskedKey?: string;
  totalSeats: number;
  assignedSeats: number;
  assignedEmployeeIds: string[];
  costPerYearGhs: number;
  purchaseDate: string;
  expiryDate: string;
  autoRenew: boolean;
  status: 'Active' | 'Expiring Soon' | 'Expired';
  notes: string;
  createdAt: string;
}

export interface Vendor {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  category: string;
  contactName: string;
  email: string;
  phone: string;
  website: string;
  paymentTerms: string;
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface PurchaseRequest {
  id: string;
  tenantId: string;
  orgId: string;
  requestNumber: string;
  title: string;
  category: string;
  quantity: number;
  estimatedCostGhs: number;
  justification: string;
  requestedByUserId: string;
  requestedByName: string;
  status: 'Pending Approval' | 'Approved' | 'Rejected' | 'Ordered';
  approvedByUserId: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface PurchaseOrder {
  id: string;
  tenantId: string;
  orgId: string;
  poNumber: string;
  prId: string | null;
  vendorId: string;
  vendorName: string;
  itemName: string;
  category: string;
  brand: string;
  model: string;
  quantity: number;
  unitCostGhs: number;
  totalCostGhs: number;
  expectedDeliveryDate: string;
  status: 'Issued' | 'Partially Received' | 'Received' | 'Cancelled';
  receivedAssetIds: string[];
  createdBy: string;
  createdAt: string;
}

export type TicketPriority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TicketStatus =
  | 'Open'
  | 'In Progress'
  | 'Waiting on User'
  | 'Escalated'
  | 'Resolved'
  | 'Closed';

export interface TicketComment {
  id: string;
  tenantId: string;
  orgId: string;
  ticketId: string;
  authorId: string;
  authorName: string;
  isInternal: boolean;
  body: string;
  createdAt: string;
}

export interface Ticket {
  id: string;
  tenantId: string;
  orgId: string;
  orgName?: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: 'Hardware' | 'Software' | 'Network' | 'Access' | 'Procurement' | 'General';
  priority: TicketPriority;
  status: TicketStatus;
  requesterId: string;
  requesterName: string;
  requesterEmail: string;
  assigneeId: string | null;
  assigneeName: string | null;
  assetId: string | null;
  assetTag: string | null;
  slaPolicyId: string | null;
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  resolutionDueAt: string | null;
  resolvedAt: string | null;
  slaBreached: boolean;
  escalationLevel: number;
  csatRating: number | null;
  csatFeedback: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Incident {
  id: string;
  tenantId: string;
  orgId: string;
  incidentNumber: string;
  title: string;
  description: string;
  impact: 'Low' | 'Medium' | 'High' | 'Enterprise-Wide';
  urgency: 'Low' | 'Medium' | 'High' | 'Critical';
  severity: 'SEV-4' | 'SEV-3' | 'SEV-2' | 'SEV-1';
  status: 'Detected' | 'Investigating' | 'Mitigated' | 'Resolved' | 'Post-Mortem';
  affectedAssetIds: string[];
  linkedProblemId: string | null;
  commanderName: string;
  rootCauseSummary: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ProblemRecord {
  id: string;
  tenantId: string;
  orgId: string;
  problemNumber: string;
  title: string;
  symptomSummary: string;
  rootCause: string;
  workaround: string;
  knownError: boolean;
  status: 'Open' | 'Root Cause Analysis' | 'Known Error' | 'Resolved';
  linkedIncidentIds: string[];
  ownerName: string;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  tenantId: string;
  orgId: string;
  changeNumber: string;
  title: string;
  changeType: 'Standard' | 'Normal' | 'Emergency';
  riskLevel: 'Low' | 'Medium' | 'High';
  implementationPlan: string;
  rollbackPlan: string;
  scheduledStart: string;
  scheduledEnd: string;
  status: 'Draft' | 'Pending CAB Approval' | 'Approved' | 'Scheduled' | 'Implemented' | 'Rejected';
  requestedByName: string;
  approvedByName: string | null;
  linkedAssetIds: string[];
  createdAt: string;
}

export interface ServiceCatalogueItem {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  category: string;
  description: string;
  estimatedFulfilmentHours: number;
  requiresApproval: boolean;
  defaultCostGhs: number;
  status: 'active' | 'archived';
}

export interface ServiceRequest {
  id: string;
  tenantId: string;
  orgId: string;
  requestNumber: string;
  catalogueItemId: string;
  itemName: string;
  requesterId: string;
  requesterName: string;
  justification: string;
  status: 'Submitted' | 'Pending Approval' | 'Approved' | 'In Fulfilment' | 'Fulfilled' | 'Rejected';
  approvedByName: string | null;
  createdAt: string;
}

export interface SlaPolicy {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  priority: TicketPriority;
  firstResponseMinutes: number;
  resolutionMinutes: number;
  businessHoursOnly: boolean;
  escalationMinutesBeforeBreach: number;
  isDefault: boolean;
  createdAt: string;
}

export interface ServiceContract {
  id: string;
  tenantId: string;
  orgId: string;
  contractNumber: string;
  title: string;
  clientOrgName: string;
  vendorOrProvider: string;
  contractType: 'MSP Retainer' | 'Hardware Warranty' | 'Maintenance SLA' | 'Software Enterprise';
  startDate: string;
  endDate: string;
  annualValueGhs: number;
  autoRenew: boolean;
  status: 'Active' | 'Expiring Soon' | 'Expired';
  notes: string;
  createdAt: string;
}

export interface KnowledgeArticle {
  id: string;
  tenantId: string;
  orgId: string;
  title: string;
  category: string;
  visibility: 'public_portal' | 'internal_it';
  summary: string;
  content: string;
  tags: string[];
  helpfulCount: number;
  authorName: string;
  updatedAt: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string;
  orgId: string;
  actorUserId: string;
  actorEmail: string;
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  createdAt: string;
}

export interface CustomFieldDef {
  id: string;
  tenantId: string;
  entityType: 'asset' | 'ticket' | 'employee';
  fieldKey: string;
  label: string;
  fieldType: 'text' | 'number' | 'date' | 'select';
  options?: string[];
  required: boolean;
}

export interface PlatformSettings {
  platformName: string;
  supportEmail: string;
  defaultCurrency: 'GHS';
  trialDays: number;
  gracePeriodDays: number;
  paystackConfigured: boolean;
  paystackPublicKeyHint: string;
  smtpConfigured: boolean;
  maintenanceMode: boolean;
  updatedAt: string;
}

export interface WorkspaceUsage {
  assetsCount: number;
  usersCount: number;
  locationsCount: number;
  clientOrgsCount: number;
  ticketsThisMonth: number;
  storageUsedBytes?: number;
}

export interface AttachmentItem {
  id: string;
  tenantId: string;
  orgId: string;
  entityType: 'asset' | 'maintenance' | 'ticket' | 'po' | 'contract';
  entityId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
  uploadedByUserId: string;
  uploadedByName: string;
  createdAt: string;
}

export interface TenantApiKey {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  createdBy: string;
  lastUsedAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface WebhookEndpoint {
  id: string;
  tenantId: string;
  name: string;
  url: string;
  events: string[];
  active: boolean;
  createdBy: string;
  createdAt: string;
  lastTriggeredAt: string | null;
}

export interface WebhookDelivery {
  id: string;
  tenantId: string;
  webhookId: string;
  event: string;
  statusCode: number | null;
  ok: boolean;
  responseSnippet: string;
  deliveredAt: string;
}

export interface ScheduledReportConfig {
  id: string;
  tenantId: string;
  orgId: string;
  name: string;
  reportType:
    | 'inventory'
    | 'maintenance'
    | 'warranty'
    | 'tickets'
    | 'licences'
    | 'depreciation';
  frequency: 'daily' | 'weekly' | 'monthly';
  recipients: string[];
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdBy: string;
  createdAt: string;
}

export interface EmailOutboxEntry {
  id: string;
  tenantId: string;
  to: string;
  subject: string;
  bodyPreview: string;
  status: 'sent' | 'logged_local' | 'failed';
  error?: string;
  sentAt: string;
}

export interface TenantContextPayload {
  tenant: Tenant;
  activeOrg: ClientOrganisation;
  availableOrgs: ClientOrganisation[];
  availableTenants: Array<{
    tenant: Tenant;
    role: TenantRole;
  }>;
  membership: UserMembership;
  permissions: PermissionCode[];
  subscription: TenantSubscription;
  plan: SubscriptionPlan;
  effectiveLimits: PlanLimits;
  effectiveFeatures: FeatureKey[];
  usage: WorkspaceUsage;
  isReadOnlyGraceOrExpired: boolean;
}
