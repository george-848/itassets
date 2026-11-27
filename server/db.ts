import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MongoClient, type Db } from 'mongodb';
import { createSeedData, type StoredUser } from './seed.ts';
import type {
  Asset,
  AssetAssignment,
  AssetStatus,
  DashboardSummary,
  Employee,
  MaintenanceLog,
  SystemNotification,
  User,
} from '../src/types/itams.ts';

export type DatabaseEngine = 'mongodb' | 'sqlite';

export interface NotificationAck {
  id: string;
  alert_key: string;
  user_id: string;
  acknowledged_at: string;
}

export interface TenantScopeFilter {
  tenantId: string;
  orgIds?: string[] | null;
}

export interface ItamsDatabase {
  readonly engine: DatabaseEngine;
  init(): Promise<void>;

  // Auth & Users
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(id: string): Promise<User | null>;
  updateUserLastLogin(id: string, isoTimestamp: string): Promise<void>;
  listUsers(): Promise<User[]>;
  createUser(user: StoredUser): Promise<User>;
  updateUser(
    id: string,
    patch: Partial<
      Pick<
        StoredUser,
        | 'name'
        | 'email'
        | 'role'
        | 'department'
        | 'status'
        | 'password_hash'
        | 'email_verified'
        | 'mfa_enabled'
        | 'is_super_admin'
      >
    >
  ): Promise<User | null>;
  deleteUser(id: string): Promise<boolean>;

  // Employees
  listEmployees(scope?: TenantScopeFilter): Promise<Employee[]>;
  getEmployeeById(id: string): Promise<Employee | null>;
  createEmployee(employee: Employee): Promise<Employee>;
  updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee | null>;
  deleteEmployee(id: string): Promise<boolean>;

  // Assets
  countAssets(scope?: TenantScopeFilter): Promise<number>;
  listAssets(scope?: TenantScopeFilter): Promise<Asset[]>;
  getAssetById(id: string): Promise<Asset | null>;
  createAsset(asset: Asset): Promise<Asset>;
  updateAsset(id: string, patch: Partial<Asset>): Promise<Asset | null>;
  deleteAsset(id: string): Promise<boolean>;

  // Assignments
  listAssignments(scope?: TenantScopeFilter): Promise<AssetAssignment[]>;
  listAssignmentsByAsset(assetId: string): Promise<AssetAssignment[]>;
  listAssignmentsByEmployee(employeeId: string): Promise<AssetAssignment[]>;
  getAssignmentById(id: string): Promise<AssetAssignment | null>;
  assignAsset(params: {
    assetId: string;
    employeeId: string;
    assignedByUserId: string;
    assignedDate: string;
    conditionOut: string;
    notes: string;
    tenantId?: string;
    orgId?: string;
  }): Promise<AssetAssignment>;
  returnAsset(params: {
    assignmentId: string;
    returnedDate: string;
    conditionIn: string;
    returnStatus: 'Available' | 'Under Maintenance' | 'Damaged';
    notes: string;
  }): Promise<AssetAssignment>;
  updateAssignment(
    id: string,
    patch: Partial<Pick<AssetAssignment, 'condition_out' | 'condition_in' | 'notes' | 'assigned_date' | 'returned_date' | 'status'>>
  ): Promise<AssetAssignment | null>;
  deleteAssignment(id: string): Promise<boolean>;

  // Maintenance
  listMaintenanceLogs(scope?: TenantScopeFilter): Promise<MaintenanceLog[]>;
  listMaintenanceByAsset(assetId: string): Promise<MaintenanceLog[]>;
  getMaintenanceById(id: string): Promise<MaintenanceLog | null>;
  createMaintenanceLog(
    log: MaintenanceLog,
    setAssetUnderMaintenance: boolean
  ): Promise<MaintenanceLog>;
  updateMaintenanceLog(
    id: string,
    patch: Partial<MaintenanceLog>
  ): Promise<MaintenanceLog | null>;
  deleteMaintenanceLog(id: string): Promise<boolean>;

  // Notifications & Dashboard
  listNotifications(userId: string, scope?: TenantScopeFilter): Promise<SystemNotification[]>;
  acknowledgeNotifications(userId: string, alertKeys: string[]): Promise<void>;
  getDashboardSummary(userId: string, scope?: TenantScopeFilter): Promise<DashboardSummary>;
  resetToCleanState(): Promise<void>;
}

function matchesScope<T extends { tenant_id?: string; org_id?: string }>(
  row: T,
  scope?: TenantScopeFilter
): boolean {
  if (!scope) return true;
  const rowTenant = row.tenant_id || 'ten-default-01';
  if (rowTenant !== scope.tenantId) return false;
  if (scope.orgIds && scope.orgIds.length >= 0) {
    const rowOrg = row.org_id || 'org-default-01';
    return scope.orgIds.includes(rowOrg);
  }
  return true;
}

function normalizeUserRecord(user: StoredUser): StoredUser {
  return {
    ...user,
    email_verified:
      user.email_verified === undefined ? true : Boolean(user.email_verified),
    mfa_enabled: Boolean(user.mfa_enabled),
    is_super_admin: Boolean(user.is_super_admin),
  };
}

function stripPassword(user: StoredUser): User {
  const normalized = normalizeUserRecord(user);
  const { password_hash: _ignored, ...safe } = normalized;
  return safe;
}

