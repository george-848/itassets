import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown,
  Eye,
  Loader2,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import {
  DEPARTMENTS,
  type Asset,
  type AssetAssignment,
  type Employee,
  type UserRole,
} from '../types/itams.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { CustomFieldInputs, CustomFieldValuesDisplay } from './CustomFieldsSection.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface EmployeesViewProps {
  employees: Employee[];
  userRole: UserRole;
  tenantCtx?: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onRequestAssignToEmployee: (employee: Employee) => void;
}

interface EmployeeFormState {
  employee_code: string;
  full_name: string;
  email: string;
  department: string;
  job_title: string;
  phone: string;
  location: string;
  status: 'active' | 'inactive';
}

const EMPTY_EMP: EmployeeFormState = {
  employee_code: '',
  full_name: '',
  email: '',
  department: 'Engineering',
  job_title: '',
  phone: '',
  location: '',
  status: 'active',
};

type SortField = 'employee_code' | 'full_name' | 'department' | 'assigned_count';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function EmployeesView({
  employees,
  userRole,
  tenantCtx,
  onRefresh,
  onToast,
  onRequestAssignToEmployee,
}: EmployeesViewProps) {
  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const hasCustomFields = !tenantCtx || tenantCtx.effectiveFeatures.includes('custom_fields');
  const perms = tenantCtx?.permissions;
  const canManage = !isReadOnly && (perms ? perms.includes('employees.manage') : true);
  const canDelete = !isReadOnly && (perms ? perms.includes('employees.manage') && userRole === 'admin' : userRole === 'admin');
  const canAssign = !isReadOnly && (perms ? perms.includes('assignments.manage') : true);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');
  const [sortField, setSortField] = useState<SortField>('employee_code');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeFormState>(EMPTY_EMP);
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [detailEmployee, setDetailEmployee] = useState<Employee | null>(null);
  const [detailAssignedAssets, setDetailAssignedAssets] = useState<Asset[]>([]);
  const [detailAssignments, setDetailAssignments] = useState<AssetAssignment[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = employees.filter((e) => {
      if (deptFilter !== 'ALL' && e.department !== deptFilter) return false;
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;
      if (!q) return true;
      return (
        e.full_name.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.job_title.toLowerCase().includes(q) ||
        e.department.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'assigned_count') {
        cmp = (a.assigned_count ?? 0) - (b.assigned_count ?? 0);
      } else {
        cmp = String(a[sortField]).localeCompare(String(b[sortField]));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [employees, search, deptFilter, statusFilter, sortField, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, deptFilter, statusFilter]);

  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const openDetail = async (employee: Employee) => {
    setDetailEmployee(employee);
    setDetailLoading(true);
    try {
      const res = await api.getEmployeeDetail(employee.id);
      setDetailEmployee(res.employee);
      setDetailAssignedAssets(res.assignedAssets);
      setDetailAssignments(res.assignments);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load employee profile.'
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const openCreate = () => {
    setEditingEmployee(null);
    setForm(EMPTY_EMP);
    setCustomValues({});
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
    setCustomValues({});
    if (hasCustomFields) {
      void api
        .getCustomFieldValues('employee', emp.id)
        .then((res) => setCustomValues(res.values))
        .catch(() => {});
    }
    setForm({
      employee_code: emp.employee_code,
      full_name: emp.full_name,
      email: emp.email,
      department: emp.department,
      job_title: emp.job_title,
      phone: emp.phone,
      location: emp.location,
      status: emp.status,
    });
    setFormError(null);
    setFormOpen(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (
      !form.employee_code.trim() ||
      !form.full_name.trim() ||
      !form.email.trim() ||
      !form.job_title.trim()
    ) {
      setFormError(
        'Employee ID, Full Name, Work Email, and Job Title are required.'
      );
      return;
    }

    setSubmitting(true);
    try {
      let savedId = editingEmployee?.id;
      if (editingEmployee) {
        await api.updateEmployee(editingEmployee.id, form);
        onToast('success', `Employee ${form.full_name} updated.`);
      } else {
        const created = await api.createEmployee(form);
        savedId = created.employee.id;
        onToast('success', `Employee ${form.full_name} registered.`);
      }
      if (hasCustomFields && savedId && Object.keys(customValues).length > 0) {
        await api.saveCustomFieldValues('employee', savedId, customValues).catch(() => {});
      }
      setFormOpen(false);
      await onRefresh();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Failed to save employee.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteEmployee(deleteTarget.id);
      onToast('success', `Employee ${deleteTarget.full_name} removed.`);
      if (detailEmployee?.id === deleteTarget.id) {
        setDetailEmployee(null);
      }
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete employee.'
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, email, title..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
            />
          </div>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Departments</option>
            {DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(e.target.value as 'ALL' | 'active' | 'inactive')
            }
            aria-label="Filter by status"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="flex items-center justify-between lg:justify-end gap-3">
          <span className="text-xs font-medium text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap">
            {filtered.length} of {employees.length} employees
          </span>
          {canManage && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Register Employee</span>
            </motion.button>
          )}
        </div>
      </div>

      {/* Employee Directory Table */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('employee_code')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Employee ID</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('full_name')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Name & Contact</span>
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
                <th className="py-3 px-4">Job Title</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('assigned_count')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)] ml-auto"
                  >
                    <span>Assigned Assets</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-sm">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      icon={Users}
                      title="No matching employees found"
                      description="Adjust filters or register a new employee profile in the corporate directory."
                      actionLabel={canManage && employees.length === 0 ? 'Register Employee' : undefined}
                      onAction={canManage && employees.length === 0 ? openCreate : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((emp) => (
                  <tr
                    key={emp.id}
                    className="hover:bg-[var(--av-surface-hover)] transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-xs font-semibold text-[var(--av-text)] whitespace-nowrap">
                      {emp.employee_code}
                    </td>
                    <td className="py-3 px-4 min-w-[200px]">
                      <button
                        type="button"
                        onClick={() => openDetail(emp)}
                        className="font-semibold text-[13px] text-[var(--av-text)] hover:text-[var(--av-accent)] hover:underline text-left"
                      >
                        {emp.full_name}
                      </button>
                      <div className="text-xs text-[var(--av-text-subtle)]">
                        {emp.email}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                      {emp.department}
                    </td>
                    <td className="py-3 px-4 text-xs text-[var(--av-text-subtle)]">
                      {emp.job_title}
                    </td>
                    <td className="py-3 px-4 text-xs text-[var(--av-text-subtle)]">
                      {emp.location}
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-[var(--av-text)] tabular-nums">
                      {emp.assigned_count ?? 0}
                    </td>
                    <td className="py-3 px-4 text-xs font-semibold whitespace-nowrap">
                      <span
                        className={
                          emp.status === 'active'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-500 dark:text-slate-400'
                        }
                      >
                        {emp.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openDetail(emp)}
                          title="View assigned assets & history"
                          className="p-1.5 rounded-md text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/15 transition-colors"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {canAssign && emp.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => onRequestAssignToEmployee(emp)}
                            title="Assign asset to employee"
                            className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/15 transition-colors"
                          >
                            <UserPlus className="h-4 w-4" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => openEdit(emp)}
                            title="Edit employee"
                            className="p-1.5 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(emp)}
                            title="Delete employee"
                            className="p-1.5 rounded-md text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
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
          itemLabel="employees"
        />
      </div>

      {/* Add / Edit Employee Modal */}
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
              className="w-full max-w-xl rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  {editingEmployee
                    ? `Edit Employee · ${editingEmployee.employee_code}`
                    : 'Register Employee'}
                </h3>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                {formError && (
                  <div className="rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-300">
                    {formError}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Employee Code *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.employee_code}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          employee_code: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="e.g. EMP-1012"
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.full_name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, full_name: e.target.value }))
                      }
                      placeholder="e.g. Jordan Rivera"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Work Email *
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      placeholder="jordan.rivera@company.com"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Department *
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
                      Job Title *
                    </label>
                    <input
                      type="text"
                      required
                      value={form.job_title}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, job_title: e.target.value }))
                      }
                      placeholder="e.g. Senior Security Analyst"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Phone Number
                    </label>
                    <input
                      type="text"
                      value={form.phone}
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                      placeholder="+1 (415) 555-0199"
                      className={INPUT_CLASS}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Office Location
                    </label>
                    <input
                      type="text"
                      value={form.location}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, location: e.target.value }))
                      }
                      placeholder="e.g. HQ Floor 3 · Desk 3A"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                      Employment Status
                    </label>
                    <select
                      value={form.status}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          status: e.target.value as 'active' | 'inactive',
                        }))
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="active">Active</option>
                      <option value="inactive">Inactive</option>
                    </select>
                  </div>
                </div>

                {hasCustomFields && (
                  <CustomFieldInputs
                    entityType="employee"
                    values={customValues}
                    onChange={setCustomValues}
                  />
                )}

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
                      : editingEmployee
                        ? 'Save Changes'
                        : 'Register Employee'}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Employee Detail Drawer */}
      <AnimatePresence>
        {detailEmployee && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setDetailEmployee(null)}
            className="fixed inset-0 z-40 flex justify-end bg-slate-950/55 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-xl bg-[var(--av-surface)] h-full border-l border-[var(--av-border)] flex flex-col shadow-2xl"
            >
              <div className="flex items-start justify-between gap-4 border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] px-6 py-5">
                <div>
                  <div className="font-mono text-xs font-semibold text-[var(--av-accent)]">
                    {detailEmployee.employee_code}
                  </div>
                  <h3 className="font-display text-lg font-bold text-[var(--av-text)] mt-0.5">
                    {detailEmployee.full_name}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    {detailEmployee.job_title} · {detailEmployee.department}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailEmployee(null)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  aria-label="Close drawer"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {canAssign && detailEmployee.status === 'active' && (
                  <div>
                    <button
                      type="button"
                      onClick={() => onRequestAssignToEmployee(detailEmployee)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Assign New Asset</span>
                    </button>
                  </div>
                )}

                <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)] text-xs">
                  <div className="grid grid-cols-2 gap-4 p-4">
                    <div>
                      <span className="text-[var(--av-text-subtle)]">Email</span>
                      <div className="mt-0.5 font-semibold text-[var(--av-text)]">
                        {detailEmployee.email}
                      </div>
                    </div>
                    <div>
                      <span className="text-[var(--av-text-subtle)]">Phone</span>
                      <div className="mt-0.5 font-semibold text-[var(--av-text)]">
                        {detailEmployee.phone || '—'}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 p-4">
                    <div>
                      <span className="text-[var(--av-text-subtle)]">Location</span>
                      <div className="mt-0.5 font-semibold text-[var(--av-text)]">
                        {detailEmployee.location}
                      </div>
                    </div>
                    <div>
                      <span className="text-[var(--av-text-subtle)]">Status</span>
                      <div className="mt-0.5 font-semibold text-[var(--av-text)] capitalize">
                        {detailEmployee.status}
                      </div>
                    </div>
                  </div>
                </div>

                {hasCustomFields && (
                  <CustomFieldValuesDisplay entityType="employee" entityId={detailEmployee.id} />
                )}

                <div>
                  <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2.5">
                    Currently Assigned Assets ({detailAssignedAssets.length})
                  </h4>
                  {detailLoading ? (
                    <div className="space-y-2 rounded-xl border border-[var(--av-border)] p-3.5">
                      <div className="flex items-center gap-2 text-xs text-[var(--av-text-subtle)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--av-accent)]" />
                        <span>Loading assigned hardware...</span>
                      </div>
                      <div className="h-8 w-full rounded-lg av-shimmer" />
                    </div>
                  ) : detailAssignedAssets.length === 0 ? (
                    <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                      No IT equipment is currently assigned to this employee.
                    </p>
                  ) : (
                    <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                      {detailAssignedAssets.map((a) => (
                        <div
                          key={a.id}
                          className="p-3.5 flex items-center justify-between gap-3 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-[var(--av-text)]">
                              {a.name}
                            </div>
                            <div className="text-[var(--av-text-subtle)] mt-0.5">
                              <span className="font-mono">{a.asset_tag}</span> ·{' '}
                              {a.category} · SN:{' '}
                              <span className="font-mono">{a.serial_number}</span>
                            </div>
                          </div>
                          <div className="text-right font-mono text-[11px] text-[var(--av-text-subtle)] tabular-nums shrink-0">
                            Issued {a.assigned_date}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2.5">
                    Assignment History ({detailAssignments.length})
                  </h4>
                  {detailLoading ? (
                    <div className="space-y-2 rounded-xl border border-[var(--av-border)] p-3.5">
                      <div className="flex items-center gap-2 text-xs text-[var(--av-text-subtle)]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--av-accent)]" />
                        <span>Loading assignment history...</span>
                      </div>
                      <div className="h-8 w-full rounded-lg av-shimmer" />
                    </div>
                  ) : detailAssignments.length === 0 ? (
                    <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                      No historical assignment records found.
                    </p>
                  ) : (
                    <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                      {detailAssignments.map((asg) => (
                        <div key={asg.id} className="p-3.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[var(--av-text)]">
                              {asg.asset_tag} · {asg.asset_name}
                            </span>
                            <span
                              className={`font-semibold ${
                                asg.status === 'Active'
                                  ? 'text-[var(--av-accent)]'
                                  : 'text-[var(--av-text-muted)]'
                              }`}
                            >
                              {asg.status}
                            </span>
                          </div>
                          <div className="mt-1 text-[var(--av-text-subtle)] tabular-nums">
                            {asg.handover_number} · Issued {asg.assigned_date}
                            {asg.returned_date
                              ? ` · Returned ${asg.returned_date} (${asg.condition_in})`
                              : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete Employee Record"
        description={`Are you sure you want to delete "${deleteTarget?.full_name} (${deleteTarget?.employee_code})"? Employees with active assigned assets cannot be deleted until equipment is returned.`}
        confirmLabel="Delete Employee"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
