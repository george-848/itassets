import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowUpDown,
  Eye,
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

  const [formOpen, setFormOpen] = useState(false);
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

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleSubmitForm = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsedCost = Number(form.cost);
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
      return;
    }
    if (!form.purchase_date || !form.warranty_expiry) {
      setFormError('Purchase date and warranty expiry date are required.');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      setFormError('Purchase cost must be a valid non-negative number.');
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
              placeholder="Search tag, name, serial, assignee..."
              className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/15"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none"
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
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-blue-600 focus:outline-none"
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
          <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">
            Showing {filteredAssets.length} of {assets.length} assets
          </span>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>Add Asset</span>
          </button>
        </div>
      </div>

      {/* Assets Data Table */}
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('asset_tag')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Asset Tag</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
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
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    <span>Warranty</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('cost')}
                    className="inline-flex items-center gap-1 hover:text-slate-900 ml-auto"
                  >
                    <span>Cost</span>
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {filteredAssets.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      No matching IT assets found
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Adjust your search filters or register a new equipment unit.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredAssets.map((asset) => {
                  const isWarrantyExpired = asset.warranty_expiry < todayStr;
                  return (
                    <tr
                      key={asset.id}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-mono text-xs font-semibold text-slate-900 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => openDetail(asset.id)}
                          className="hover:text-blue-700 hover:underline text-left"
                        >
                          {asset.asset_tag}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 min-w-[200px]">
                        <div className="font-medium text-slate-900">
                          {asset.name}
                        </div>
                        <div className="text-xs text-slate-500">
                          {asset.brand} · {asset.model}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 whitespace-nowrap">
                        {asset.category}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs text-slate-600 whitespace-nowrap">
                        {asset.serial_number}
                      </td>
                      <td className="py-2.5 px-4">
                        <AssetStatusIndicator status={asset.status} />
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700 whitespace-nowrap">
                        {asset.assigned_employee_name ? (
                          <div>
                            <div className="font-medium text-slate-900">
                              {asset.assigned_employee_name}
                            </div>
                            <div className="text-[11px] text-slate-500">
                              {asset.assigned_employee_department}
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-400">Unassigned</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                        <span
                          className={
                            isWarrantyExpired
                              ? 'text-red-700 font-medium'
                              : 'text-slate-600'
                          }
                        >
                          {asset.warranty_expiry}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs font-medium text-slate-900 tabular-nums whitespace-nowrap">
                        {formatCurrencyExact(asset.cost)}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => openDetail(asset.id)}
                            title="View details"
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {asset.status === 'Available' && (
                            <button
                              type="button"
                              onClick={() => onRequestAssign(asset)}
                              title="Assign to employee"
                              className="p-1.5 rounded-md text-blue-700 hover:bg-blue-50"
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onRequestMaintenance(asset)}
                            title="Log maintenance"
                            className="p-1.5 rounded-md text-amber-700 hover:bg-amber-50"
                          >
                            <Wrench className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openEditModal(asset)}
                            title="Edit asset"
                            className="p-1.5 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          {userRole === 'admin' && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(asset)}
                              title="Delete asset"
                              className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700"
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
      </div>

      {/* Add / Edit Asset Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-[1px] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <h3 className="font-display text-lg font-semibold text-slate-900">
                {editingAsset ? `Edit Asset · ${editingAsset.asset_tag}` : 'Register New IT Asset'}
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

            <form onSubmit={handleSubmitForm} className="overflow-y-auto px-6 py-5 space-y-4">
              {formError && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Asset Tag *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.asset_tag}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, asset_tag: e.target.value.toUpperCase() }))
                    }
                    placeholder="e.g. IT-LPT-0109"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Asset Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. MacBook Pro 16 M3"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
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
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Brand *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.brand}
                    onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                    placeholder="e.g. Apple, Dell, Cisco"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Model *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.model}
                    onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                    placeholder="e.g. Precision 5680"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Purchase Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.purchase_date}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, purchase_date: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Warranty Expiry *
                  </label>
                  <input
                    type="date"
                    required
                    value={form.warranty_expiry}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, warranty_expiry: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Purchase Cost (USD) *
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={form.cost}
                    onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm tabular-nums focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
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
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
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
                    <p className="mt-1 text-[11px] text-slate-500">
                      Use Asset Assignment to return this unit before changing status.
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    value={form.location}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, location: e.target.value }))
                    }
                    placeholder="e.g. HQ Floor 3 · Vault"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Specifications & Notes
                </label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Hardware specs, configuration profile, or audit remarks..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none"
                />
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
                    : editingAsset
                      ? 'Save Changes'
                      : 'Register Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Asset Detail Slide-Over Drawer */}
      {detailAsset && (
        <div
          className="fixed inset-0 z-40 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-xl bg-white h-full border-l border-slate-200 flex flex-col shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
              <div>
                <div className="font-mono text-xs font-semibold text-blue-700">
                  {detailAsset.asset_tag}
                </div>
                <h3 className="font-display text-lg font-semibold text-slate-900 mt-0.5">
                  {detailAsset.name}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
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
                className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
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
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-medium text-white hover:bg-blue-800"
                  >
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Assign Asset</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onRequestMaintenance(detailAsset)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Wrench className="h-3.5 w-3.5" />
                  <span>Log Maintenance</span>
                </button>
                <button
                  type="button"
                  onClick={() => openEditModal(detailAsset)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit Details</span>
                </button>
              </div>

              {/* Specifications Grid */}
              <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                <div className="grid grid-cols-2 gap-4 p-4">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Status
                    </div>
                    <div className="mt-1">
                      <AssetStatusIndicator status={detailAsset.status} />
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Serial Number
                    </div>
                    <div className="mt-1 font-mono text-xs font-medium text-slate-900">
                      {detailAsset.serial_number}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 p-4">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Purchase Date
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-900 tabular-nums">
                      {detailAsset.purchase_date}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Warranty Expiry
                    </div>
                    <div className="mt-1 font-mono text-xs text-slate-900 tabular-nums">
                      {detailAsset.warranty_expiry}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 p-4">
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Acquisition Cost
                    </div>
                    <div className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                      {formatCurrencyExact(detailAsset.cost)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-medium text-slate-500">
                      Location
                    </div>
                    <div className="mt-1 text-xs text-slate-900">
                      {detailAsset.location}
                    </div>
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-[11px] font-medium text-slate-500">
                    Current Custody
                  </div>
                  <div className="mt-1 text-xs text-slate-900">
                    {detailAsset.assigned_employee_name ? (
                      <span>
                        <strong>{detailAsset.assigned_employee_name}</strong> (
                        {detailAsset.assigned_employee_code}) ·{' '}
                        {detailAsset.assigned_employee_department} · Issued{' '}
                        {detailAsset.assigned_date}
                      </span>
                    ) : (
                      <span className="text-slate-500">Not assigned to an employee</span>
                    )}
                  </div>
                </div>
                {detailAsset.notes && (
                  <div className="p-4">
                    <div className="text-[11px] font-medium text-slate-500">
                      Notes
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">
                      {detailAsset.notes}
                    </p>
                  </div>
                )}
              </div>

              {/* Assignment History */}
              <div>
                <h4 className="font-display text-sm font-semibold text-slate-900 mb-2.5">
                  Assignment History
                </h4>
                {detailLoading ? (
                  <p className="text-xs text-slate-500">Loading history...</p>
                ) : detailAssignments.length === 0 ? (
                  <p className="text-xs text-slate-500 rounded-lg border border-slate-200 p-4">
                    No previous assignment records for this asset.
                  </p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {detailAssignments.map((a) => (
                      <div key={a.id} className="p-3.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {a.employee_name} ({a.employee_department})
                          </span>
                          <span className="font-mono text-[11px] text-slate-500">
                            {a.handover_number}
                          </span>
                        </div>
                        <div className="mt-1 text-slate-500 tabular-nums">
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
                <h4 className="font-display text-sm font-semibold text-slate-900 mb-2.5">
                  Maintenance & Service History
                </h4>
                {detailLoading ? (
                  <p className="text-xs text-slate-500">Loading service logs...</p>
                ) : detailMaintenance.length === 0 ? (
                  <p className="text-xs text-slate-500 rounded-lg border border-slate-200 p-4">
                    No repairs or maintenance services recorded.
                  </p>
                ) : (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {detailMaintenance.map((m) => (
                      <div key={m.id} className="p-3.5 text-xs">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-900">
                            {m.maintenance_type}: {m.issue_description}
                          </span>
                          <MaintenanceStatusIndicator status={m.status} />
                        </div>
                        <div className="mt-1 text-slate-500 tabular-nums">
                          {m.service_date} · {m.vendor_or_technician} ·{' '}
                          {formatCurrencyExact(m.cost)}
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
