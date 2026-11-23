import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpDown,
  Eye,
  HardDrive,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  type Asset,
  type AssetAssignment,
  type AssetCategory,
  type AssetStatus,
  type MaintenanceLog,
  type UserRole,
} from '../types/itams.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import {
  AssetStatusIndicator,
  MaintenanceStatusIndicator,
  formatCurrencyExact,
} from './StatusText.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface AssetsViewProps {
  assets: Asset[];
  userRole: UserRole;
  selectedAssetId: string | null;
  onClearSelectedAsset: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onRequestAssign: (asset: Asset) => void;
  onRequestMaintenance: (asset: Asset) => void;
}

interface AssetFormState {
  asset_tag: string;
  name: string;
  category: AssetCategory;
  brand: string;
  model: string;
  serial_number: string;
  purchase_date: string;
  cost: string;
  warranty_expiry: string;
  status: AssetStatus;
  location: string;
  notes: string;
}

const EMPTY_FORM: AssetFormState = {
  asset_tag: '',
  name: '',
  category: 'Laptops',
  brand: '',
  model: '',
  serial_number: '',
  purchase_date: new Date().toISOString().slice(0, 10),
  cost: '',
  warranty_expiry: '',
  status: 'Available',
  location: 'IT Vault',
  notes: '',
};

