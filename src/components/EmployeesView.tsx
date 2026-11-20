import { useMemo, useState, type FormEvent } from 'react';
import { Eye, Pencil, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import {
  DEPARTMENTS,
  type Asset,
  type AssetAssignment,
  type Employee,
  type UserRole,
} from '../types/itams.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface EmployeesViewProps {
  employees: Employee[];
  userRole: UserRole;
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

export function EmployeesView({
  employees,
  userRole,
  onRefresh,
  onToast,
  onRequestAssignToEmployee,
}: EmployeesViewProps) {
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'active' | 'inactive'>('ALL');

  const [formOpen, setFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeeFormState>(EMPTY_EMP);
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
    return employees.filter((e) => {
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
  }, [employees, search, deptFilter, statusFilter]);

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
    setFormError(null);
    setFormOpen(true);
  };

  const openEdit = (emp: Employee) => {
    setEditingEmployee(emp);
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
      if (editingEmployee) {
        await api.updateEmployee(editingEmployee.id, form);
        onToast('success', `Employee ${form.full_name} updated.`);
      } else {
        await api.createEmployee(form);
        onToast('success', `Employee ${form.full_name} registered.`);
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
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, code, email, title..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            aria-label="Filter by department"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none"
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
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none"
          >
            <option value="ALL">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="flex items-center justify-between lg:justify-end gap-3">
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            {filtered.length} of {employees.length} employees
          </span>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Register Employee</span>
          </button>
        </div>
      </div>

      {/* Employee Directory Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Employee ID</th>
                <th className="py-3 px-4">Name & Contact</th>
                <th className="py-3 px-4">Department</th>
                <th className="py-3 px-4">Job Title</th>
                <th className="py-3 px-4">Location</th>
                <th className="py-3 px-4 text-right">Assigned Assets</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No matching employees found
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Adjust filters or register a new employee profile.
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((emp) => (
                  <tr key={emp.id} className="hover:bg-slate-50/70 transition-colors">
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                      {emp.employee_code}
                    </td>
                    <td className="py-2.5 px-4 min-w-[200px]">
                      <button
                        type="button"
                        onClick={() => openDetail(emp)}
                        className="font-medium text-slate-900 hover:text-blue-700 hover:underline text-left"
                      >
                        {emp.full_name}
                      </button>
                      <div className="text-xs text-slate-500">{emp.email}</div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                      {emp.department}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {emp.job_title}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {emp.location}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {emp.assigned_count ?? 0}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-medium whitespace-nowrap">
                      <span
                        className={
                          emp.status === 'active'
                            ? 'text-emerald-700'
                            : 'text-slate-500'
                        }
                      >
                        {emp.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => openDetail(emp)}
                          title="View assigned assets & history"
                          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {emp.status === 'active' && (
                          <button
                            type="button"
                            onClick={() => onRequestAssignToEmployee(emp)}
                            title="Assign asset to employee"
                            className="p-1.5 rounded-md text-blue-700 hover:bg-blue-50"
                          >
                            <UserPlus className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEdit(emp)}
                          title="Edit employee"
                          className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {userRole === 'admin' && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(emp)}
                            title="Delete employee"
                            className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700"
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
      </div>

      {/* Add / Edit Employee Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {editingEmployee
                  ? `Edit Employee · ${editingEmployee.employee_code}`
                  : 'Register Employee'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Work Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    placeholder="jordan.rivera@company.com"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Department *
                  </label>
                  <select
                    value={form.department}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, department: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="+1 (415) 555-0199"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Office Location
                  </label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, location: e.target.value }))
                    }
                    placeholder="e.g. HQ Floor 3 · Desk 3A"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  {submitting
                    ? 'Saving...'
                    : editingEmployee
                      ? 'Save Changes'
                      : 'Register Employee'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Employee Detail Drawer */}
      {detailEmployee && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <div className="font-mono text-xs font-semibold text-blue-700">
                  {detailEmployee.employee_code}
                </div>
                <h3 className="font-display text-lg font-semibold text-slate-900 mt-0.5">
                  {detailEmployee.full_name}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  {detailEmployee.job_title} · {detailEmployee.department}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailEmployee(null)}
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close drawer"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {detailEmployee.status === 'active' && (
                <div>
                  <button
                    type="button"
                    onClick={() => onRequestAssignToEmployee(detailEmployee)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Assign New Asset</span>
                  </button>
                </div>
              )}

              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-xs">
                <div className="grid grid-cols-2 gap-4 p-4">
                  <div>
                    <span className="text-slate-500">Email</span>
                    <div className="mt-0.5 font-medium text-slate-900">
                      {detailEmployee.email}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Phone</span>
                    <div className="mt-0.5 font-medium text-slate-900">
                      {detailEmployee.phone || '—'}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 p-4">
                  <div>
                    <span className="text-slate-500">Location</span>
                    <div className="mt-0.5 font-medium text-slate-900">
                      {detailEmployee.location}
                    </div>
                  </div>
                  <div>
                    <span className="text-slate-500">Status</span>
                    <div className="mt-0.5 font-medium text-slate-900 capitalize">
                      {detailEmployee.status}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900 mb-2.5">
                  Currently Assigned Assets ({detailAssignedAssets.length})
                </h4>
                {detailLoading ? (
                  <p className="text-xs text-slate-500">Loading assigned hardware...</p>
                ) : detailAssignedAssets.length === 0 ? (
                  <p className="text-xs text-slate-500 rounded-lg border border-slate-200 p-4">
                    No IT equipment is currently assigned to this employee.
                  </p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {detailAssignedAssets.map((a) => (
                      <div
                        key={a.id}
                        className="p-3.5 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">
                            {a.name}
                          </div>
                          <div className="text-slate-500 mt-0.5">
                            <span className="font-mono">{a.asset_tag}</span> ·{' '}
                            {a.category} · SN: <span className="font-mono">{a.serial_number}</span>
                          </div>
                        </div>
                        <div className="text-right font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                          Issued {a.assigned_date}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900 mb-2.5">
                  Assignment History ({detailAssignments.length})
                </h4>
                {detailLoading ? (
                  <p className="text-xs text-slate-500">Loading assignment history...</p>
                ) : detailAssignments.length === 0 ? (
                  <p className="text-xs text-slate-500 rounded-lg border border-slate-200 p-4">
                    No historical assignment records found.
                  </p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {detailAssignments.map((asg) => (
                      <div key={asg.id} className="p-3.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {asg.asset_tag} · {asg.asset_name}
                          </span>
                          <span
                            className={`font-medium ${
                              asg.status === 'Active'
                                ? 'text-blue-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {asg.status}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-500 tabular-nums">
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
          </div>
        </div>
      )}

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
