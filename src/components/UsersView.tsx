import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown,
  MailPlus,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext, type ExtendedUser } from '../lib/api.ts';
import { DEPARTMENTS, type UserRole } from '../types/itams.ts';
import type { TenantInvitation, TenantRole } from '../types/saas.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface UsersViewProps {
  users: ExtendedUser[];
  currentUserId: string;
  tenantCtx?: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

interface UserFormState {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  tenant_role: TenantRole;
  department: string;
  status: ExtendedUser['status'];
  org_access_mode: 'all' | 'selected';
  allowed_org_ids: string[];
  mfa_enabled: boolean;
}

type SortField = 'name' | 'role' | 'department' | 'status' | 'last_login';

const TENANT_ROLE_OPTIONS: Array<{ value: TenantRole; label: string; legacy: UserRole }> = [
  { value: 'tenant_owner', label: 'Tenant Owner', legacy: 'admin' },
  { value: 'tenant_admin', label: 'Tenant Admin', legacy: 'admin' },
  { value: 'it_manager', label: 'IT Manager', legacy: 'admin' },
  { value: 'asset_manager', label: 'Asset Manager', legacy: 'staff' },
  { value: 'it_technician', label: 'IT Technician', legacy: 'staff' },
  { value: 'dept_manager', label: 'Department Manager', legacy: 'staff' },
  { value: 'auditor', label: 'Compliance Auditor', legacy: 'staff' },
  { value: 'employee', label: 'Employee Self-Service', legacy: 'staff' },
  { value: 'msp_admin', label: 'MSP Admin', legacy: 'admin' },
  { value: 'msp_manager', label: 'MSP Service Manager', legacy: 'admin' },
  { value: 'msp_technician', label: 'MSP Technician', legacy: 'staff' },
  { value: 'msp_viewer', label: 'MSP Client Viewer', legacy: 'staff' },
];

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function UsersView({
  users,
  currentUserId,
  tenantCtx,
  onRefresh,
  onToast,
  onPlanBlocked,
}: UsersViewProps) {
  const [activeTab, setActiveTab] = useState<'accounts' | 'invitations'>('accounts');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | ExtendedUser['status']>('ALL');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ExtendedUser | null>(null);
  const [form, setForm] = useState<UserFormState>({
    name: '',
    email: '',
    password: '',
    role: 'staff',
    tenant_role: 'it_technician',
    department: 'IT Infrastructure',
    status: 'active',
    org_access_mode: 'all',
    allowed_org_ids: [],
    mfa_enabled: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [invitations, setInvitations] = useState<TenantInvitation[]>([]);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState<{
    name: string;
    email: string;
    role: TenantRole;
    orgAccessMode: 'all' | 'selected';
    allowedOrgIds: string[];
  }>({
    name: '',
    email: '',
    role: 'it_technician',
    orgAccessMode: 'all',
    allowedOrgIds: [],
  });
  const [inviting, setInviting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ExtendedUser | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteInviteTarget, setDeleteInviteTarget] =
    useState<TenantInvitation | null>(null);
  const [deletingInvite, setDeletingInvite] = useState(false);

  const loadInvitations = async () => {
    try {
      const res = await api.listInvitations();
      setInvitations(res.invitations);
    } catch {
      // Optional if permission absent
    }
  };

  useEffect(() => {
    loadInvitations();
  }, [users.length]);

  const availableOrgs = tenantCtx?.availableOrgs ?? [];
  const maxUsers = tenantCtx?.effectiveLimits.maxUsers ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q) ||
        (u.tenant_role || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'last_login') {
        cmp = (a.last_login || '').localeCompare(b.last_login || '');
      } else {
        cmp = String(a[sortField]).localeCompare(String(b[sortField]));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [users, search, roleFilter, statusFilter, sortField, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'last_login' ? 'desc' : 'asc');
    }
  };

  const openCreate = () => {
    setEditingUser(null);
    setForm({
      name: '',
      email: '',
      password: '',
      role: 'staff',
      tenant_role: 'it_technician',
      department: 'IT Infrastructure',
      status: 'active',
      org_access_mode: 'all',
      allowed_org_ids: availableOrgs.slice(0, 1).map((o) => o.id),
      mfa_enabled: false,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (u: ExtendedUser) => {
    setEditingUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      tenant_role: u.tenant_role || (u.role === 'admin' ? 'tenant_admin' : 'it_technician'),
      department: u.department,
      status: u.status,
      org_access_mode: u.org_access_mode || 'all',
      allowed_org_ids: u.allowed_org_ids || [],
      mfa_enabled: Boolean(u.mfa_enabled),
    });
    setFormError(null);
    setFormOpen(true);
  };

  const toggleOrgSelection = (orgId: string, list: string[], setter: (next: string[]) => void) => {
    if (list.includes(orgId)) {
      setter(list.filter((id) => id !== orgId));
    } else {
      setter([...list, orgId]);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim() || !form.email.trim()) {
      setFormError('Full name and email are required.');
      return;
    }
    if (!editingUser && form.password.length < 8) {
      setFormError('Initial password must be at least 8 characters.');
      return;
    }
    if (editingUser && form.password && form.password.length < 8) {
      setFormError('New password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);
    try {
      if (editingUser) {
        await api.updateUser(editingUser.id, {
          name: form.name,
          email: form.email,
          role: form.role,
          tenant_role: form.tenant_role,
          department: form.department,
          status: form.status,
          org_access_mode: form.org_access_mode,
          allowed_org_ids: form.allowed_org_ids,
          mfa_enabled: form.mfa_enabled,
          ...(form.password ? { password: form.password } : {}),
        });
        onToast('success', `User ${form.name} updated.`);
      } else {
        await api.createUser(form);
        onToast('success', `User account ${form.email} created.`);
      }
      setFormOpen(false);
      await onRefresh();
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        (err.code === 'QUOTA_EXCEEDED' || err.code === 'SUBSCRIPTION_READ_ONLY')
      ) {
        setFormOpen(false);
        onPlanBlocked(err);
        return;
      }
      setFormError(
        err instanceof ApiError ? err.message : 'Failed to save user account.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!inviteForm.name.trim() || !inviteForm.email.trim()) return;
    setInviting(true);
    try {
      const res = await api.createInvitation(inviteForm);
      onToast(
        'success',
        `Invitation queued for ${res.invitation.email}. Token: ${res.invitation.token}`
      );
      setInviteOpen(false);
      setInviteForm({
        name: '',
        email: '',
        role: 'it_technician',
        orgAccessMode: 'all',
        allowedOrgIds: [],
      });
      await loadInvitations();
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        (err.code === 'QUOTA_EXCEEDED' || err.code === 'SUBSCRIPTION_READ_ONLY')
      ) {
        setInviteOpen(false);
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to send invitation.'
      );
    } finally {
      setInviting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteUser(deleteTarget.id);
      onToast('success', `User ${deleteTarget.email} removed.`);
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete user.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDeleteInvite = async () => {
    if (!deleteInviteTarget) return;
    setDeletingInvite(true);
    try {
      await api.deleteInvitation(deleteInviteTarget.id);
      onToast('success', `Invitation for ${deleteInviteTarget.email} revoked.`);
      setDeleteInviteTarget(null);
      await loadInvitations();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to revoke invitation.'
      );
    } finally {
      setDeletingInvite(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* RBAC Role Policy & User Seat Quota Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--av-accent-soft)] text-[var(--av-accent)]">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[var(--av-text)]">
              Workspace Governance RBAC
            </h3>
            <p className="text-xs text-[var(--av-text-muted)] mt-1 leading-relaxed">
              Granular permissions across Company IT and MSP Multi-Client roles, including billing, CAB approvals, and licence key visibility.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 dark:bg-teal-500/15 text-teal-600 dark:text-teal-400">
            <UserCog className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[var(--av-text)]">
              Client-Org Isolation
            </h3>
            <p className="text-xs text-[var(--av-text-muted)] mt-1 leading-relaxed">
              Restrict technicians to specific client organisations or grant full workspace visibility across all managed clients.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--av-text)]">
              Plan User Seat Quota
            </span>
            <span className="font-mono font-semibold text-[var(--av-accent)] tabular-nums">
              {tenantCtx?.usage.usersCount ?? users.length} / {maxUsers ?? 'Unlimited'}
            </span>
          </div>
          <div className="mt-2 h-2 w-full rounded-full bg-[var(--av-surface-muted)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[#3B66F6]"
              style={{
                width: `${
                  maxUsers
                    ? Math.min(
                        100,
                        Math.round(
                          ((tenantCtx?.usage.usersCount ?? users.length) / maxUsers) * 100
                        )
                      )
                    : 25
                }%`,
              }}
            />
          </div>
          <p className="mt-2 text-[11px] text-[var(--av-text-subtle)]">
            {tenantCtx?.plan.name ?? 'Enterprise'} plan · {invitations.filter((i) => i.status === 'pending').length} pending invitations
          </p>
        </div>
      </div>

      {/* Filter Toolbar & Sub-tabs */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] p-0.5">
            <button
              type="button"
              onClick={() => setActiveTab('accounts')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'accounts'
                  ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                  : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
              }`}
            >
              Active Directory ({users.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('invitations')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                activeTab === 'invitations'
                  ? 'bg-[var(--av-surface)] text-[var(--av-text)] shadow-xs'
                  : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
              }`}
            >
              Invitations ({invitations.length})
            </button>
          </div>

          {activeTab === 'accounts' && (
            <>
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name, email, role..."
                  className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
                />
              </div>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as 'ALL' | UserRole)}
                aria-label="Filter by role"
                className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
              >
                <option value="ALL">All Roles</option>
                <option value="admin">Admin</option>
                <option value="staff">IT Staff</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as 'ALL' | ExtendedUser['status'])
                }
                aria-label="Filter by status"
                className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
              >
                <option value="ALL">All Statuses</option>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="inactive">Inactive</option>
              </select>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap"
          >
            <MailPlus className="h-3.5 w-3.5 text-[#1AB394]" />
            <span>Invite Member</span>
          </button>
          <motion.button
            whileTap={{ scale: 0.985 }}
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap"
          >
            <Plus className="h-4 w-4" />
            <span>Add User</span>
          </motion.button>
        </div>
      </div>

      {activeTab === 'accounts' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('name')}
                      className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                    >
                      <span>User</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('role')}
                      className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                    >
                      <span>Workspace Role</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">Client Scope</th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('department')}
                      className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                    >
                      <span>Department</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('status')}
                      className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                    >
                      <span>Status</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4">
                    <button
                      type="button"
                      onClick={() => toggleSort('last_login')}
                      className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                    >
                      <span>Last Login</span>
                      <ArrowUpDown className="h-3 w-3" />
                    </button>
                  </th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--av-border-subtle)] text-sm">
                {paginated.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        icon={Users}
                        title="No user accounts match filters"
                        description="Adjust search criteria or provision a new workspace account."
                        actionLabel={users.length === 0 ? 'Add User' : undefined}
                        onAction={users.length === 0 ? openCreate : undefined}
                      />
                    </td>
                  </tr>
                ) : (
                  paginated.map((u) => {
                    const roleLabel =
                      TENANT_ROLE_OPTIONS.find((r) => r.value === u.tenant_role)?.label ||
                      (u.role === 'admin' ? 'Admin' : 'IT Staff');
                    const orgScopeLabel =
                      u.org_access_mode === 'selected'
                        ? `${u.allowed_org_ids?.length ?? 0} client orgs`
                        : 'All Orgs';
                    return (
                      <tr
                        key={u.id}
                        className="hover:bg-[var(--av-surface-hover)] transition-colors"
                      >
                        <td className="py-3 px-4 min-w-[220px]">
                          <div className="font-semibold text-[13px] text-[var(--av-text)]">
                            {u.name}
                            {u.id === currentUserId && (
                              <span className="ml-2 text-xs font-medium text-[var(--av-accent)]">
                                · Current Session
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-[var(--av-text-subtle)]">
                            {u.email}
                            {u.mfa_enabled ? ' · MFA On' : ''}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                          <span
                            className={
                              u.role === 'admin'
                                ? 'text-[var(--av-accent)]'
                                : 'text-[var(--av-text-muted)]'
                            }
                          >
                            {roleLabel}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                          {orgScopeLabel}
                        </td>
                        <td className="py-3 px-4 text-xs text-[var(--av-text-muted)]">
                          {u.department}
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                          <span
                            className={
                              u.status === 'active'
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : u.status === 'pending'
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-[var(--av-text-subtle)]'
                            }
                          >
                            {u.status === 'active'
                              ? 'Active'
                              : u.status === 'pending'
                                ? 'Pending'
                                : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-[var(--av-text-muted)] tabular-nums whitespace-nowrap">
                          {u.last_login
                            ? new Date(u.last_login).toLocaleString('en-US', {
                                year: 'numeric',
                                month: 'short',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : 'Never'}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => openEdit(u)}
                              title="Edit user"
                              className="p-1.5 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 transition-colors"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            {u.id !== currentUserId && (
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(u)}
                                title="Delete user"
                                className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <DataPagination
            totalItems={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="users"
          />
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {invitations.length === 0 ? (
            <EmptyState
              icon={MailPlus}
              title="No workspace invitations sent yet"
              description="Invite technicians, auditors, or department managers with scoped role access."
              actionLabel="Invite Member"
              onAction={() => setInviteOpen(true)}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                    <th className="py-3 px-4">Invitee</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Org Access</th>
                    <th className="py-3 px-4">Token</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Expires</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--av-text)]">{inv.name}</div>
                        <div className="text-[var(--av-text-subtle)]">{inv.email}</div>
                      </td>
                      <td className="py-3 px-4 font-medium text-[var(--av-text)]">
                        {TENANT_ROLE_OPTIONS.find((r) => r.value === inv.role)?.label || inv.role}
                      </td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">
                        {inv.orgAccessMode === 'selected'
                          ? `${inv.allowedOrgIds.length} client orgs`
                          : 'All Orgs'}
                      </td>
                      <td className="py-3 px-4 font-mono text-[var(--av-accent)]">{inv.token}</td>
                      <td className="py-3 px-4 font-semibold capitalize text-amber-600 dark:text-amber-400">
                        {inv.status}
                      </td>
                      <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-subtle)]">
                        {inv.expiresAt.slice(0, 10)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setDeleteInviteTarget(inv)}
                          title="Revoke / delete invitation"
                          className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Add / Edit User Modal */}
      <AnimatePresence>
        {formOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    {editingUser
                      ? `Edit Account · ${editingUser.name}`
                      : 'Create System User'}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Configure workspace role, client organisation scope, and security status.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  aria-label="Close modal"
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="overflow-y-auto px-6 py-5 space-y-4">
                {formError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-300">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, name: e.target.value }))
                      }
                      placeholder="e.g. Morgan Ellis"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, email: e.target.value }))
                      }
                      placeholder="morgan.ellis@company.com"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Workspace Role *
                    </label>
                    <select
                      value={form.tenant_role}
                      onChange={(e) => {
                        const val = e.target.value as TenantRole;
                        const opt = TENANT_ROLE_OPTIONS.find((r) => r.value === val);
                        setForm((f) => ({
                          ...f,
                          tenant_role: val,
                          role: opt?.legacy ?? 'staff',
                        }));
                      }}
                      className={INPUT_CLASS}
                    >
                      {TENANT_ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Department
                    </label>
                    <select
                      value={form.department}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, department: e.target.value }))
                      }
                      className={INPUT_CLASS}
                    >
                      {DEPARTMENTS.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {availableOrgs.length > 0 && (
                  <div className="rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[var(--av-text)]">
                        Client Organisation Access Scope
                      </span>
                      <select
                        value={form.org_access_mode}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            org_access_mode: e.target.value as 'all' | 'selected',
                          }))
                        }
                        className="rounded-md border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1 text-xs text-[var(--av-text)]"
                      >
                        <option value="all">All Client Orgs</option>
                        <option value="selected">Selected Orgs Only</option>
                      </select>
                    </div>
                    {form.org_access_mode === 'selected' && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-1">
                        {availableOrgs.map((org) => (
                          <label
                            key={org.id}
                            className="flex items-center gap-2 text-xs text-[var(--av-text-muted)]"
                          >
                            <input
                              type="checkbox"
                              checked={form.allowed_org_ids.includes(org.id)}
                              onChange={() =>
                                toggleOrgSelection(
                                  org.id,
                                  form.allowed_org_ids,
                                  (next) =>
                                    setForm((f) => ({ ...f, allowed_org_ids: next }))
                                )
                              }
                              className="h-3.5 w-3.5 accent-[var(--av-accent)]"
                            />
                            <span className="truncate">
                              {org.name} ({org.code})
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      {editingUser ? 'New Password (optional)' : 'Initial Password *'}
                    </label>
                    <input
                      type="password"
                      required={!editingUser}
                      minLength={editingUser ? undefined : 8}
                      value={form.password}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, password: e.target.value }))
                      }
                      placeholder={
                        editingUser ? 'Leave blank to keep current' : 'Min 8 characters'
                      }
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Account Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as ExtendedUser['status'],
                        }))
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                <label className="flex items-center gap-2.5 text-xs text-[var(--av-text-muted)]">
                  <input
                    type="checkbox"
                    checked={form.mfa_enabled}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mfa_enabled: e.target.checked }))
                    }
                    className="h-4 w-4 accent-[var(--av-accent)]"
                  />
                  <span>Require MFA verification policy on account</span>
                </label>

                <div className="flex items-center justify-end gap-2.5 border-t border-[var(--av-border-subtle)] pt-4">
                  <button
                    type="button"
                    onClick={() => setFormOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors disabled:opacity-60"
                  >
                    {submitting
                      ? 'Saving...'
                      : editingUser
                        ? 'Save Changes'
                        : 'Create Account'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Invite Member Modal */}
      <AnimatePresence>
        {inviteOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Invite Workspace Member
                </h3>
                <button
                  type="button"
                  onClick={() => setInviteOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={handleCreateInvite} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteForm.name}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, name: e.target.value }))
                    }
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Email Address *
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteForm.email}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, email: e.target.value }))
                    }
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Assigned Role *
                  </label>
                  <select
                    value={inviteForm.role}
                    onChange={(e) =>
                      setInviteForm((f) => ({
                        ...f,
                        role: e.target.value as TenantRole,
                      }))
                    }
                    className={INPUT_CLASS}
                  >
                    {TENANT_ROLE_OPTIONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setInviteOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={inviting}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                  >
                    {inviting ? 'Sending...' : 'Generate Invitation'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete User Account"
        description={`Remove access for "${deleteTarget?.name} (${deleteTarget?.email})"? They will immediately lose access to AssetVault IT.`}
        confirmLabel="Delete Account"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={Boolean(deleteInviteTarget)}
        title="Revoke Workspace Invitation"
        description={`Revoke and remove the invitation for "${deleteInviteTarget?.name} (${deleteInviteTarget?.email})"? Its token will no longer be usable.`}
        confirmLabel="Revoke Invitation"
        loading={deletingInvite}
        onConfirm={handleConfirmDeleteInvite}
        onCancel={() => setDeleteInviteTarget(null)}
      />
    </div>
  );
}
