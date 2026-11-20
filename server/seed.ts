import { hashPassword } from './auth.ts';
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

  // Bootstrap primary administrator account only; all operational tables start empty
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
