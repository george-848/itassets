export const ASSET_CATEGORIES = [
  'Laptops',
  'Desktops',
  'Printers',
  'Servers',
  'Networking Equipment',
  'UPS',
  'Monitors',
  'CCTV',
  'Accessories',
] as const;

export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export const ASSET_STATUSES = [
  'Available',
  'Assigned',
  'Under Maintenance',
  'Retired',
  'Damaged',
] as const;

export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const MAINTENANCE_TYPES = [
  'Preventive',
  'Repair',
  'Upgrade',
  'Inspection',
] as const;

export type MaintenanceType = (typeof MAINTENANCE_TYPES)[number];

export const MAINTENANCE_STATUSES = [
  'Scheduled',
  'In Progress',
  'Completed',
] as const;

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export type UserRole = 'admin' | 'staff';

export const DEPARTMENTS = [
  'IT Infrastructure',
  'Engineering',
  'Finance',
  'Operations',
  'Human Resources',
  'Sales & Marketing',
  'Facilities & Security',
  'Executive',
] as const;

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  status: 'active' | 'pending' | 'inactive';
  created_at: string;
  last_login: string | null;
  email_verified?: boolean;
  mfa_enabled?: boolean;
  is_super_admin?: boolean;
}

export interface Employee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  department: string;
  job_title: string;
  phone: string;
  location: string;
  status: 'active' | 'inactive';
  created_at: string;
  assigned_count?: number;
  tenant_id?: string;
  org_id?: string;
  location_id?: string;
  department_id?: string;
}

export interface AssetSpecs {
  cpu?: string;
  ram?: string;
  storage?: string;
  os?: string;
  ip_address?: string;
  mac_address?: string;
  hostname?: string;
  custom_attributes?: Record<string, string>;
}

export interface Asset {
  id: string;
  asset_tag: string;
  name: string;
  category: AssetCategory;
  brand: string;
  model: string;
  serial_number: string;
  purchase_date: string;
  cost: number;
  warranty_expiry: string;
  status: AssetStatus;
  assigned_employee_id: string | null;
  assigned_date: string | null;
  location: string;
  notes: string;
  created_at: string;
  updated_at: string;
  assigned_employee_name?: string | null;
  assigned_employee_department?: string | null;
  assigned_employee_code?: string | null;
  // Multi-tenant & Extended Enterprise ITAM fields
  tenant_id?: string;
  org_id?: string;
  org_name?: string;
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

export interface AssetAssignment {
  id: string;
  asset_id: string;
  employee_id: string;
  assigned_by_user_id: string;
  assigned_date: string;
  returned_date: string | null;
  condition_out: string;
  condition_in: string | null;
  handover_number: string;
  notes: string;
  status: 'Active' | 'Returned';
  created_at: string;
  asset_tag?: string;
  asset_name?: string;
  asset_category?: AssetCategory;
  asset_brand?: string;
  asset_model?: string;
  asset_serial?: string;
  employee_name?: string;
  employee_code?: string;
  employee_department?: string;
  employee_email?: string;
  assigned_by_name?: string;
  tenant_id?: string;
  org_id?: string;
}

export interface MaintenanceLog {
  id: string;
  asset_id: string;
  issue_description: string;
  maintenance_type: MaintenanceType;
  vendor_or_technician: string;
  service_date: string;
  next_service_date: string | null;
  cost: number;
  status: MaintenanceStatus;
  recorded_by_user_id: string;
  notes: string;
  created_at: string;
  asset_tag?: string;
  asset_name?: string;
  asset_category?: AssetCategory;
  asset_brand?: string;
  asset_model?: string;
  recorded_by_name?: string;
  tenant_id?: string;
  org_id?: string;
  ticket_id?: string | null;
  downtime_minutes?: number;
}

export type NotificationType =
  | 'expiring_warranty'
  | 'overdue_maintenance'
  | 'replacement_due'
  | 'sla_breach'
  | 'licence_expiry'
  | 'subscription_alert';

export interface SystemNotification {
  id: string;
  type: NotificationType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  entity_type: 'asset' | 'maintenance' | 'ticket' | 'licence' | 'subscription';
  entity_id: string;
  asset_id: string;
  asset_tag: string;
  asset_name: string;
  due_date: string;
  acknowledged: boolean;
  acknowledged_at: string | null;
}

export interface DashboardSummary {
  counts: {
    totalAssets: number;
    assignedAssets: number;
    availableAssets: number;
    underMaintenance: number;
    retiredOrDamaged: number;
    activeEmployees: number;
    openMaintenance: number;
    openTickets?: number;
    slaBreachedTickets?: number;
    activeLicences?: number;
    activeContracts?: number;
  };
  financials: {
    totalAssetValue: number;
    totalMaintenanceCost: number;
    annualLicenceSpend?: number;
  };
  categoryBreakdown: Array<{
    category: string;
    total: number;
    assigned: number;
    available: number;
    maintenance: number;
    value: number;
  }>;
  statusBreakdown: Array<{
    status: AssetStatus;
    count: number;
  }>;
  monthlyMaintenance: Array<{
    month: string;
    cost: number;
    count: number;
  }>;
  recentAssignments: AssetAssignment[];
  recentMaintenance: MaintenanceLog[];
  unreadAlertsCount: number;
  criticalAlerts: SystemNotification[];
}