export function computeNotifications(
  assets: Asset[],
  maintenanceLogs: MaintenanceLog[],
  acks: NotificationAck[]
): SystemNotification[] {
  const ackMap = new Map(acks.map((a) => [a.alert_key, a.acknowledged_at]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const dayMs = 1000 * 60 * 60 * 24;

  const notifications: SystemNotification[] = [];

  for (const asset of assets) {
    if (asset.status === 'Retired') continue;

    // 1. Expiring or expired warranty (within 45 days or already expired)
    if (asset.warranty_expiry) {
      const expDate = new Date(`${asset.warranty_expiry}T00:00:00`);
      const diffDays = Math.ceil((expDate.getTime() - todayMs) / dayMs);
      if (diffDays <= 45) {
        const key = `warranty:${asset.id}:${asset.warranty_expiry}`;
        const ackedAt = ackMap.get(key) ?? null;
        const isExpired = diffDays < 0;
        notifications.push({
          id: key,
          type: 'expiring_warranty',
          severity: isExpired || diffDays <= 14 ? 'critical' : 'warning',
          title: isExpired
            ? `Warranty Expired: ${asset.asset_tag}`
            : `Warranty Expiring in ${diffDays}d: ${asset.asset_tag}`,
          description: `${asset.name} (${asset.brand} ${asset.model}) warranty ${
            isExpired ? `expired on ${asset.warranty_expiry}` : `expires on ${asset.warranty_expiry}`
          }.`,
          entity_type: 'asset',
          entity_id: asset.id,
          asset_id: asset.id,
          asset_tag: asset.asset_tag,
          asset_name: asset.name,
          due_date: asset.warranty_expiry,
          acknowledged: Boolean(ackedAt),
          acknowledged_at: ackedAt,
        });
      }
    }

    // 2. Replacement due (age >= 4 years or Damaged status)
    if (asset.purchase_date) {
      const purchaseDate = new Date(`${asset.purchase_date}T00:00:00`);
      const ageYears = (todayMs - purchaseDate.getTime()) / (dayMs * 365.25);
      if (ageYears >= 4 || asset.status === 'Damaged') {
        const key = `replacement:${asset.id}`;
        const ackedAt = ackMap.get(key) ?? null;
        notifications.push({
          id: key,
          type: 'replacement_due',
          severity: asset.status === 'Damaged' || ageYears >= 5 ? 'critical' : 'warning',
          title:
            asset.status === 'Damaged'
              ? `Damaged Asset Replacement Review: ${asset.asset_tag}`
              : `Lifecycle Replacement Due: ${asset.asset_tag}`,
          description:
            asset.status === 'Damaged'
              ? `${asset.name} is currently marked Damaged and requires replacement or decommissioning.`
              : `${asset.name} was purchased on ${asset.purchase_date} (${ageYears.toFixed(
                  1
                )} yrs old), exceeding the 4-year enterprise refresh cycle.`,
          entity_type: 'asset',
          entity_id: asset.id,
          asset_id: asset.id,
          asset_tag: asset.asset_tag,
          asset_name: asset.name,
          due_date: asset.purchase_date,
          acknowledged: Boolean(ackedAt),
          acknowledged_at: ackedAt,
        });
      }
    }
  }

  // 3. Overdue maintenance
  const assetById = new Map(assets.map((a) => [a.id, a]));
  for (const log of maintenanceLogs) {
    if (log.status === 'Completed') continue;
    const targetDateStr = log.next_service_date || log.service_date;
    if (!targetDateStr) continue;
    const targetDate = new Date(`${targetDateStr}T00:00:00`);
    const diffDays = Math.ceil((targetDate.getTime() - todayMs) / dayMs);
    if (diffDays < 0) {
      const asset = assetById.get(log.asset_id);
      if (!asset) continue;
      const key = `maintenance:${log.id}:${targetDateStr}`;
      const ackedAt = ackMap.get(key) ?? null;
      notifications.push({
        id: key,
        type: 'overdue_maintenance',
        severity: 'critical',
        title: `Overdue Maintenance (${Math.abs(diffDays)}d): ${asset.asset_tag}`,
        description: `${log.maintenance_type} for ${asset.name} (${log.issue_description}) was due ${targetDateStr}.`,
        entity_type: 'maintenance',
        entity_id: log.id,
        asset_id: asset.id,
        asset_tag: asset.asset_tag,
        asset_name: asset.name,
        due_date: targetDateStr,
        acknowledged: Boolean(ackedAt),
        acknowledged_at: ackedAt,
      });
    }
  }

  // Sort critical first, then unacknowledged, then due date
  const severityWeight = { critical: 0, warning: 1, info: 2 };
  notifications.sort((a, b) => {
    if (a.acknowledged !== b.acknowledged) return a.acknowledged ? 1 : -1;
    if (severityWeight[a.severity] !== severityWeight[b.severity]) {
      return severityWeight[a.severity] - severityWeight[b.severity];
    }
    return a.due_date.localeCompare(b.due_date);
  });

  return notifications;
}

export function buildDashboardSummary(
  assets: Asset[],
  employees: Employee[],
  assignments: AssetAssignment[],
  maintenanceLogs: MaintenanceLog[],
  notifications: SystemNotification[]
): DashboardSummary {
  const counts = {
    totalAssets: assets.length,
    assignedAssets: assets.filter((a) => a.status === 'Assigned').length,
    availableAssets: assets.filter((a) => a.status === 'Available').length,
    underMaintenance: assets.filter((a) => a.status === 'Under Maintenance').length,
    retiredOrDamaged: assets.filter(
      (a) => a.status === 'Retired' || a.status === 'Damaged'
    ).length,
    activeEmployees: employees.filter((e) => e.status === 'active').length,
    openMaintenance: maintenanceLogs.filter((m) => m.status !== 'Completed').length,
  };

  const totalAssetValue = assets.reduce((sum, a) => sum + Number(a.cost || 0), 0);
  const totalMaintenanceCost = maintenanceLogs.reduce(
    (sum, m) => sum + Number(m.cost || 0),
    0
  );

  const catMap = new Map<
    string,
    { category: string; total: number; assigned: number; available: number; maintenance: number; value: number }
  >();
  for (const a of assets) {
    const entry = catMap.get(a.category) ?? {
      category: a.category,
      total: 0,
      assigned: 0,
      available: 0,
      maintenance: 0,
      value: 0,
    };
    entry.total += 1;
    if (a.status === 'Assigned') entry.assigned += 1;
    if (a.status === 'Available') entry.available += 1;
    if (a.status === 'Under Maintenance') entry.maintenance += 1;
    entry.value += Number(a.cost || 0);
    catMap.set(a.category, entry);
  }
  const categoryBreakdown = Array.from(catMap.values()).sort((a, b) => b.total - a.total);

  const statuses: AssetStatus[] = [
    'Assigned',
    'Available',
    'Under Maintenance',
    'Damaged',
    'Retired',
  ];
  const statusBreakdown = statuses.map((status) => ({
    status,
    count: assets.filter((a) => a.status === status).length,
  }));

  const monthMap = new Map<string, { month: string; cost: number; count: number }>();
  for (const m of maintenanceLogs) {
    const monthKey = m.service_date.slice(0, 7);
    const entry = monthMap.get(monthKey) ?? { month: monthKey, cost: 0, count: 0 };
    entry.cost += Number(m.cost || 0);
    entry.count += 1;
    monthMap.set(monthKey, entry);
  }
  const monthlyMaintenance = Array.from(monthMap.values())
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6);

  const unreadAlerts = notifications.filter((n) => !n.acknowledged);

  return {
    counts,
    financials: {
      totalAssetValue,
      totalMaintenanceCost,
    },
    categoryBreakdown,
    statusBreakdown,
    monthlyMaintenance,
    recentAssignments: assignments.slice(0, 5),
    recentMaintenance: maintenanceLogs.slice(0, 5),
    unreadAlertsCount: unreadAlerts.length,
    criticalAlerts: unreadAlerts.slice(0, 5),
  };
}

function enrichAssets(assets: Asset[], employees: Employee[]): Asset[] {
  const empMap = new Map(employees.map((e) => [e.id, e]));
  return assets.map((a) => {
    const emp = a.assigned_employee_id ? empMap.get(a.assigned_employee_id) : undefined;
    return {
      ...a,
      assigned_employee_name: emp ? emp.full_name : null,
      assigned_employee_department: emp ? emp.department : null,
      assigned_employee_code: emp ? emp.employee_code : null,
    };
  });
}

function enrichAssignments(
  assignments: AssetAssignment[],
  assets: Asset[],
  employees: Employee[],
  users: StoredUser[]
): AssetAssignment[] {
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const empMap = new Map(employees.map((e) => [e.id, e]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  return assignments.map((asg) => {
    const asset = assetMap.get(asg.asset_id);
    const emp = empMap.get(asg.employee_id);
    const usr = userMap.get(asg.assigned_by_user_id);
    return {
      ...asg,
      asset_tag: asset?.asset_tag,
      asset_name: asset?.name,
      asset_category: asset?.category,
      asset_brand: asset?.brand,
      asset_model: asset?.model,
      asset_serial: asset?.serial_number,
      employee_name: emp?.full_name,
      employee_code: emp?.employee_code,
      employee_department: emp?.department,
      employee_email: emp?.email,
      assigned_by_name: usr?.name ?? 'IT Admin',
    };
  });
}

function enrichMaintenance(
  logs: MaintenanceLog[],
  assets: Asset[],
  users: StoredUser[]
): MaintenanceLog[] {
  const assetMap = new Map(assets.map((a) => [a.id, a]));
  const userMap = new Map(users.map((u) => [u.id, u]));
  return logs.map((m) => {
    const asset = assetMap.get(m.asset_id);
    const usr = userMap.get(m.recorded_by_user_id);
    return {
      ...m,
      asset_tag: asset?.asset_tag,
      asset_name: asset?.name,
      asset_category: asset?.category,
      asset_brand: asset?.brand,
      asset_model: asset?.model,
      recorded_by_name: usr?.name ?? 'IT Admin',
    };
  });
}

function nextHandoverNumber(existing: AssetAssignment[]): string {
  const year = new Date().getFullYear();
  let maxSeq = 0;
  for (const a of existing) {
    const match = a.handover_number.match(/^HO-\d{4}-(\d+)$/);
    if (match) {
      const seq = Number.parseInt(match[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return `HO-${year}-${String(maxSeq + 1).padStart(4, '0')}`;
}

function buildMongoScopeQuery(
  scope?: TenantScopeFilter,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!scope) return extra;
  const clauses: Array<Record<string, unknown>> = [];
  if (Object.keys(extra).length > 0) {
    clauses.push(extra);
  }
  if (scope.tenantId === 'ten-default-01') {
    clauses.push({
      $or: [{ tenant_id: 'ten-default-01' }, { tenant_id: { $exists: false } }],
    });
  } else {
    clauses.push({ tenant_id: scope.tenantId });
  }
  if (scope.orgIds) {
    if (scope.orgIds.includes('org-default-01')) {
      clauses.push({
        $or: [{ org_id: { $in: scope.orgIds } }, { org_id: { $exists: false } }],
      });
    } else {
      clauses.push({ org_id: { $in: scope.orgIds } });
    }
  }
  return clauses.length === 1 ? clauses[0] : { $and: clauses };
}

function buildMongoTenantQuery(
  tenantId?: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!tenantId) return extra;
  return buildMongoScopeQuery({ tenantId }, extra);
}

// ============================================================================
// MongoDB Atlas Implementation
// ============================================================================
class MongoItamsDatabase implements ItamsDatabase {
  readonly engine: DatabaseEngine = 'mongodb';
  private client: MongoClient;
  private db!: Db;
  private dbName: string;
  private userCache = new Map<string, { user: User | null; expiresAt: number }>();
  private static readonly USER_CACHE_TTL_MS = 10_000;

  constructor(uri: string, dbName: string) {
    this.client = new MongoClient(uri, {
      serverSelectionTimeoutMS: 8000,
      connectTimeoutMS: 8000,
      maxPoolSize: 20,
      family: 4,
    });
    this.dbName = dbName;
  }

  async closeQuietly(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // Ignore close errors
    }
  }

  async init(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);

    const dropSafe = async (col: string, idx: string) => {
      try {
        await this.db.collection(col).dropIndex(idx);
      } catch {
        // Index may already be migrated
      }
    };
    await Promise.all([
      dropSafe('employees', 'employee_code_1'),
      dropSafe('employees', 'email_1'),
      dropSafe('assets', 'asset_tag_1'),
      dropSafe('assets', 'serial_number_1'),
      dropSafe('assignments', 'handover_number_1'),
    ]);

    await Promise.all([
      this.db.collection('users').createIndex({ id: 1 }, { unique: true }),
      this.db.collection('users').createIndex({ email: 1 }, { unique: true }),
      this.db.collection('employees').createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection('employees')
        .createIndex({ tenant_id: 1, org_id: 1 }),
      this.db
        .collection('employees')
        .createIndex({ tenant_id: 1, employee_code: 1 }, { unique: true }),
      this.db
        .collection('employees')
        .createIndex({ tenant_id: 1, email: 1 }, { unique: true }),
      this.db.collection('assets').createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection('assets')
        .createIndex({ tenant_id: 1, org_id: 1, created_at: -1 }),
      this.db
        .collection('assets')
        .createIndex({ tenant_id: 1, status: 1 }),
      this.db
        .collection('assets')
        .createIndex({ assigned_employee_id: 1, status: 1 }),
      this.db
        .collection('assets')
        .createIndex({ tenant_id: 1, asset_tag: 1 }, { unique: true }),
      this.db
        .collection('assets')
        .createIndex({ tenant_id: 1, serial_number: 1 }, { unique: true }),
      this.db.collection('assignments').createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection('assignments')
        .createIndex({ tenant_id: 1, org_id: 1, created_at: -1 }),
      this.db.collection('assignments').createIndex({ asset_id: 1 }),
      this.db.collection('assignments').createIndex({ employee_id: 1 }),
      this.db
        .collection('assignments')
        .createIndex({ tenant_id: 1, handover_number: 1 }, { unique: true }),
      this.db.collection('maintenance_logs').createIndex({ id: 1 }, { unique: true }),
      this.db
        .collection('maintenance_logs')
        .createIndex({ tenant_id: 1, org_id: 1, service_date: -1 }),
      this.db.collection('maintenance_logs').createIndex({ asset_id: 1 }),
      this.db.collection('notification_acks').createIndex({ user_id: 1 }),
      this.db
        .collection('notification_acks')
        .createIndex({ alert_key: 1, user_id: 1 }, { unique: true }),
    ]);

    await Promise.all([
      this.db
        .collection('employees')
        .updateMany(
          { tenant_id: { $exists: false } },
          { $set: { tenant_id: 'ten-default-01', org_id: 'org-default-01' } }
        ),
      this.db
        .collection('assets')
        .updateMany(
          { tenant_id: { $exists: false } },
          { $set: { tenant_id: 'ten-default-01', org_id: 'org-default-01' } }
        ),
      this.db
        .collection('assignments')
        .updateMany(
          { tenant_id: { $exists: false } },
          { $set: { tenant_id: 'ten-default-01', org_id: 'org-default-01' } }
        ),
      this.db
        .collection('maintenance_logs')
        .updateMany(
          { tenant_id: { $exists: false } },
          { $set: { tenant_id: 'ten-default-01', org_id: 'org-default-01' } }
        ),
    ]);

    const seed = createSeedData();
    const userCount = await this.db.collection('users').countDocuments();
    if (userCount === 0) {
      if (seed.users.length > 0) {
        await this.db.collection('users').insertMany(seed.users);
      }
      if (seed.employees.length > 0) {
        await this.db.collection('employees').insertMany(seed.employees);
      }
      if (seed.assets.length > 0) {
        await this.db.collection('assets').insertMany(seed.assets);
      }
      if (seed.assignments.length > 0) {
        await this.db.collection('assignments').insertMany(seed.assignments);
      }
      if (seed.maintenanceLogs.length > 0) {
        await this.db
          .collection('maintenance_logs')
          .insertMany(seed.maintenanceLogs);
      }
    } else {
      const previousBootstrapEmails = [
        'georgearthur848@gmail.com',
        'nanaappiahkubi848@gmail.com',
      ];
      await this.db
        .collection('users')
        .updateMany(
          { email: { $in: previousBootstrapEmails }, is_super_admin: true },
          { $set: { is_super_admin: false } }
        );

      const superSeed = seed.users.find((u) => u.is_super_admin);
      if (superSeed) {
        const existingSuper = await this.findUserByEmail(superSeed.email);
        if (existingSuper) {
          if (
            !existingSuper.is_super_admin ||
            !existingSuper.email_verified ||
            existingSuper.status !== 'active' ||
            existingSuper.role !== 'admin'
          ) {
            await this.db.collection('users').updateOne(
              { id: existingSuper.id },
              {
                $set: {
                  status: 'active',
                  role: 'admin',
                  is_super_admin: true,
                  email_verified: true,
                },
              }
            );
            this.userCache.delete(existingSuper.id);
          }
        } else {
          const existingById = await this.findUserById(superSeed.id);
          if (existingById) {
            await this.db.collection('users').updateOne(
              { id: superSeed.id },
              {
                $set: {
                  email: superSeed.email,
                  password_hash: superSeed.password_hash,
                  status: 'active',
                  role: 'admin',
                  is_super_admin: true,
                  email_verified: true,
                },
              }
            );
            this.userCache.delete(superSeed.id);
          } else {
            await this.db.collection('users').insertOne({ ...superSeed });
          }
        }
      }
    }
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const doc = await this.db
      .collection<StoredUser>('users')
      .findOne({ email: email.toLowerCase().trim() }, { projection: { _id: 0 } });
    return doc ? normalizeUserRecord(doc) : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const cached = this.userCache.get(id);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }
    const doc = await this.db
      .collection<StoredUser>('users')
      .findOne({ id }, { projection: { _id: 0 } });
    const safe = doc ? stripPassword(doc) : null;
    this.userCache.set(id, {
      user: safe,
      expiresAt: Date.now() + MongoItamsDatabase.USER_CACHE_TTL_MS,
    });
    return safe;
  }

  async updateUserLastLogin(id: string, isoTimestamp: string): Promise<void> {
    const cached = this.userCache.get(id);
    if (cached?.user) {
      cached.user = { ...cached.user, last_login: isoTimestamp };
    }
    await this.db
      .collection('users')
      .updateOne({ id }, { $set: { last_login: isoTimestamp } });
  }

  async listUsers(): Promise<User[]> {
    const docs = await this.db
      .collection<StoredUser>('users')
      .find({}, { projection: { _id: 0, password_hash: 0 } })
      .sort({ created_at: 1 })
      .toArray();
    return docs.map((d) => stripPassword(d as StoredUser));
  }

  async createUser(user: StoredUser): Promise<User> {
    await this.db.collection<StoredUser>('users').insertOne({ ...user });
    const safe = stripPassword(user);
    this.userCache.set(user.id, {
      user: safe,
      expiresAt: Date.now() + MongoItamsDatabase.USER_CACHE_TTL_MS,
    });
    return safe;
  }

  async updateUser(
    id: string,
    patch: Partial<
      Pick<
        StoredUser,
        | 'name'
        | 'email'
        | 'role'
        | 'department'
        | 'status'
        | 'password_hash'
        | 'email_verified'
        | 'mfa_enabled'
        | 'is_super_admin'
      >
    >
  ): Promise<User | null> {
    this.userCache.delete(id);
    await this.db.collection('users').updateOne({ id }, { $set: patch });
    return this.findUserById(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    this.userCache.delete(id);
    const res = await this.db.collection('users').deleteOne({ id });
    return res.deletedCount > 0;
  }

  async listEmployees(scope?: TenantScopeFilter): Promise<Employee[]> {
    const query = buildMongoScopeQuery(scope);
    const assetQuery = buildMongoScopeQuery(scope, { status: 'Assigned' });
    const [employees, assets] = await Promise.all([
      this.db
        .collection<Employee>('employees')
        .find(query, { projection: { _id: 0 } })
        .sort({ full_name: 1 })
        .toArray(),
      this.db
        .collection<Asset>('assets')
        .find(assetQuery, { projection: { _id: 0, assigned_employee_id: 1 } })
        .toArray(),
    ]);
    const counts = new Map<string, number>();
    for (const a of assets) {
      if (a.assigned_employee_id) {
        counts.set(a.assigned_employee_id, (counts.get(a.assigned_employee_id) ?? 0) + 1);
      }
    }
    return employees.map((e) => ({ ...e, assigned_count: counts.get(e.id) ?? 0 }));
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    const [emp, assignedCount] = await Promise.all([
      this.db
        .collection<Employee>('employees')
        .findOne({ id }, { projection: { _id: 0 } }),
      this.db
        .collection('assets')
        .countDocuments({ assigned_employee_id: id, status: 'Assigned' }),
    ]);
    if (!emp) return null;
    return { ...emp, assigned_count: assignedCount };
  }

  async createEmployee(employee: Employee): Promise<Employee> {
    const doc = {
      ...employee,
      tenant_id: employee.tenant_id || 'ten-default-01',
      org_id: employee.org_id || 'org-default-01',
    };
    await this.db.collection<Employee>('employees').insertOne(doc);
    return { ...doc, assigned_count: 0 };
  }

  async updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee | null> {
    await this.db.collection('employees').updateOne({ id }, { $set: patch });
    return this.getEmployeeById(id);
  }

  async deleteEmployee(id: string): Promise<boolean> {
    const res = await this.db.collection('employees').deleteOne({ id });
    return res.deletedCount > 0;
  }

  async countAssets(scope?: TenantScopeFilter): Promise<number> {
    return this.db.collection<Asset>('assets').countDocuments(buildMongoScopeQuery(scope));
  }

  async listAssets(scope?: TenantScopeFilter): Promise<Asset[]> {
    const assetQuery = buildMongoScopeQuery(scope);
    const empQuery = buildMongoTenantQuery(scope?.tenantId);
    const [assets, employees] = await Promise.all([
      this.db
        .collection<Asset>('assets')
        .find(assetQuery, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .toArray(),
      this.db
        .collection<Employee>('employees')
        .find(empQuery, { projection: { _id: 0, id: 1, full_name: 1, department: 1, employee_code: 1 } })
        .toArray(),
    ]);
    return enrichAssets(assets, employees);
  }

  async getAssetById(id: string): Promise<Asset | null> {
    const asset = await this.db
      .collection<Asset>('assets')
      .findOne({ id }, { projection: { _id: 0 } });
    if (!asset) return null;
    if (!asset.assigned_employee_id) {
      return enrichAssets([asset], [])[0] ?? null;
    }
    const emp = await this.db
      .collection<Employee>('employees')
      .findOne(
        { id: asset.assigned_employee_id },
        { projection: { _id: 0, id: 1, full_name: 1, department: 1, employee_code: 1 } }
      );
    return enrichAssets([asset], emp ? [emp] : [])[0] ?? null;
  }

  async createAsset(asset: Asset): Promise<Asset> {
    const doc = {
      ...asset,
      tenant_id: asset.tenant_id || 'ten-default-01',
      org_id: asset.org_id || 'org-default-01',
    };
    await this.db.collection<Asset>('assets').insertOne(doc);
    return (await this.getAssetById(asset.id)) ?? doc;
  }

  async updateAsset(id: string, patch: Partial<Asset>): Promise<Asset | null> {
    await this.db.collection('assets').updateOne({ id }, { $set: patch });
    return this.getAssetById(id);
  }

  async deleteAsset(id: string): Promise<boolean> {
    const res = await this.db.collection('assets').deleteOne({ id });
    if (res.deletedCount > 0) {
      await Promise.all([
        this.db.collection('assignments').deleteMany({ asset_id: id }),
        this.db.collection('maintenance_logs').deleteMany({ asset_id: id }),
      ]);
      return true;
    }
    return false;
  }

  private async enrichAssignmentRows(assignments: AssetAssignment[]): Promise<AssetAssignment[]> {
    if (assignments.length === 0) return [];
    const assetIds = Array.from(new Set(assignments.map((a) => a.asset_id)));
    const employeeIds = Array.from(new Set(assignments.map((a) => a.employee_id)));
    const userIds = Array.from(new Set(assignments.map((a) => a.assigned_by_user_id)));
    const [assets, employees, users] = await Promise.all([
      this.db
        .collection<Asset>('assets')
        .find(
          { id: { $in: assetIds } },
          { projection: { _id: 0, id: 1, asset_tag: 1, name: 1, category: 1, brand: 1, model: 1, serial_number: 1 } }
        )
        .toArray(),
      this.db
        .collection<Employee>('employees')
        .find(
          { id: { $in: employeeIds } },
          { projection: { _id: 0, id: 1, full_name: 1, employee_code: 1, department: 1, email: 1 } }
        )
        .toArray(),
      this.db
        .collection<StoredUser>('users')
        .find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, name: 1 } })
        .toArray(),
    ]);
    return enrichAssignments(assignments, assets, employees, users);
  }

  async listAssignments(scope?: TenantScopeFilter): Promise<AssetAssignment[]> {
    const asgQuery = buildMongoScopeQuery(scope);
    const tenantQuery = buildMongoTenantQuery(scope?.tenantId);
    const [assignments, assets, employees, users] = await Promise.all([
      this.db
        .collection<AssetAssignment>('assignments')
        .find(asgQuery, { projection: { _id: 0 } })
        .sort({ created_at: -1 })
        .toArray(),
      this.db
        .collection<Asset>('assets')
        .find(tenantQuery, {
          projection: { _id: 0, id: 1, asset_tag: 1, name: 1, category: 1, brand: 1, model: 1, serial_number: 1 },
        })
        .toArray(),
      this.db
        .collection<Employee>('employees')
        .find(tenantQuery, {
          projection: { _id: 0, id: 1, full_name: 1, employee_code: 1, department: 1, email: 1 },
        })
        .toArray(),
      this.db
        .collection<StoredUser>('users')
        .find({}, { projection: { _id: 0, id: 1, name: 1 } })
        .toArray(),
    ]);
    return enrichAssignments(assignments, assets, employees, users);
  }

  async listAssignmentsByAsset(assetId: string): Promise<AssetAssignment[]> {
    const rows = await this.db
      .collection<AssetAssignment>('assignments')
      .find({ asset_id: assetId }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();
    return this.enrichAssignmentRows(rows);
  }

  async listAssignmentsByEmployee(employeeId: string): Promise<AssetAssignment[]> {
    const rows = await this.db
      .collection<AssetAssignment>('assignments')
      .find({ employee_id: employeeId }, { projection: { _id: 0 } })
      .sort({ created_at: -1 })
      .toArray();
    return this.enrichAssignmentRows(rows);
  }

  async getAssignmentById(id: string): Promise<AssetAssignment | null> {
    const row = await this.db
      .collection<AssetAssignment>('assignments')
      .findOne({ id }, { projection: { _id: 0 } });
    if (!row) return null;
    const enriched = await this.enrichAssignmentRows([row]);
    return enriched[0] ?? null;
  }

  async assignAsset(params: {
    assetId: string;
    employeeId: string;
    assignedByUserId: string;
    assignedDate: string;
    conditionOut: string;
    notes: string;
    tenantId?: string;
    orgId?: string;
  }): Promise<AssetAssignment> {
    const tenantId = params.tenantId || 'ten-default-01';
    const orgId = params.orgId || 'org-default-01';
    const existing = await this.db
      .collection<AssetAssignment>('assignments')
      .find({}, { projection: { _id: 0, handover_number: 1, tenant_id: 1 } })
      .toArray();
    const tenantExisting = existing.filter(
      (a) => (a.tenant_id || 'ten-default-01') === tenantId
    );
    const now = new Date().toISOString();
    const record: AssetAssignment = {
      id: `asg-${crypto.randomUUID().slice(0, 8)}`,
      asset_id: params.assetId,
      employee_id: params.employeeId,
      assigned_by_user_id: params.assignedByUserId,
      assigned_date: params.assignedDate,
      returned_date: null,
      condition_out: params.conditionOut,
      condition_in: null,
      handover_number: nextHandoverNumber(tenantExisting),
      notes: params.notes,
      status: 'Active',
      created_at: now,
      tenant_id: tenantId,
      org_id: orgId,
    };

    await this.db.collection<AssetAssignment>('assignments').insertOne({ ...record });
    await this.db.collection('assets').updateOne(
      { id: params.assetId },
      {
        $set: {
          status: 'Assigned',
          assigned_employee_id: params.employeeId,
          assigned_date: params.assignedDate,
          updated_at: now,
        },
      }
    );

    return (await this.getAssignmentById(record.id)) ?? record;
  }

  async returnAsset(params: {
    assignmentId: string;
    returnedDate: string;
    conditionIn: string;
    returnStatus: 'Available' | 'Under Maintenance' | 'Damaged';
    notes: string;
  }): Promise<AssetAssignment> {
    const existing = await this.db
      .collection<AssetAssignment>('assignments')
      .findOne({ id: params.assignmentId }, { projection: { _id: 0 } });
    if (!existing) {
      throw new Error('Assignment record not found.');
    }
    const now = new Date().toISOString();
    const combinedNotes = params.notes
      ? existing.notes
        ? `${existing.notes} | Return: ${params.notes}`
        : `Return: ${params.notes}`
      : existing.notes;

    await this.db.collection('assignments').updateOne(
      { id: params.assignmentId },
      {
        $set: {
          status: 'Returned',
          returned_date: params.returnedDate,
          condition_in: params.conditionIn,
          notes: combinedNotes,
        },
      }
    );
    await this.db.collection('assets').updateOne(
      { id: existing.asset_id },
      {
        $set: {
          status: params.returnStatus,
          assigned_employee_id: null,
          assigned_date: null,
          updated_at: now,
        },
      }
    );
    return (await this.getAssignmentById(params.assignmentId))!;
  }

  async updateAssignment(
    id: string,
    patch: Partial<
      Pick<
        AssetAssignment,
        'condition_out' | 'condition_in' | 'notes' | 'assigned_date' | 'returned_date' | 'status'
      >
    >
  ): Promise<AssetAssignment | null> {
    const existing = await this.db
      .collection<AssetAssignment>('assignments')
      .findOne({ id }, { projection: { _id: 0 } });
    if (!existing) return null;
    const safePatch: Record<string, unknown> = {};
    for (const key of ['condition_out', 'condition_in', 'notes', 'assigned_date', 'returned_date', 'status'] as const) {
      if (patch[key] !== undefined) safePatch[key] = patch[key];
    }
    if (Object.keys(safePatch).length > 0) {
      await this.db.collection('assignments').updateOne({ id }, { $set: safePatch });
    }
    return this.getAssignmentById(id);
  }

  async deleteAssignment(id: string): Promise<boolean> {
    const existing = await this.db
      .collection<AssetAssignment>('assignments')
      .findOne({ id }, { projection: { _id: 0 } });
    if (!existing) return false;
    const res = await this.db.collection('assignments').deleteOne({ id });
    if (existing.status === 'Active') {
      await this.db.collection('assets').updateOne(
        { id: existing.asset_id, assigned_employee_id: existing.employee_id },
        {
          $set: {
            status: 'Available',
            assigned_employee_id: null,
            assigned_date: null,
            updated_at: new Date().toISOString(),
          },
        }
      );
    }
    return res.deletedCount > 0;
  }

  private async enrichMaintenanceRows(logs: MaintenanceLog[]): Promise<MaintenanceLog[]> {
    if (logs.length === 0) return [];
    const assetIds = Array.from(new Set(logs.map((m) => m.asset_id)));
    const userIds = Array.from(new Set(logs.map((m) => m.recorded_by_user_id)));
    const [assets, users] = await Promise.all([
      this.db
        .collection<Asset>('assets')
        .find(
          { id: { $in: assetIds } },
          { projection: { _id: 0, id: 1, asset_tag: 1, name: 1, category: 1, brand: 1, model: 1 } }
        )
        .toArray(),
      this.db
        .collection<StoredUser>('users')
        .find({ id: { $in: userIds } }, { projection: { _id: 0, id: 1, name: 1 } })
        .toArray(),
    ]);
    return enrichMaintenance(logs, assets, users);
  }

  async listMaintenanceLogs(scope?: TenantScopeFilter): Promise<MaintenanceLog[]> {
    const logQuery = buildMongoScopeQuery(scope);
    const assetQuery = buildMongoTenantQuery(scope?.tenantId);
    const [logs, assets, users] = await Promise.all([
      this.db
        .collection<MaintenanceLog>('maintenance_logs')
        .find(logQuery, { projection: { _id: 0 } })
        .sort({ service_date: -1, created_at: -1 })
        .toArray(),
      this.db
        .collection<Asset>('assets')
        .find(assetQuery, {
          projection: { _id: 0, id: 1, asset_tag: 1, name: 1, category: 1, brand: 1, model: 1 },
        })
        .toArray(),
      this.db
        .collection<StoredUser>('users')
        .find({}, { projection: { _id: 0, id: 1, name: 1 } })
        .toArray(),
    ]);
    return enrichMaintenance(logs, assets, users);
  }

  async listMaintenanceByAsset(assetId: string): Promise<MaintenanceLog[]> {
    const rows = await this.db
      .collection<MaintenanceLog>('maintenance_logs')
      .find({ asset_id: assetId }, { projection: { _id: 0 } })
      .sort({ service_date: -1, created_at: -1 })
      .toArray();
    return this.enrichMaintenanceRows(rows);
  }

  async getMaintenanceById(id: string): Promise<MaintenanceLog | null> {
    const row = await this.db
      .collection<MaintenanceLog>('maintenance_logs')
      .findOne({ id }, { projection: { _id: 0 } });
    if (!row) return null;
    const enriched = await this.enrichMaintenanceRows([row]);
    return enriched[0] ?? null;
  }

  async createMaintenanceLog(
    log: MaintenanceLog,
    setAssetUnderMaintenance: boolean
  ): Promise<MaintenanceLog> {
    const doc = {
      ...log,
      tenant_id: log.tenant_id || 'ten-default-01',
      org_id: log.org_id || 'org-default-01',
    };
    await this.db.collection<MaintenanceLog>('maintenance_logs').insertOne(doc);
    if (setAssetUnderMaintenance && log.status !== 'Completed') {
      await this.db.collection('assets').updateOne(
        { id: log.asset_id },
        { $set: { status: 'Under Maintenance', updated_at: new Date().toISOString() } }
      );
    }
    return (await this.getMaintenanceById(log.id)) ?? doc;
  }

  async updateMaintenanceLog(
    id: string,
    patch: Partial<MaintenanceLog>
  ): Promise<MaintenanceLog | null> {
    const current = await this.db
      .collection<MaintenanceLog>('maintenance_logs')
      .findOne({ id }, { projection: { _id: 0 } });
    if (!current) return null;

    await this.db.collection('maintenance_logs').updateOne({ id }, { $set: patch });

    if (patch.status === 'Completed') {
      const asset = await this.db
        .collection<Asset>('assets')
        .findOne({ id: current.asset_id }, { projection: { _id: 0 } });
      if (asset && asset.status === 'Under Maintenance') {
        const restoredStatus: AssetStatus = asset.assigned_employee_id
          ? 'Assigned'
          : 'Available';
        await this.db.collection('assets').updateOne(
          { id: asset.id },
          { $set: { status: restoredStatus, updated_at: new Date().toISOString() } }
        );
      }
    } else if (patch.status === 'In Progress') {
      await this.db.collection('assets').updateOne(
        { id: current.asset_id },
        { $set: { status: 'Under Maintenance', updated_at: new Date().toISOString() } }
      );
    }

    return this.getMaintenanceById(id);
  }

  async deleteMaintenanceLog(id: string): Promise<boolean> {
    const res = await this.db.collection('maintenance_logs').deleteOne({ id });
    return res.deletedCount > 0;
  }

  async listNotifications(
    userId: string,
    scope?: TenantScopeFilter
  ): Promise<SystemNotification[]> {
    const assetQuery = buildMongoScopeQuery(scope);
    const logQuery = buildMongoScopeQuery(scope);
    const [assets, logs, acks] = await Promise.all([
      this.db
        .collection<Asset>('assets')
        .find(assetQuery, { projection: { _id: 0 } })
        .toArray(),
      this.db
        .collection<MaintenanceLog>('maintenance_logs')
        .find(logQuery, { projection: { _id: 0 } })
        .toArray(),
      this.db
        .collection<NotificationAck>('notification_acks')
        .find({ user_id: userId }, { projection: { _id: 0 } })
        .toArray(),
    ]);
    return computeNotifications(assets, logs, acks);
  }

  async acknowledgeNotifications(userId: string, alertKeys: string[]): Promise<void> {
    const now = new Date().toISOString();
    if (alertKeys.length === 0) return;
    await this.db.collection('notification_acks').bulkWrite(
      alertKeys.map((alert_key) => ({
        updateOne: {
          filter: { alert_key, user_id: userId },
          update: {
            $setOnInsert: {
              id: `ack-${crypto.randomUUID().slice(0, 8)}`,
              alert_key,
              user_id: userId,
            },
            $set: { acknowledged_at: now },
          },
          upsert: true,
        },
      }))
    );
  }

  async getDashboardSummary(
    userId: string,
    scope?: TenantScopeFilter
  ): Promise<DashboardSummary> {
    const scopedQuery = buildMongoScopeQuery(scope);
    const [rawAssets, rawEmployees, rawAssignments, rawLogs, users, acks] =
      await Promise.all([
        this.db
          .collection<Asset>('assets')
          .find(scopedQuery, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .toArray(),
        this.db
          .collection<Employee>('employees')
          .find(scopedQuery, { projection: { _id: 0 } })
          .sort({ full_name: 1 })
          .toArray(),
        this.db
          .collection<AssetAssignment>('assignments')
          .find(scopedQuery, { projection: { _id: 0 } })
          .sort({ created_at: -1 })
          .toArray(),
        this.db
          .collection<MaintenanceLog>('maintenance_logs')
          .find(scopedQuery, { projection: { _id: 0 } })
          .sort({ service_date: -1, created_at: -1 })
          .toArray(),
        this.db
          .collection<StoredUser>('users')
          .find({}, { projection: { _id: 0, id: 1, name: 1 } })
          .toArray(),
        this.db
          .collection<NotificationAck>('notification_acks')
          .find({ user_id: userId }, { projection: { _id: 0 } })
          .toArray(),
      ]);

    const assets = enrichAssets(rawAssets, rawEmployees);
    const assignments = enrichAssignments(rawAssignments, rawAssets, rawEmployees, users);
    const logs = enrichMaintenance(rawLogs, rawAssets, users);
    const notifications = computeNotifications(assets, logs, acks);
    return buildDashboardSummary(assets, rawEmployees, assignments, logs, notifications);
  }

  async resetToCleanState(): Promise<void> {
    this.userCache.clear();
    await Promise.all([
      this.db.collection('notification_acks').deleteMany({}),
      this.db.collection('maintenance_logs').deleteMany({}),
      this.db.collection('assignments').deleteMany({}),
      this.db.collection('assets').deleteMany({}),
      this.db.collection('employees').deleteMany({}),
      this.db.collection('users').deleteMany({}),
    ]);
    const seed = createSeedData();
    if (seed.users.length > 0) {
      await this.db.collection('users').insertMany(seed.users);
    }
  }
}

// ============================================================================
// SQLite Local Persistent Fallback Implementation
// ============================================================================
class SqliteItamsDatabase implements ItamsDatabase {
  readonly engine: DatabaseEngine = 'sqlite';
  private db!: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    const { DatabaseSync: SqliteDatabaseSync } = await import('node:sqlite');
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new SqliteDatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL,
        department TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_login TEXT,
        email_verified INTEGER NOT NULL DEFAULT 1,
        mfa_enabled INTEGER NOT NULL DEFAULT 0,
        is_super_admin INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        employee_code TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        department TEXT NOT NULL,
        job_title TEXT NOT NULL,
        phone TEXT NOT NULL,
        location TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'ten-default-01',
        org_id TEXT NOT NULL DEFAULT 'org-default-01',
        UNIQUE(tenant_id, employee_code),
        UNIQUE(tenant_id, email)
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        asset_tag TEXT NOT NULL,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        brand TEXT NOT NULL,
        model TEXT NOT NULL,
        serial_number TEXT NOT NULL,
        purchase_date TEXT NOT NULL,
        cost REAL NOT NULL,
        warranty_expiry TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_employee_id TEXT,
        assigned_date TEXT,
        location TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'ten-default-01',
        org_id TEXT NOT NULL DEFAULT 'org-default-01',
        UNIQUE(tenant_id, asset_tag),
        UNIQUE(tenant_id, serial_number)
      );

      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        employee_id TEXT NOT NULL,
        assigned_by_user_id TEXT NOT NULL,
        assigned_date TEXT NOT NULL,
        returned_date TEXT,
        condition_out TEXT NOT NULL,
        condition_in TEXT,
        handover_number TEXT NOT NULL,
        notes TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'ten-default-01',
        org_id TEXT NOT NULL DEFAULT 'org-default-01',
        UNIQUE(tenant_id, handover_number)
      );

      CREATE TABLE IF NOT EXISTS maintenance_logs (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        issue_description TEXT NOT NULL,
        maintenance_type TEXT NOT NULL,
        vendor_or_technician TEXT NOT NULL,
        service_date TEXT NOT NULL,
        next_service_date TEXT,
        cost REAL NOT NULL,
        status TEXT NOT NULL,
        recorded_by_user_id TEXT NOT NULL,
        notes TEXT NOT NULL,
        created_at TEXT NOT NULL,
        tenant_id TEXT NOT NULL DEFAULT 'ten-default-01',
        org_id TEXT NOT NULL DEFAULT 'org-default-01'
      );

      CREATE TABLE IF NOT EXISTS notification_acks (
        id TEXT PRIMARY KEY,
        alert_key TEXT NOT NULL,
        user_id TEXT NOT NULL,
        acknowledged_at TEXT NOT NULL,
        UNIQUE(alert_key, user_id)
      );
    `);

    const hasCol = (table: string, col: string) => {
      const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
        name: string;
      }>;
      return cols.some((c) => c.name === col);
    };

    if (!hasCol('users', 'is_super_admin')) {
      this.db.exec(`
        ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN is_super_admin INTEGER NOT NULL DEFAULT 0;
      `);
    }

    if (!hasCol('assets', 'tenant_id')) {
      // Safe migration of legacy global-unique SQLite tables to tenant-scoped unique tables
      this.db.exec(`
        CREATE TABLE employees_v2 (
          id TEXT PRIMARY KEY, employee_code TEXT NOT NULL, full_name TEXT NOT NULL, email TEXT NOT NULL,
          department TEXT NOT NULL, job_title TEXT NOT NULL, phone TEXT NOT NULL, location TEXT NOT NULL,
          status TEXT NOT NULL, created_at TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT 'ten-default-01', org_id TEXT NOT NULL DEFAULT 'org-default-01',
          UNIQUE(tenant_id, employee_code), UNIQUE(tenant_id, email)
        );
        INSERT INTO employees_v2 SELECT id, employee_code, full_name, email, department, job_title, phone, location, status, created_at, 'ten-default-01', 'org-default-01' FROM employees;
        DROP TABLE employees;
        ALTER TABLE employees_v2 RENAME TO employees;

        CREATE TABLE assets_v2 (
          id TEXT PRIMARY KEY, asset_tag TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
          brand TEXT NOT NULL, model TEXT NOT NULL, serial_number TEXT NOT NULL, purchase_date TEXT NOT NULL,
          cost REAL NOT NULL, warranty_expiry TEXT NOT NULL, status TEXT NOT NULL, assigned_employee_id TEXT,
          assigned_date TEXT, location TEXT NOT NULL, notes TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT 'ten-default-01', org_id TEXT NOT NULL DEFAULT 'org-default-01',
          UNIQUE(tenant_id, asset_tag), UNIQUE(tenant_id, serial_number)
        );
        INSERT INTO assets_v2 SELECT id, asset_tag, name, category, brand, model, serial_number, purchase_date, cost, warranty_expiry, status, assigned_employee_id, assigned_date, location, notes, created_at, updated_at, 'ten-default-01', 'org-default-01' FROM assets;
        DROP TABLE assets;
        ALTER TABLE assets_v2 RENAME TO assets;

        CREATE TABLE assignments_v2 (
          id TEXT PRIMARY KEY, asset_id TEXT NOT NULL, employee_id TEXT NOT NULL, assigned_by_user_id TEXT NOT NULL,
          assigned_date TEXT NOT NULL, returned_date TEXT, condition_out TEXT NOT NULL, condition_in TEXT,
          handover_number TEXT NOT NULL, notes TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
          tenant_id TEXT NOT NULL DEFAULT 'ten-default-01', org_id TEXT NOT NULL DEFAULT 'org-default-01',
          UNIQUE(tenant_id, handover_number)
        );
        INSERT INTO assignments_v2 SELECT id, asset_id, employee_id, assigned_by_user_id, assigned_date, returned_date, condition_out, condition_in, handover_number, notes, status, created_at, 'ten-default-01', 'org-default-01' FROM assignments;
        DROP TABLE assignments;
        ALTER TABLE assignments_v2 RENAME TO assignments;
      `);
    }

    if (!hasCol('maintenance_logs', 'tenant_id')) {
      this.db.exec(`
        ALTER TABLE maintenance_logs ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'ten-default-01';
        ALTER TABLE maintenance_logs ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org-default-01';
      `);
    }

    const seed = createSeedData();
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM users').get() as {
      cnt: number;
    };
    if (row.cnt === 0) {
      const insertUser = this.db.prepare(
        `INSERT INTO users (id, name, email, password_hash, role, department, status, created_at, last_login, email_verified, mfa_enabled, is_super_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const u of seed.users) {
        insertUser.run(
          u.id,
          u.name,
          u.email,
          u.password_hash,
          u.role,
          u.department,
          u.status,
          u.created_at,
          u.last_login,
          u.email_verified === false ? 0 : 1,
          u.mfa_enabled ? 1 : 0,
          u.is_super_admin ? 1 : 0
        );
      }

      const insertEmp = this.db.prepare(
        `INSERT INTO employees (id, employee_code, full_name, email, department, job_title, phone, location, status, created_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of seed.employees) {
        insertEmp.run(
          e.id,
          e.employee_code,
          e.full_name,
          e.email,
          e.department,
          e.job_title,
          e.phone,
          e.location,
          e.status,
          e.created_at,
          e.tenant_id || 'ten-default-01',
          e.org_id || 'org-default-01'
        );
      }

      const insertAsset = this.db.prepare(
        `INSERT INTO assets (id, asset_tag, name, category, brand, model, serial_number, purchase_date, cost, warranty_expiry, status, assigned_employee_id, assigned_date, location, notes, created_at, updated_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const a of seed.assets) {
        insertAsset.run(
          a.id,
          a.asset_tag,
          a.name,
          a.category,
          a.brand,
          a.model,
          a.serial_number,
          a.purchase_date,
          a.cost,
          a.warranty_expiry,
          a.status,
          a.assigned_employee_id,
          a.assigned_date,
          a.location,
          a.notes,
          a.created_at,
          a.updated_at,
          a.tenant_id || 'ten-default-01',
          a.org_id || 'org-default-01'
        );
      }

      const insertAsg = this.db.prepare(
        `INSERT INTO assignments (id, asset_id, employee_id, assigned_by_user_id, assigned_date, returned_date, condition_out, condition_in, handover_number, notes, status, created_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const g of seed.assignments) {
        insertAsg.run(
          g.id,
          g.asset_id,
          g.employee_id,
          g.assigned_by_user_id,
          g.assigned_date,
          g.returned_date,
          g.condition_out,
          g.condition_in,
          g.handover_number,
          g.notes,
          g.status,
          g.created_at,
          g.tenant_id || 'ten-default-01',
          g.org_id || 'org-default-01'
        );
      }

      const insertMnt = this.db.prepare(
        `INSERT INTO maintenance_logs (id, asset_id, issue_description, maintenance_type, vendor_or_technician, service_date, next_service_date, cost, status, recorded_by_user_id, notes, created_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const m of seed.maintenanceLogs) {
        insertMnt.run(
          m.id,
          m.asset_id,
          m.issue_description,
          m.maintenance_type,
          m.vendor_or_technician,
          m.service_date,
          m.next_service_date,
          m.cost,
          m.status,
          m.recorded_by_user_id,
          m.notes,
          m.created_at,
          m.tenant_id || 'ten-default-01',
          m.org_id || 'org-default-01'
        );
      }
    } else {
      const previousBootstrapEmails = [
        'georgearthur848@gmail.com',
        'nanaappiahkubi848@gmail.com',
      ];
      this.db
        .prepare(
          'UPDATE users SET is_super_admin = 0 WHERE LOWER(email) IN (?, ?) AND is_super_admin = 1'
        )
        .run(...previousBootstrapEmails);

      const superSeed = seed.users.find((u) => u.is_super_admin);
      if (superSeed) {
        const existingSuper = await this.findUserByEmail(superSeed.email);
        if (existingSuper) {
          if (
            !existingSuper.is_super_admin ||
            !existingSuper.email_verified ||
            existingSuper.status !== 'active' ||
            existingSuper.role !== 'admin'
          ) {
            this.db
              .prepare(
                `UPDATE users
                 SET status = 'active', role = 'admin', is_super_admin = 1, email_verified = 1
                 WHERE id = ?`
              )
              .run(existingSuper.id);
          }
        } else {
          const existingById = await this.findUserById(superSeed.id);
          if (existingById) {
            this.db
              .prepare(
                `UPDATE users
                 SET email = ?, password_hash = ?, status = 'active', role = 'admin', is_super_admin = 1, email_verified = 1
                 WHERE id = ?`
              )
              .run(superSeed.email, superSeed.password_hash, superSeed.id);
          } else {
            this.db
              .prepare(
                `INSERT INTO users (id, name, email, password_hash, role, department, status, created_at, last_login, email_verified, mfa_enabled, is_super_admin)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                superSeed.id,
                superSeed.name,
                superSeed.email,
                superSeed.password_hash,
                superSeed.role,
                superSeed.department,
                superSeed.status,
                superSeed.created_at,
                superSeed.last_login,
                1,
                0,
                1
              );
          }
        }
      }
    }
  }

  private getAllStoredUsers(): StoredUser[] {
    const rows = this.db
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as unknown as StoredUser[];
    return rows.map(normalizeUserRecord);
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE LOWER(email) = ?')
      .get(email.toLowerCase().trim()) as unknown as StoredUser | undefined;
    return row ? normalizeUserRecord(row) : null;
  }

  async findUserById(id: string): Promise<User | null> {
    const row = this.db
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as unknown as StoredUser | undefined;
    return row ? stripPassword(row) : null;
  }

  async updateUserLastLogin(id: string, isoTimestamp: string): Promise<void> {
    this.db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(isoTimestamp, id);
  }

  async listUsers(): Promise<User[]> {
    return this.getAllStoredUsers().map(stripPassword);
  }

  async createUser(user: StoredUser): Promise<User> {
    this.db
      .prepare(
        `INSERT INTO users (id, name, email, password_hash, role, department, status, created_at, last_login, email_verified, mfa_enabled, is_super_admin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        user.name,
        user.email,
        user.password_hash,
        user.role,
        user.department,
        user.status,
        user.created_at,
        user.last_login,
        user.email_verified === false ? 0 : 1,
        user.mfa_enabled ? 1 : 0,
        user.is_super_admin ? 1 : 0
      );
    return stripPassword(user);
  }

  async updateUser(
    id: string,
    patch: Partial<
      Pick<
        StoredUser,
        | 'name'
        | 'email'
        | 'role'
        | 'department'
        | 'status'
        | 'password_hash'
        | 'email_verified'
        | 'mfa_enabled'
        | 'is_super_admin'
      >
    >
  ): Promise<User | null> {
    const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) =>
        typeof v === 'boolean' ? (v ? 1 : 0) : (v as string)
      );
      this.db.prepare(`UPDATE users SET ${sets} WHERE id = ?`).run(...values, id);
    }
    return this.findUserById(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  async listEmployees(scope?: TenantScopeFilter): Promise<Employee[]> {
    const employees = (
      this.db
        .prepare('SELECT * FROM employees ORDER BY full_name ASC')
        .all() as unknown as Employee[]
    ).filter((e) => matchesScope(e, scope));
    const activeAssigned = (
      this.db
        .prepare(
          "SELECT assigned_employee_id, tenant_id, org_id FROM assets WHERE status = 'Assigned' AND assigned_employee_id IS NOT NULL"
        )
        .all() as Array<{
        assigned_employee_id: string;
        tenant_id?: string;
        org_id?: string;
      }>
    ).filter((a) => matchesScope(a, scope));
    const counts = new Map<string, number>();
    for (const r of activeAssigned) {
      counts.set(
        r.assigned_employee_id,
        (counts.get(r.assigned_employee_id) ?? 0) + 1
      );
    }
    return employees.map((e) => ({ ...e, assigned_count: counts.get(e.id) ?? 0 }));
  }

  async getEmployeeById(id: string): Promise<Employee | null> {
    const emp = this.db
      .prepare('SELECT * FROM employees WHERE id = ?')
      .get(id) as unknown as Employee | undefined;
    if (!emp) return null;
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS cnt FROM assets WHERE assigned_employee_id = ? AND status = 'Assigned'"
      )
      .get(id) as { cnt: number };
    return { ...emp, assigned_count: row.cnt };
  }

  async createEmployee(employee: Employee): Promise<Employee> {
    const tenantId = employee.tenant_id || 'ten-default-01';
    const orgId = employee.org_id || 'org-default-01';
    this.db
      .prepare(
        `INSERT INTO employees (id, employee_code, full_name, email, department, job_title, phone, location, status, created_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        employee.id,
        employee.employee_code,
        employee.full_name,
        employee.email,
        employee.department,
        employee.job_title,
        employee.phone,
        employee.location,
        employee.status,
        employee.created_at,
        tenantId,
        orgId
      );
    return { ...employee, tenant_id: tenantId, org_id: orgId, assigned_count: 0 };
  }

  async updateEmployee(id: string, patch: Partial<Employee>): Promise<Employee | null> {
    const allowed = [
      'employee_code',
      'full_name',
      'email',
      'department',
      'job_title',
      'phone',
      'location',
      'status',
      'org_id',
    ];
    const entries = Object.entries(patch).filter(
      ([k, v]) => allowed.includes(k) && v !== undefined
    );
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) => v as string);
      this.db.prepare(`UPDATE employees SET ${sets} WHERE id = ?`).run(...values, id);
    }
    return this.getEmployeeById(id);
  }

  async deleteEmployee(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM employees WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  async countAssets(scope?: TenantScopeFilter): Promise<number> {
    if (!scope) {
      const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM assets').get() as { cnt: number };
      return row.cnt;
    }
    if (scope.orgIds) {
      if (scope.orgIds.length === 0) return 0;
      const placeholders = scope.orgIds.map(() => '?').join(', ');
      const row = this.db
        .prepare(`SELECT COUNT(*) AS cnt FROM assets WHERE tenant_id = ? AND org_id IN (${placeholders})`)
        .get(scope.tenantId, ...scope.orgIds) as { cnt: number };
      return row.cnt;
    }
    const row = this.db
      .prepare('SELECT COUNT(*) AS cnt FROM assets WHERE tenant_id = ?')
      .get(scope.tenantId) as { cnt: number };
    return row.cnt;
  }

  async listAssets(scope?: TenantScopeFilter): Promise<Asset[]> {
    const assets = (
      this.db
        .prepare('SELECT * FROM assets ORDER BY created_at DESC')
        .all() as unknown as Asset[]
    ).filter((a) => matchesScope(a, scope));
    const employees = this.db
      .prepare('SELECT * FROM employees')
      .all() as unknown as Employee[];
    return enrichAssets(assets, employees);
  }

  async getAssetById(id: string): Promise<Asset | null> {
    const asset = this.db
      .prepare('SELECT * FROM assets WHERE id = ?')
      .get(id) as unknown as Asset | undefined;
    if (!asset) return null;
    if (!asset.assigned_employee_id) {
      return enrichAssets([asset], [])[0] ?? null;
    }
    const emp = this.db
      .prepare('SELECT * FROM employees WHERE id = ?')
      .get(asset.assigned_employee_id) as unknown as Employee | undefined;
    return enrichAssets([asset], emp ? [emp] : [])[0] ?? null;
  }

  async createAsset(asset: Asset): Promise<Asset> {
    const tenantId = asset.tenant_id || 'ten-default-01';
    const orgId = asset.org_id || 'org-default-01';
    this.db
      .prepare(
        `INSERT INTO assets (id, asset_tag, name, category, brand, model, serial_number, purchase_date, cost, warranty_expiry, status, assigned_employee_id, assigned_date, location, notes, created_at, updated_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        asset.id,
        asset.asset_tag,
        asset.name,
        asset.category,
        asset.brand,
        asset.model,
        asset.serial_number,
        asset.purchase_date,
        asset.cost,
        asset.warranty_expiry,
        asset.status,
        asset.assigned_employee_id,
        asset.assigned_date,
        asset.location,
        asset.notes,
        asset.created_at,
        asset.updated_at,
        tenantId,
        orgId
      );
    return (await this.getAssetById(asset.id)) ?? { ...asset, tenant_id: tenantId, org_id: orgId };
  }

  async updateAsset(id: string, patch: Partial<Asset>): Promise<Asset | null> {
    const allowed = [
      'asset_tag',
      'name',
      'category',
      'brand',
      'model',
      'serial_number',
      'purchase_date',
      'cost',
      'warranty_expiry',
      'status',
      'assigned_employee_id',
      'assigned_date',
      'location',
      'notes',
      'updated_at',
      'org_id',
    ];
    const entries = Object.entries(patch).filter(
      ([k, v]) => allowed.includes(k) && v !== undefined
    );
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) => v as string | number | null);
      this.db.prepare(`UPDATE assets SET ${sets} WHERE id = ?`).run(...values, id);
    }
    return this.getAssetById(id);
  }

  async deleteAsset(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    if (Number(res.changes) > 0) {
      this.db.prepare('DELETE FROM assignments WHERE asset_id = ?').run(id);
      this.db.prepare('DELETE FROM maintenance_logs WHERE asset_id = ?').run(id);
      return true;
    }
    return false;
  }

  async listAssignments(scope?: TenantScopeFilter): Promise<AssetAssignment[]> {
    const assignments = (
      this.db
        .prepare('SELECT * FROM assignments ORDER BY created_at DESC')
        .all() as unknown as AssetAssignment[]
    ).filter((a) => matchesScope(a, scope));
    const assets = this.db.prepare('SELECT * FROM assets').all() as unknown as Asset[];
    const employees = this.db
      .prepare('SELECT * FROM employees')
      .all() as unknown as Employee[];
    const users = this.getAllStoredUsers();
    return enrichAssignments(assignments, assets, employees, users);
  }

  async listAssignmentsByAsset(assetId: string): Promise<AssetAssignment[]> {
    const assignments = this.db
      .prepare('SELECT * FROM assignments WHERE asset_id = ? ORDER BY created_at DESC')
      .all(assetId) as unknown as AssetAssignment[];
    if (assignments.length === 0) return [];
    const assets = this.db.prepare('SELECT * FROM assets WHERE id = ?').all(assetId) as unknown as Asset[];
    const employees = this.db.prepare('SELECT * FROM employees').all() as unknown as Employee[];
    const users = this.getAllStoredUsers();
    return enrichAssignments(assignments, assets, employees, users);
  }

  async listAssignmentsByEmployee(employeeId: string): Promise<AssetAssignment[]> {
    const assignments = this.db
      .prepare('SELECT * FROM assignments WHERE employee_id = ? ORDER BY created_at DESC')
      .all(employeeId) as unknown as AssetAssignment[];
    if (assignments.length === 0) return [];
    const assets = this.db.prepare('SELECT * FROM assets').all() as unknown as Asset[];
    const employees = this.db
      .prepare('SELECT * FROM employees WHERE id = ?')
      .all(employeeId) as unknown as Employee[];
    const users = this.getAllStoredUsers();
    return enrichAssignments(assignments, assets, employees, users);
  }

  async getAssignmentById(id: string): Promise<AssetAssignment | null> {
    const asg = this.db
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(id) as unknown as AssetAssignment | undefined;
    if (!asg) return null;
    const assets = this.db.prepare('SELECT * FROM assets WHERE id = ?').all(asg.asset_id) as unknown as Asset[];
    const employees = this.db
      .prepare('SELECT * FROM employees WHERE id = ?')
      .all(asg.employee_id) as unknown as Employee[];
    const users = this.getAllStoredUsers();
    return enrichAssignments([asg], assets, employees, users)[0] ?? null;
  }

  async assignAsset(params: {
    assetId: string;
    employeeId: string;
    assignedByUserId: string;
    assignedDate: string;
    conditionOut: string;
    notes: string;
    tenantId?: string;
    orgId?: string;
  }): Promise<AssetAssignment> {
    const tenantId = params.tenantId || 'ten-default-01';
    const orgId = params.orgId || 'org-default-01';
    const existing = this.db
      .prepare('SELECT handover_number, tenant_id FROM assignments WHERE tenant_id = ?')
      .all(tenantId) as unknown as AssetAssignment[];
    const now = new Date().toISOString();
    const record: AssetAssignment = {
      id: `asg-${crypto.randomUUID().slice(0, 8)}`,
      asset_id: params.assetId,
      employee_id: params.employeeId,
      assigned_by_user_id: params.assignedByUserId,
      assigned_date: params.assignedDate,
      returned_date: null,
      condition_out: params.conditionOut,
      condition_in: null,
      handover_number: nextHandoverNumber(existing),
      notes: params.notes,
      status: 'Active',
      created_at: now,
      tenant_id: tenantId,
      org_id: orgId,
    };

    this.db
      .prepare(
        `INSERT INTO assignments (id, asset_id, employee_id, assigned_by_user_id, assigned_date, returned_date, condition_out, condition_in, handover_number, notes, status, created_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.asset_id,
        record.employee_id,
        record.assigned_by_user_id,
        record.assigned_date,
        record.returned_date,
        record.condition_out,
        record.condition_in,
        record.handover_number,
        record.notes,
        record.status,
        record.created_at,
        tenantId,
        orgId
      );

    this.db
      .prepare(
        "UPDATE assets SET status = 'Assigned', assigned_employee_id = ?, assigned_date = ?, updated_at = ? WHERE id = ?"
      )
      .run(params.employeeId, params.assignedDate, now, params.assetId);

    return (await this.getAssignmentById(record.id)) ?? record;
  }

  async returnAsset(params: {
    assignmentId: string;
    returnedDate: string;
    conditionIn: string;
    returnStatus: 'Available' | 'Under Maintenance' | 'Damaged';
    notes: string;
  }): Promise<AssetAssignment> {
    const existing = this.db
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(params.assignmentId) as unknown as AssetAssignment | undefined;
    if (!existing) {
      throw new Error('Assignment record not found.');
    }
    const now = new Date().toISOString();
    const combinedNotes = params.notes
      ? existing.notes
        ? `${existing.notes} | Return: ${params.notes}`
        : `Return: ${params.notes}`
      : existing.notes;

    this.db
      .prepare(
        "UPDATE assignments SET status = 'Returned', returned_date = ?, condition_in = ?, notes = ? WHERE id = ?"
      )
      .run(params.returnedDate, params.conditionIn, combinedNotes, params.assignmentId);

    this.db
      .prepare(
        'UPDATE assets SET status = ?, assigned_employee_id = NULL, assigned_date = NULL, updated_at = ? WHERE id = ?'
      )
      .run(params.returnStatus, now, existing.asset_id);

    return (await this.getAssignmentById(params.assignmentId))!;
  }

  async updateAssignment(
    id: string,
    patch: Partial<
      Pick<
        AssetAssignment,
        'condition_out' | 'condition_in' | 'notes' | 'assigned_date' | 'returned_date' | 'status'
      >
    >
  ): Promise<AssetAssignment | null> {
    const existing = this.db
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(id) as unknown as AssetAssignment | undefined;
    if (!existing) return null;
    this.db
      .prepare(
        `UPDATE assignments
         SET condition_out = ?, condition_in = ?, notes = ?, assigned_date = ?, returned_date = ?, status = ?
         WHERE id = ?`
      )
      .run(
        patch.condition_out ?? existing.condition_out,
        patch.condition_in !== undefined ? patch.condition_in : existing.condition_in,
        patch.notes !== undefined ? patch.notes : existing.notes,
        patch.assigned_date ?? existing.assigned_date,
        patch.returned_date !== undefined ? patch.returned_date : existing.returned_date,
        patch.status ?? existing.status,
        id
      );
    return this.getAssignmentById(id);
  }

  async deleteAssignment(id: string): Promise<boolean> {
    const existing = this.db
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(id) as unknown as AssetAssignment | undefined;
    if (!existing) return false;
    const res = this.db.prepare('DELETE FROM assignments WHERE id = ?').run(id);
    if (existing.status === 'Active') {
      this.db
        .prepare(
          "UPDATE assets SET status = 'Available', assigned_employee_id = NULL, assigned_date = NULL, updated_at = ? WHERE id = ? AND assigned_employee_id = ?"
        )
        .run(new Date().toISOString(), existing.asset_id, existing.employee_id);
    }
    return Number(res.changes) > 0;
  }

  async listMaintenanceLogs(scope?: TenantScopeFilter): Promise<MaintenanceLog[]> {
    const logs = (
      this.db
        .prepare('SELECT * FROM maintenance_logs ORDER BY service_date DESC, created_at DESC')
        .all() as unknown as MaintenanceLog[]
    ).filter((m) => matchesScope(m, scope));
    const assets = this.db.prepare('SELECT * FROM assets').all() as unknown as Asset[];
    const users = this.getAllStoredUsers();
    return enrichMaintenance(logs, assets, users);
  }

  async listMaintenanceByAsset(assetId: string): Promise<MaintenanceLog[]> {
    const logs = this.db
      .prepare('SELECT * FROM maintenance_logs WHERE asset_id = ? ORDER BY service_date DESC, created_at DESC')
      .all(assetId) as unknown as MaintenanceLog[];
    if (logs.length === 0) return [];
    const assets = this.db.prepare('SELECT * FROM assets WHERE id = ?').all(assetId) as unknown as Asset[];
    const users = this.getAllStoredUsers();
    return enrichMaintenance(logs, assets, users);
  }

  async getMaintenanceById(id: string): Promise<MaintenanceLog | null> {
    const log = this.db
      .prepare('SELECT * FROM maintenance_logs WHERE id = ?')
      .get(id) as unknown as MaintenanceLog | undefined;
    if (!log) return null;
    const assets = this.db.prepare('SELECT * FROM assets WHERE id = ?').all(log.asset_id) as unknown as Asset[];
    const users = this.getAllStoredUsers();
    return enrichMaintenance([log], assets, users)[0] ?? null;
  }

  async createMaintenanceLog(
    log: MaintenanceLog,
    setAssetUnderMaintenance: boolean
  ): Promise<MaintenanceLog> {
    const tenantId = log.tenant_id || 'ten-default-01';
    const orgId = log.org_id || 'org-default-01';
    this.db
      .prepare(
        `INSERT INTO maintenance_logs (id, asset_id, issue_description, maintenance_type, vendor_or_technician, service_date, next_service_date, cost, status, recorded_by_user_id, notes, created_at, tenant_id, org_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        log.id,
        log.asset_id,
        log.issue_description,
        log.maintenance_type,
        log.vendor_or_technician,
        log.service_date,
        log.next_service_date,
        log.cost,
        log.status,
        log.recorded_by_user_id,
        log.notes,
        log.created_at,
        tenantId,
        orgId
      );
    if (setAssetUnderMaintenance && log.status !== 'Completed') {
      this.db
        .prepare("UPDATE assets SET status = 'Under Maintenance', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), log.asset_id);
    }
    return (await this.getMaintenanceById(log.id)) ?? { ...log, tenant_id: tenantId, org_id: orgId };
  }

  async updateMaintenanceLog(
    id: string,
    patch: Partial<MaintenanceLog>
  ): Promise<MaintenanceLog | null> {
    const current = this.db
      .prepare('SELECT * FROM maintenance_logs WHERE id = ?')
      .get(id) as unknown as MaintenanceLog | undefined;
    if (!current) return null;

    const allowed = [
      'issue_description',
      'maintenance_type',
      'vendor_or_technician',
      'service_date',
      'next_service_date',
      'cost',
      'status',
      'notes',
    ];
    const entries = Object.entries(patch).filter(
      ([k, v]) => allowed.includes(k) && v !== undefined
    );
    if (entries.length > 0) {
      const sets = entries.map(([k]) => `${k} = ?`).join(', ');
      const values = entries.map(([, v]) => v as string | number | null);
      this.db.prepare(`UPDATE maintenance_logs SET ${sets} WHERE id = ?`).run(...values, id);
    }

    if (patch.status === 'Completed') {
      const asset = this.db
        .prepare('SELECT * FROM assets WHERE id = ?')
        .get(current.asset_id) as unknown as Asset | undefined;
      if (asset && asset.status === 'Under Maintenance') {
        const restoredStatus: AssetStatus = asset.assigned_employee_id
          ? 'Assigned'
          : 'Available';
        this.db
          .prepare('UPDATE assets SET status = ?, updated_at = ? WHERE id = ?')
          .run(restoredStatus, new Date().toISOString(), asset.id);
      }
    } else if (patch.status === 'In Progress') {
      this.db
        .prepare("UPDATE assets SET status = 'Under Maintenance', updated_at = ? WHERE id = ?")
        .run(new Date().toISOString(), current.asset_id);
    }

    return this.getMaintenanceById(id);
  }

  async deleteMaintenanceLog(id: string): Promise<boolean> {
    const res = this.db.prepare('DELETE FROM maintenance_logs WHERE id = ?').run(id);
    return Number(res.changes) > 0;
  }

  async listNotifications(
    userId: string,
    scope?: TenantScopeFilter
  ): Promise<SystemNotification[]> {
    const [assets, logs] = await Promise.all([
      this.listAssets(scope),
      this.listMaintenanceLogs(scope),
    ]);
    const acks = this.db
      .prepare('SELECT * FROM notification_acks WHERE user_id = ?')
      .all(userId) as unknown as NotificationAck[];
    return computeNotifications(assets, logs, acks);
  }

  async acknowledgeNotifications(userId: string, alertKeys: string[]): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(
      `INSERT INTO notification_acks (id, alert_key, user_id, acknowledged_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(alert_key, user_id) DO UPDATE SET acknowledged_at = excluded.acknowledged_at`
    );
    for (const key of alertKeys) {
      stmt.run(`ack-${crypto.randomUUID().slice(0, 8)}`, key, userId, now);
    }
  }

  async getDashboardSummary(
    userId: string,
    scope?: TenantScopeFilter
  ): Promise<DashboardSummary> {
    const rawAssets = (
      this.db.prepare('SELECT * FROM assets ORDER BY created_at DESC').all() as unknown as Asset[]
    ).filter((a) => matchesScope(a, scope));
    const rawEmployees = (
      this.db.prepare('SELECT * FROM employees ORDER BY full_name ASC').all() as unknown as Employee[]
    ).filter((e) => matchesScope(e, scope));
    const rawAssignments = (
      this.db.prepare('SELECT * FROM assignments ORDER BY created_at DESC').all() as unknown as AssetAssignment[]
    ).filter((a) => matchesScope(a, scope));
    const rawLogs = (
      this.db
        .prepare('SELECT * FROM maintenance_logs ORDER BY service_date DESC, created_at DESC')
        .all() as unknown as MaintenanceLog[]
    ).filter((m) => matchesScope(m, scope));
    const users = this.getAllStoredUsers();
    const acks = this.db
      .prepare('SELECT * FROM notification_acks WHERE user_id = ?')
      .all(userId) as unknown as NotificationAck[];

    const assets = enrichAssets(rawAssets, rawEmployees);
    const assignments = enrichAssignments(rawAssignments, rawAssets, rawEmployees, users);
    const logs = enrichMaintenance(rawLogs, rawAssets, users);
    const notifications = computeNotifications(assets, logs, acks);
    return buildDashboardSummary(assets, rawEmployees, assignments, logs, notifications);
  }

  async resetToCleanState(): Promise<void> {
    this.db.exec(`
      DELETE FROM notification_acks;
      DELETE FROM maintenance_logs;
      DELETE FROM assignments;
      DELETE FROM assets;
      DELETE FROM employees;
      DELETE FROM users;
    `);
    const seed = createSeedData();
    const insertUser = this.db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, department, status, created_at, last_login, email_verified, mfa_enabled, is_super_admin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const u of seed.users) {
      insertUser.run(
        u.id,
        u.name,
        u.email,
        u.password_hash,
        u.role,
        u.department,
        u.status,
        u.created_at,
        u.last_login,
        u.email_verified ? 1 : 0,
        u.mfa_enabled ? 1 : 0,
        u.is_super_admin ? 1 : 0
      );
    }
  }
}

function normalizeMongoUri(raw?: string): string {
  if (!raw) return '';
  let trimmed = raw.trim();
  if (trimmed.startsWith('MONGODB_URI=')) {
    trimmed = trimmed.slice('MONGODB_URI='.length).trim();
  }
  return trimmed.replace(/^["']|["']$/g, '').trim();
}

export async function createDatabase(
  sqlitePathOverride?: string
): Promise<ItamsDatabase> {
  const mongoUri = sqlitePathOverride
    ? ''
    : normalizeMongoUri(process.env.MONGODB_URI);
  if (mongoUri && !process.env.ITAMS_FORCE_SQLITE) {
    const dbName =
      process.env.MONGODB_DB_NAME?.trim().replace(/^["']|["']$/g, '') ||
      'assetvault_it';
    const mongoDb = new MongoItamsDatabase(mongoUri, dbName);
    try {
      await mongoDb.init();
      console.log(`[AssetVault IT] Connected to MongoDB Atlas database "${dbName}".`);
      return mongoDb;
    } catch (err) {
      await mongoDb.closeQuietly();
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(
        `[AssetVault IT] MongoDB Atlas connection failed (${reason}). Check MongoDB Atlas Network Access (allow 0.0.0.0/0) and credentials. Falling back to local persistent SQLite store so the app stays available.`
      );
    }
  }

  if (process.env.VERCEL && !sqlitePathOverride) {
    throw new Error(
      'MONGODB_URI is required when running on Vercel. Configure MONGODB_URI in Vercel Project Environment Variables and allow 0.0.0.0/0 in MongoDB Atlas Network Access.'
    );
  }

  const sqlitePath =
    sqlitePathOverride || path.resolve(process.cwd(), 'data', 'it_assets.db');
  const sqliteDb = new SqliteItamsDatabase(sqlitePath);
  await sqliteDb.init();
  console.log(
    `[AssetVault IT] Using persistent local SQLite store at ${sqlitePath}.`
  );
  return sqliteDb;
}
