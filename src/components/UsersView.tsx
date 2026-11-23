import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import { DEPARTMENTS, type User, type UserRole } from '../types/itams.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface UsersViewProps {
  users: User[];
  currentUserId: string;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

interface UserFormState {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  department: string;
  status: User['status'];
}

type SortField = 'name' | 'role' | 'department' | 'status' | 'last_login';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function UsersView({
  users,
  currentUserId,
  onRefresh,
  onToast,
}: UsersViewProps) {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | User['status']>('ALL');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserFormState>({
    name: '',
    email: '',
    password: '',
    role: 'staff',
    department: 'IT Infrastructure',
    status: 'active',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = users.filter((u) => {
      if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
      if (statusFilter !== 'ALL' && u.status !== statusFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
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
      department: 'IT Infrastructure',
      status: 'active',
    });
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (u: User) => {
    setEditingUser(u);
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      department: u.department,
      status: u.status,
    });
    setFormError(null);
    setFormOpen(true);
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
          department: form.department,
          status: form.status,
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
      setFormError(
        err instanceof ApiError ? err.message : 'Failed to save user account.'
      );
    } finally {
      setSubmitting(false);
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

  return (
    <div className="space-y-4">
      {/* RBAC Role Policy Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--av-accent-soft)] text-[var(--av-accent)]">
            <ShieldCheck className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[var(--av-text)]">
              Admin Role
            </h3>
            <p className="text-xs text-[var(--av-text-muted)] mt-1 leading-relaxed">
              Full system access: inventory CRUD, destructive deletions, user
              provisioning, and role governance.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4.5 shadow-[var(--av-card-shadow)] flex items-start gap-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--av-surface-muted)] text-[var(--av-text-muted)]">
            <UserCog className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-xs font-semibold text-[var(--av-text)]">
              IT Staff Role
            </h3>
            <p className="text-xs text-[var(--av-text-muted)] mt-1 leading-relaxed">
              Operational access: register/edit assets, assign/return hardware, log
              maintenance, and export reports.
            </p>
          </div>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--av-text-subtle)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, department..."
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
              setStatusFilter(e.target.value as 'ALL' | User['status'])
            }
            aria-label="Filter by status"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="flex items-center justify-between lg:justify-end gap-3">
          <span className="text-xs font-medium text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap">
            {filtered.length} of {users.length} accounts
          </span>
          <motion.button
            whileTap={{ scale: 0.985 }}
            type="button"
            onClick={openCreate}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add User</span>
          </motion.button>
        </div>
      </div>

      {/* Users Table */}
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
                    <span>Role</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
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
                  <td colSpan={6}>
                    <EmptyState
                      icon={Users}
                      title="No user accounts match filters"
                      description="Adjust search criteria or provision a new Admin or IT Staff system account."
                      actionLabel={users.length === 0 ? 'Add User' : undefined}
                      onAction={users.length === 0 ? openCreate : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((u) => (
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
                        {u.role === 'admin' ? 'Admin' : 'IT Staff'}
                      </span>
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
                          className="p-1.5 rounded-md text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-muted)] hover:text-[var(--av-text)] transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {u.id !== currentUserId && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            title="Delete user"
                            className="p-1.5 rounded-md text-[var(--av-text-subtle)] hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-400 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
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
              className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.38)] overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    {editingUser
                      ? `Edit Account · ${editingUser.name}`
                      : 'Create System User'}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Configure console access role, department scope, and account status.
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

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                {formError && (
                  <div className="rounded-lg border border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 px-3.5 py-2.5 text-sm text-red-800 dark:text-red-300">
                    {formError}
                  </div>
                )}

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
                    placeholder="morgan.ellis@assetvault.io"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Access Role *
                    </label>
                    <select
                      value={form.role}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, role: e.target.value as UserRole }))
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="staff">IT Staff</option>
                      <option value="admin">Admin</option>
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
                          status: e.target.value as User['status'],
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete User Account"
        description={`Remove access for "${deleteTarget?.name} (${deleteTarget?.email})"? They will immediately lose access to AssetVault IT.`}
        confirmLabel="Delete Account"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