type SortField = 'asset_tag' | 'name' | 'purchase_date' | 'cost' | 'warranty_expiry';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function AssetsView({
  assets,
  userRole,
  selectedAssetId,
  onClearSelectedAsset,
  onRefresh,
  onToast,
  onRequestAssign,
  onRequestMaintenance,
}: AssetsViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [sortField, setSortField] = useState<SortField>('asset_tag');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [formOpen, setFormOpen] = useState(false);
  const [formStep, setFormStep] = useState<1 | 2>(1);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [form, setForm] = useState<AssetFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [detailAssignments, setDetailAssignments] = useState<AssetAssignment[]>([]);
  const [detailMaintenance, setDetailMaintenance] = useState<MaintenanceLog[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (selectedAssetId) {
      openDetail(selectedAssetId);
      onClearSelectedAsset();
    }
  }, [selectedAssetId]);

  const openDetail = async (assetId: string) => {
    setDetailLoading(true);
    const localMatch = assets.find((a) => a.id === assetId) ?? null;
    setDetailAsset(localMatch);
    try {
      const res = await api.getAssetDetail(assetId);
      setDetailAsset(res.asset);
      setDetailAssignments(res.assignments);
      setDetailMaintenance(res.maintenanceLogs);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load asset details.'
      );
    } finally {
      setDetailLoading(false);
    }
  };

  const openCreateModal = () => {
    setEditingAsset(null);
    const today = new Date();
    const warranty = new Date(today);
    warranty.setFullYear(warranty.getFullYear() + 3);
    setForm({
      ...EMPTY_FORM,
      purchase_date: today.toISOString().slice(0, 10),
      warranty_expiry: warranty.toISOString().slice(0, 10),
    });
    setFormStep(1);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setForm({
      asset_tag: asset.asset_tag,
      name: asset.name,
      category: asset.category,
      brand: asset.brand,
      model: asset.model,
      serial_number: asset.serial_number,
      purchase_date: asset.purchase_date,
      cost: String(asset.cost),
      warranty_expiry: asset.warranty_expiry,
      status: asset.status,
      location: asset.location,
      notes: asset.notes,
    });
    setFormStep(1);
    setFormError(null);
    setFormOpen(true);
  };

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = assets.filter((a) => {
      if (categoryFilter !== 'ALL' && a.category !== categoryFilter) return false;
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (!q) return true;
      return (
        a.asset_tag.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.brand.toLowerCase().includes(q) ||
        a.model.toLowerCase().includes(q) ||
        a.serial_number.toLowerCase().includes(q) ||
        (a.assigned_employee_name || '').toLowerCase().includes(q) ||
        a.location.toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'cost') {
        cmp = a.cost - b.cost;
      } else {
        cmp = String(a[sortField]).localeCompare(String(b[sortField]));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [assets, search, categoryFilter, statusFilter, sortField, sortDir]);

  useEffect(() => {
    setPage(1);
  }, [search, categoryFilter, statusFilter]);

  const paginatedAssets = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAssets.slice(start, start + pageSize);
  }, [filteredAssets, page, pageSize]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const validateStepOne = (): boolean => {
    if (
      !form.asset_tag.trim() ||
      !form.name.trim() ||
      !form.brand.trim() ||
      !form.model.trim() ||
      !form.serial_number.trim()
    ) {
      setFormError(
        'Asset Tag, Asset Name, Brand, Model, and Serial Number are required.'
      );
      return false;
    }
    setFormError(null);
    return true;
  };

  const handleSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validateStepOne()) {
      setFormStep(1);
      return;
    }

    const parsedCost = Number(form.cost);
    if (!form.purchase_date || !form.warranty_expiry) {
      setFormError('Purchase date and warranty expiry date are required.');
      setFormStep(2);
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setFormError('Purchase cost must be a valid non-negative number.');
      setFormStep(2);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        cost: parsedCost,
      };
      if (editingAsset) {
        await api.updateAsset(editingAsset.id, payload);
        onToast('success', `Asset ${form.asset_tag.toUpperCase()} updated.`);
      } else {
        await api.createAsset(payload);
        onToast('success', `Asset ${form.asset_tag.toUpperCase()} added to inventory.`);
      }
      setFormOpen(false);
      await onRefresh();
      if (detailAsset && editingAsset && detailAsset.id === editingAsset.id) {
        await openDetail(editingAsset.id);
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save asset.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteAsset(deleteTarget.id);
      onToast('success', `Asset ${deleteTarget.asset_tag} deleted.`);
      if (detailAsset?.id === deleteTarget.id) {
        setDetailAsset(null);
      }
      setDeleteTarget(null);
      await onRefresh();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete asset.'
      );
    } finally {
      setDeleting(false);
    }
  };

  const todayStr = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-1 flex-wrap items-center gap-2.5">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--av-text-subtle)]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tag, name, serial, assignee..."
              className="w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] pl-9 pr-3.5 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Categories</option>
            {ASSET_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] transition-colors focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]"
          >
            <option value="ALL">All Statuses</option>
            {ASSET_STATUSES.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between lg:justify-end gap-3">
          <span className="text-xs font-medium text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap">
            {filteredAssets.length} of {assets.length} assets
          </span>
          <motion.button
            type="button"
            whileTap={{ scale: 0.985 }}
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add Asset</span>
          </motion.button>
        </div>
      </div>

      {/* Assets Data Table */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('asset_tag')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Asset Tag</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Equipment</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4">Serial Number</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Assigned To</th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('warranty_expiry')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)]"
                  >
                    <span>Warranty</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-[var(--av-text)] ml-auto"
                  >
                    <span>Cost</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--av-border-subtle)] text-sm">
              {paginatedAssets.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      icon={HardDrive}
                      title="No matching IT assets found"
                      description="Adjust your search filters or register a new hardware unit to populate your inventory."
                      actionLabel={assets.length === 0 ? 'Register First Asset' : undefined}
                      onAction={assets.length === 0 ? openCreateModal : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginatedAssets.map((asset) => {
                  const isWarrantyExpired = asset.warranty_expiry < todayStr;
                  return (
                    <tr
                      key={asset.id}
                      className="hover:bg-[var(--av-surface-hover)] transition-colors"
                    >
                      <td className="py-3 px-4 font-mono text-xs font-semibold whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openDetail(asset.id)}
                          className="text-[var(--av-accent)] hover:underline text-left"
                        >
                          {asset.asset_tag}
                        </button>
                      </td>
                      <td className="py-3 px-4 min-w-[200px]">
                        <div className="font-semibold text-[var(--av-text)] text-[13px]">
                          {asset.name}
                        </div>
                        <div className="text-xs text-[var(--av-text-subtle)]">
                          {asset.brand} · {asset.model}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                        {asset.category}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                        {asset.serial_number}
                      </td>
                      <td className="py-3 px-4">
                        <AssetStatusIndicator status={asset.status} />
                      </td>
                      <td className="py-3 px-4 text-xs text-[var(--av-text-muted)] whitespace-nowrap">
                        {asset.assigned_employee_name ? (
                          <div>
                            <div className="font-semibold text-[var(--av-text)]">
                              {asset.assigned_employee_name}
                            </div>
                            <div className="text-[11px] text-[var(--av-text-subtle)]">
                              {asset.assigned_employee_department}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--av-text-subtle)] opacity-75">
                            Unassigned
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        <span
                          className={
                            isWarrantyExpired
                              ? 'text-red-600 dark:text-red-400 font-semibold'
                              : 'text-[var(--av-text-muted)]'
                          }
                        >
                          {asset.warranty_expiry}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-semibold text-[var(--av-text)] tabular-nums whitespace-nowrap">
                        {formatCurrencyExact(asset.cost)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openDetail(asset.id)}
                            title="View details"
                            className="p-1.5 rounded-md text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-muted)] hover:text-[var(--av-text)] transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {asset.status === 'Available' && (
                            <button
                              type="button"
                              onClick={() => onRequestAssign(asset)}
                              title="Assign to employee"
                              className="p-1.5 rounded-md text-[var(--av-accent)] hover:bg-[var(--av-accent-soft)] transition-colors"
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRequestMaintenance(asset)}
                            title="Log maintenance"
                            className="p-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/15 transition-colors"
                          >
                            <Wrench className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(asset)}
                            title="Edit asset"
                            className="p-1.5 rounded-md text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-muted)] hover:text-[var(--av-text)] transition-colors"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(asset)}
                              title="Delete asset"
                              className="p-1.5 rounded-md text-[var(--av-text-subtle)] hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-600 dark:hover:text-red-400 transition-colors"
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
          totalItems={filteredAssets.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="assets"
        />
      </div>

      {/* Add / Edit Asset 2-Step Modal */}
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
              className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    {editingAsset
                      ? `Edit Asset · ${editingAsset.asset_tag}`
                      : 'Register New IT Asset'}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Step {formStep} of 2 ·{' '}
                    {formStep === 1
                      ? 'Hardware Identity & Classification'
                      : 'Financials, Warranty & Location'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  aria-label="Close modal"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Step Switcher Bar */}
              <div className="grid grid-cols-2 border-b border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] px-6 py-2.5 gap-2">
                <button
                  type="button"
                  onClick={() => setFormStep(1)}
                  className={`rounded-lg py-1.5 px-3 text-xs font-semibold text-left transition-colors ${
                    formStep === 1
                      ? 'bg-[var(--av-surface)] text-[var(--av-accent)] border border-[var(--av-border)] shadow-xs'
                      : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                  }`}
                >
                  1. Hardware Identity
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (validateStepOne()) setFormStep(2);
                  }}
                  className={`rounded-lg py-1.5 px-3 text-xs font-semibold text-left transition-colors ${
                    formStep === 2
                      ? 'bg-[var(--av-surface)] text-[var(--av-accent)] border border-[var(--av-border)] shadow-xs'
                      : 'text-[var(--av-text-subtle)] hover:text-[var(--av-text)]'
                  }`}
                >
                  2. Financials & Lifecycle
                </button>
              </div>

              <form onSubmit={handleSubmitForm} className="overflow-y-auto px-6 py-5 space-y-4">
                {formError && (
                  <div className="rounded-lg border border-red-300/80 dark:border-red-500/30 bg-red-50 dark:bg-red-500/10 px-3.5 py-2.5 text-xs text-red-800 dark:text-red-300">
                    {formError}
                  </div>
                )}

                {formStep === 1 ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Asset Tag *
                        </label>
                        <input
                          type="text"
                          required
                          value={form.asset_tag}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              asset_tag: e.target.value.toUpperCase(),
                            }))
                          }
                          placeholder="e.g. IT-LPT-0109"
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Serial Number *
                        </label>
                        <input
                          type="text"
                          required
                          value={form.serial_number}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              serial_number: e.target.value.toUpperCase(),
                            }))
                          }
                          placeholder="e.g. C02YM4K9MD6R"
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Asset Name *
                        </label>
                        <input
                          type="text"
                          required
                          value={form.name}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, name: e.target.value }))
                          }
                          placeholder="e.g. MacBook Pro 16 M3"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Category *
                        </label>
                        <select
                          value={form.category}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              category: e.target.value as AssetCategory,
                            }))
                          }
                          className={INPUT_CLASS}
                        >
                          {ASSET_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Brand *
                        </label>
                        <input
                          type="text"
                          required
                          value={form.brand}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, brand: e.target.value }))
                          }
                          placeholder="e.g. Apple, Dell, Cisco"
                          className={INPUT_CLASS}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Model *
                        </label>
                        <input
                          type="text"
                          required
                          value={form.model}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, model: e.target.value }))
                          }
                          placeholder="e.g. Precision 5680"
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Purchase Date *
                        </label>
                        <input
                          type="date"
                          required
                          value={form.purchase_date}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, purchase_date: e.target.value }))
                          }
                          className={`${INPUT_CLASS} tabular-nums`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Warranty Expiry *
                        </label>
                        <input
                          type="date"
                          required
                          value={form.warranty_expiry}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, warranty_expiry: e.target.value }))
                          }
                          className={`${INPUT_CLASS} tabular-nums`}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Purchase Cost (USD) *
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={form.cost}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, cost: e.target.value }))
                          }
                          placeholder="0.00"
                          className={`${INPUT_CLASS} font-mono tabular-nums`}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Operational Status *
                        </label>
                        <select
                          value={form.status}
                          disabled={editingAsset?.status === 'Assigned'}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              status: e.target.value as AssetStatus,
                            }))
                          }
                          className={`${INPUT_CLASS} disabled:opacity-60`}
                        >
                          {ASSET_STATUSES.filter((s) =>
                            editingAsset?.status === 'Assigned'
                              ? true
                              : s !== 'Assigned'
                          ).map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                        {editingAsset?.status === 'Assigned' && (
                          <p className="mt-1 text-[11px] text-[var(--av-text-subtle)]">
                            Use Assignments to return this unit before changing status.
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                          Location
                        </label>
                        <input
                          type="text"
                          value={form.location}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, location: e.target.value }))
                          }
                          placeholder="e.g. HQ Floor 3 · Vault"
                          className={INPUT_CLASS}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                        Specifications & Notes
                      </label>
                      <textarea
                        rows={2}
                        value={form.notes}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, notes: e.target.value }))
                        }
                        placeholder="Hardware specs, configuration profile, or audit remarks..."
                        className={INPUT_CLASS}
                      />
                    </div>
                  </>
                )}

                <div className="flex items-center justify-between gap-2.5 border-t border-[var(--av-border-subtle)] pt-4">
                  <div>
                    {formStep === 2 && (
                      <button
                        type="button"
                        onClick={() => setFormStep(1)}
                        className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                      >
                        Back
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setFormOpen(false)}
                      className="rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                    >
                      Cancel
                    </button>
                    {formStep === 1 ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (validateStepOne()) setFormStep(2);
                        }}
                        className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
                      >
                        Continue
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={submitting}
                        className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors disabled:opacity-60"
                      >
                        {submitting
                          ? 'Saving...'
                          : editingAsset
                            ? 'Save Changes'
                            : 'Register Asset'}
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Asset Detail Slide-Over Drawer */}
      <AnimatePresence>
        {detailAsset && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={() => setDetailAsset(null)}
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
                    {detailAsset.asset_tag}
                  </div>
                  <h3 className="font-display text-lg font-bold text-[var(--av-text)] mt-0.5">
                    {detailAsset.name}
                  </h3>
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--av-text-subtle)]">
                    <span>{detailAsset.category}</span>
                    <span>·</span>
                    <span>
                      {detailAsset.brand} {detailAsset.model}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDetailAsset(null)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  aria-label="Close drawer"
                >
                  <X className="h-4.5 w-4.5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Quick Action Bar */}
                <div className="flex flex-wrap items-center gap-2">
                  {detailAsset.status === 'Available' && (
                    <button
                      type="button"
                      onClick={() => onRequestAssign(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Assign Asset</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onRequestMaintenance(detailAsset)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    <Wrench className="h-3.5 w-3.5" />
                    <span>Log Maintenance</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditModal(detailAsset)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    <span>Edit Details</span>
                  </button>
                </div>

                {/* Specifications Grid */}
                <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                  <div className="grid grid-cols-2 gap-4 p-4">
                    <div>
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Status
                      </div>
                      <div className="mt-1">
                        <AssetStatusIndicator status={detailAsset.status} />
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Serial Number
                      </div>
                      <div className="mt-1 font-mono text-xs font-semibold text-[var(--av-text)]">
                        {detailAsset.serial_number}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 p-4">
                    <div>
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Purchase Date
                      </div>
                      <div className="mt-1 font-mono text-xs text-[var(--av-text)] tabular-nums">
                        {detailAsset.purchase_date}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Warranty Expiry
                      </div>
                      <div className="mt-1 font-mono text-xs text-[var(--av-text)] tabular-nums">
                        {detailAsset.warranty_expiry}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4 p-4">
                    <div>
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Acquisition Cost
                      </div>
                      <div className="mt-1 font-mono text-xs font-semibold text-[var(--av-text)] tabular-nums">
                        {formatCurrencyExact(detailAsset.cost)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Location
                      </div>
                      <div className="mt-1 text-xs text-[var(--av-text)]">
                        {detailAsset.location}
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                      Current Custody
                    </div>
                    <div className="mt-1 text-xs text-[var(--av-text)]">
                      {detailAsset.assigned_employee_name ? (
                        <span>
                          <strong>{detailAsset.assigned_employee_name}</strong> (
                          {detailAsset.assigned_employee_code}) ·{' '}
                          {detailAsset.assigned_employee_department} · Issued{' '}
                          {detailAsset.assigned_date}
                        </span>
                      ) : (
                        <span className="text-[var(--av-text-subtle)]">
                          Not assigned to an employee
                        </span>
                      )}
                    </div>
                  </div>
                  {detailAsset.notes && (
                    <div className="p-4">
                      <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                        Notes
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-[var(--av-text-muted)]">
                        {detailAsset.notes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Assignment History */}
                <div>
                  <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2.5">
                    Assignment History
                  </h4>
                  {detailLoading ? (
                    <p className="text-xs text-[var(--av-text-subtle)]">
                      Loading history...
                    </p>
                  ) : detailAssignments.length === 0 ? (
                    <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                      No previous assignment records for this asset.
                    </p>
                  ) : (
                    <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                      {detailAssignments.map((a) => (
                        <div key={a.id} className="p-3.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[var(--av-text)]">
                              {a.employee_name} ({a.employee_department})
                            </span>
                            <span className="font-mono text-[11px] text-[var(--av-text-subtle)]">
                              {a.handover_number}
                            </span>
                          </div>
                          <div className="mt-1 text-[var(--av-text-subtle)] tabular-nums">
                            Issued {a.assigned_date} ·{' '}
                            {a.returned_date
                              ? `Returned ${a.returned_date} (${a.condition_in})`
                              : 'Active Assignment'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Maintenance History */}
                <div>
                  <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2.5">
                    Maintenance & Service History
                  </h4>
                  {detailLoading ? (
                    <p className="text-xs text-[var(--av-text-subtle)]">
                      Loading service logs...
                    </p>
                  ) : detailMaintenance.length === 0 ? (
                    <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                      No repairs or maintenance services recorded.
                    </p>
                  ) : (
                    <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                      {detailMaintenance.map((m) => (
                        <div key={m.id} className="p-3.5 text-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[var(--av-text)]">
                              {m.maintenance_type}: {m.issue_description}
                            </span>
                            <MaintenanceStatusIndicator status={m.status} />
                          </div>
                          <div className="mt-1 text-[var(--av-text-subtle)] tabular-nums">
                            {m.service_date} · {m.vendor_or_technician} ·{' '}
                            {formatCurrencyExact(m.cost)}
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

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="Delete IT Asset"
        description={`Are you sure you want to permanently remove "${deleteTarget?.asset_tag} — ${deleteTarget?.name}" and its historical logs? This action cannot be undone.`}
        confirmLabel="Delete Asset"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
