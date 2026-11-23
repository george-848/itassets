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
}

export type NotificationType =
  | 'expiring_warranty'
  | 'overdue_maintenance'
  | 'replacement_due';

export interface SystemNotification {
  id: string;
  type: NotificationType;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  description: string;
  entity_type: 'asset' | 'maintenance';
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
  };
  financials: {
    totalAssetValue: number;
    totalMaintenanceCost: number;
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
