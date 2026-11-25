import { hashPassword } from './auth.ts';
import { BOOTSTRAP_SUPER_ADMIN_EMAIL } from './rbac.ts';
import type {
  Asset,
  AssetAssignment,
  Employee,
  MaintenanceLog,
  User,
} from '../src/types/itams.ts';

export interface StoredUser extends User {
  password_hash: string;
}

export function createSeedData(): {
  users: StoredUser[];
  employees: Employee[];
  assets: Asset[];
  assignments: AssetAssignment[];
  maintenanceLogs: MaintenanceLog[];
} {
  const now = new Date().toISOString();
  const superAdminInitialPass =
    process.env.SUPER_ADMIN_INITIAL_PASSWORD?.trim() || 'SuperAdmin@2026!';

  // Bootstrap primary administrator + platform Super Admin account; operational tables start empty
  const users: StoredUser[] = [
    {
      id: 'usr-admin-01',
      name: 'System Administrator',
      email: 'admin@assetvault.io',
      password_hash: hashPassword('Admin@1234'),
      role: 'admin',
      department: 'IT Infrastructure',
      status: 'active',
      created_at: now,
      last_login: null,
      email_verified: true,
      mfa_enabled: false,
      is_super_admin: false,
    },
    {
      id: 'usr-superadmin-01',
      name: 'Platform Super Admin',
      email: BOOTSTRAP_SUPER_ADMIN_EMAIL,
      password_hash: hashPassword(superAdminInitialPass),
      role: 'admin',
      department: 'Platform Governance',
      status: 'active',
      created_at: now,
      last_login: null,
      email_verified: true,
      mfa_enabled: false,
      is_super_admin: true,
    },
  ];

  return {
    users,
    employees: [],
    assets: [],
    assignments: [],
    maintenanceLogs: [],
  };
}
