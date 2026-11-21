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

const TOKEN_STORAGE_KEY = 'assetvault_session_token';

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
    }
  } catch {
    // Ignore storage errors
  }
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
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
      data = { error: text };
    }
  }

  if (!res.ok) {
    const message =
      typeof data.error === 'string' && data.error
        ? data.error
        : `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export const api = {
  // Auth
  login: (email: string, password: string) =>
    request<{ token: string; user: User; engine: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  loginWithGoogle: (googleAccessToken: string) =>
    request<{ token: string; user: User; engine: string }>('/api/auth/google', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${googleAccessToken}`,
      },
    }),
  getGitHubAuthUrl: () =>
    request<{ url: string; redirectUri: string }>(
      `/api/auth/github/url?origin=${encodeURIComponent(window.location.origin)}`
    ),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User; engine: string }>('/api/auth/me'),

  // Dashboard
  getDashboard: () => request<DashboardSummary>('/api/dashboard'),

  // Assets
  listAssets: () => request<{ assets: Asset[] }>('/api/assets'),
  getAssetDetail: (id: string) =>
    request<{
      asset: Asset;
      assignments: AssetAssignment[];
      maintenanceLogs: MaintenanceLog[];
    }>(`/api/assets/${encodeURIComponent(id)}`),
  createAsset: (payload: Partial<Asset>) =>
    request<{ asset: Asset }>('/api/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAsset: (id: string, payload: Partial<Asset>) =>
    request<{ asset: Asset }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
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

  // Users (Admin)
  listUsers: () => request<{ users: User[] }>('/api/users'),
  createUser: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    department: string;
    status: 'active' | 'inactive';
  }) =>
    request<{ user: User }>('/api/users', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateUser: (
    id: string,
    payload: {
      name: string;
      email: string;
      role: UserRole;
      department: string;
      status: 'active' | 'inactive';
      password?: string;
    }
  ) =>
    request<{ user: User }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteUser: (id: string) =>
    request<{ ok: boolean }>(`/api/users/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
