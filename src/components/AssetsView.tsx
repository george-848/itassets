import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Archive,
  ArrowRightLeft,
  ArrowUpDown,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  HardDrive,
  Loader2,
  Pencil,
  Plus,
  Printer,
  QrCode,
  ScanLine,
  Search,
  Trash2,
  UserPlus,
  Wrench,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import { getWorkspaceCurrency } from '../lib/currency.ts';
import { generateAssetMaintenanceSummaryPDF } from '../lib/exports.ts';
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
import type { AssetTransfer, Ticket } from '../types/saas.ts';
import {
  AssetLabelModal,
  AssetLookupModal,
  BulkImportAssetsModal,
  DisposeAssetModal,
  TransferAssetModal,
  computeAssetBookValue,
} from './AssetLabelsAndModals.tsx';
import { AssetMaintenanceReportModal } from './AssetMaintenanceReportModal.tsx';
import { AssetTimeline, buildAssetTimelineEvents } from './AssetTimeline.tsx';
import { AttachmentsPanel } from './AttachmentsPanel.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { CustomFieldInputs, CustomFieldValuesDisplay } from './CustomFieldsSection.tsx';
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
  tenantCtx?: ExtendedTenantContext | null;
  selectedAssetId: string | null;
  onClearSelectedAsset: () => void;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onRequestAssign: (asset: Asset) => void;
  onRequestMaintenance: (asset: Asset) => void;
  onPlanBlocked?: (err: ApiError) => void;
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
  cpu: string;
  ram: string;
  storage: string;
  os: string;
  hostname: string;
  ip_address: string;
  mac_address: string;
  depreciation_method: 'straight_line' | 'declining_balance' | 'none';
  useful_life_years: string;
  salvage_value: string;
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
  cpu: '',
  ram: '',
  storage: '',
  os: '',
  hostname: '',
  ip_address: '',
  mac_address: '',
  depreciation_method: 'straight_line',
  useful_life_years: '4',
  salvage_value: '0',
};

type SortField = 'asset_tag' | 'name' | 'purchase_date' | 'cost' | 'warranty_expiry';
type DetailTab = 'overview' | 'timeline' | 'assignments' | 'maintenance' | 'lifecycle';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

function isPlanBlockedError(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'FEATURE_LOCKED' ||
      err.code === 'SUBSCRIPTION_READ_ONLY')
  );
}

export function AssetsView({
  assets,
  userRole,
  tenantCtx,
  selectedAssetId,
  onClearSelectedAsset,
  onRefresh,
  onToast,
  onRequestAssign,
  onRequestMaintenance,
  onPlanBlocked,
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
  const [customValues, setCustomValues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [detailAsset, setDetailAsset] = useState<Asset | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('overview');
  const [detailAssignments, setDetailAssignments] = useState<AssetAssignment[]>([]);
  const [detailMaintenance, setDetailMaintenance] = useState<MaintenanceLog[]>([]);
  const [detailTickets, setDetailTickets] = useState<Ticket[]>([]);
  const [detailTransfers, setDetailTransfers] = useState<AssetTransfer[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [labelAsset, setLabelAsset] = useState<Asset | null>(null);
  const [lookupOpen, setLookupOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [transferAsset, setTransferAsset] = useState<Asset | null>(null);
  const [disposeAsset, setDisposeAsset] = useState<Asset | null>(null);
  const [maintReportOpen, setMaintReportOpen] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Asset | null>(null);
  const [deleting, setDeleting] = useState(false);

  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const features = tenantCtx?.effectiveFeatures ?? [];
  const hasBulkImport = !tenantCtx || features.includes('bulk_import');
  const hasQrBarcode = !tenantCtx || features.includes('qr_barcode');
  const hasCustomFields = !tenantCtx || features.includes('custom_fields');

  const perms = tenantCtx?.permissions;
  const canCreate = !isReadOnly && (perms ? perms.includes('assets.create') : true);
  const canUpdate = !isReadOnly && (perms ? perms.includes('assets.update') : true);
  const canDelete = !isReadOnly && (perms ? perms.includes('assets.delete') : userRole === 'admin');
  const canImport = !isReadOnly && hasBulkImport && (perms ? perms.includes('assets.import') : true);
  const canTransfer = !isReadOnly && (perms ? perms.includes('assets.transfer') : true);
  const canDispose = !isReadOnly && (perms ? perms.includes('assets.dispose') : userRole === 'admin');
  const canAssign = !isReadOnly && (perms ? perms.includes('assignments.manage') : true);
  const canMaint = !isReadOnly && (perms ? perms.includes('maintenance.manage') : true);

  useEffect(() => {
    if (selectedAssetId) {
      openDetail(selectedAssetId);
      onClearSelectedAsset();
    }
  }, [selectedAssetId]);

  const openDetail = async (assetId: string) => {
    setMaintReportOpen(false);
    setDetailLoading(true);
    setDetailTab('overview');
    const localMatch = assets.find((a) => a.id === assetId) ?? null;
    setDetailAsset(localMatch);
    try {
      const res = await api.getAssetDetail(assetId);
      setDetailAsset(res.asset);
      setDetailAssignments(res.assignments);
      setDetailMaintenance(res.maintenanceLogs);
      setDetailTickets(res.tickets ?? []);
      setDetailTransfers(res.transfers ?? []);
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
    setCustomValues({});
    setFormStep(1);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (asset: Asset) => {
    setEditingAsset(asset);
    setCustomValues({});
    if (hasCustomFields) {
      void api
        .getCustomFieldValues('asset', asset.id)
        .then((res) => setCustomValues(res.values))
        .catch(() => {});
    }
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
      cpu: asset.specs?.cpu || '',
      ram: asset.specs?.ram || '',
      storage: asset.specs?.storage || '',
      os: asset.specs?.os || '',
      hostname: asset.specs?.hostname || '',
      ip_address: asset.specs?.ip_address || '',
      mac_address: asset.specs?.mac_address || '',
      depreciation_method: asset.depreciation_method || 'straight_line',
      useful_life_years: String(asset.useful_life_years ?? 4),
      salvage_value: String(asset.salvage_value ?? 0),
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
      const specs = {
        ...(form.cpu.trim() ? { cpu: form.cpu.trim() } : {}),
        ...(form.ram.trim() ? { ram: form.ram.trim() } : {}),
        ...(form.storage.trim() ? { storage: form.storage.trim() } : {}),
        ...(form.os.trim() ? { os: form.os.trim() } : {}),
        ...(form.hostname.trim() ? { hostname: form.hostname.trim() } : {}),
        ...(form.ip_address.trim() ? { ip_address: form.ip_address.trim() } : {}),
        ...(form.mac_address.trim() ? { mac_address: form.mac_address.trim() } : {}),
      };
      const payload: Partial<Asset> = {
        asset_tag: form.asset_tag,
        name: form.name,
        category: form.category,
        brand: form.brand,
        model: form.model,
        serial_number: form.serial_number,
        purchase_date: form.purchase_date,
        cost: parsedCost,
        warranty_expiry: form.warranty_expiry,
        status: form.status,
        location: form.location,
        notes: form.notes,
        specs: Object.keys(specs).length > 0 ? specs : undefined,
        depreciation_method: form.depreciation_method,
        useful_life_years: Math.max(1, Number(form.useful_life_years) || 4),
        salvage_value: Math.max(0, Number(form.salvage_value) || 0),
      };
      let savedAssetId = editingAsset?.id;
      if (editingAsset) {
        await api.updateAsset(editingAsset.id, payload);
        onToast('success', `Asset ${form.asset_tag.toUpperCase()} updated.`);
      } else {
        const created = await api.createAsset(payload);
        savedAssetId = created.asset.id;
        onToast('success', `Asset ${form.asset_tag.toUpperCase()} added to inventory.`);
      }
      if (hasCustomFields && savedAssetId && Object.keys(customValues).length > 0) {
        await api.saveCustomFieldValues('asset', savedAssetId, customValues).catch(() => {});
      }
      setFormOpen(false);
      await onRefresh();
      if (detailAsset && editingAsset && detailAsset.id === editingAsset.id) {
        await openDetail(editingAsset.id);
      }
    } catch (err) {
      if (isPlanBlockedError(err) && onPlanBlocked) {
        setFormOpen(false);
        onPlanBlocked(err);
        return;
      }
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
      if (isPlanBlockedError(err) && onPlanBlocked) {
        setDeleteTarget(null);
        onPlanBlocked(err);
        return;
      }
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
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#3B66F6]" />
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

        <div className="flex flex-wrap items-center justify-between lg:justify-end gap-2">
          <span className="text-xs font-medium text-[var(--av-text-subtle)] tabular-nums whitespace-nowrap mr-1">
            {filteredAssets.length} of {assets.length} assets
          </span>
          {hasQrBarcode && (
            <button
              type="button"
              onClick={() => setLookupOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap shrink-0"
            >
              <ScanLine className="h-3.5 w-3.5 text-sky-500" />
              <span>Scan / Lookup</span>
            </button>
          )}
          {canImport && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-500" />
              <span>Bulk Import</span>
            </button>
          )}
          {canCreate && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.985 }}
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-4 w-4" />
              <span>Add Asset</span>
            </motion.button>
          )}
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
                      actionLabel={canCreate && assets.length === 0 ? 'Register First Asset' : undefined}
                      onAction={canCreate && assets.length === 0 ? openCreateModal : undefined}
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
                            className="p-1.5 rounded-md text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/15 transition-colors"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {hasQrBarcode && (
                            <button
                              type="button"
                              onClick={() => setLabelAsset(asset)}
                              title="QR & Barcode label"
                              className="p-1.5 rounded-md text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-500/15 transition-colors"
                            >
                              <QrCode className="h-4 w-4" />
                            </button>
                          )}
                          {canAssign && asset.status === 'Available' && (
                            <button
                              type="button"
                              onClick={() => onRequestAssign(asset)}
                              title="Assign to employee"
                              className="p-1.5 rounded-md text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/15 transition-colors"
                            >
                              <UserPlus className="h-4 w-4" />
                            </button>
                          )}
                          {canMaint && (
                            <button
                              type="button"
                              onClick={() => onRequestMaintenance(asset)}
                              title="Log maintenance"
                              className="p-1.5 rounded-md text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/15 transition-colors"
                            >
                              <Wrench className="h-4 w-4" />
                            </button>
                          )}
                          {canUpdate && (
                            <button
                              type="button"
                              onClick={() => openEditModal(asset)}
                              title="Edit asset"
                              className="p-1.5 rounded-md text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-500/15 transition-colors"
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(asset)}
                              title="Delete asset"
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
                          Purchase Cost ({getWorkspaceCurrency()}) *
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

                    {/* Depreciation Config */}
                    <div className="rounded-xl border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/50 p-3.5 space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--av-text-subtle)]">
                        Depreciation &amp; Book Value Policy
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                            Method
                          </label>
                          <select
                            value={form.depreciation_method}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                depreciation_method: e.target
                                  .value as AssetFormState['depreciation_method'],
                              }))
                            }
                            className={INPUT_CLASS}
                          >
                            <option value="straight_line">Straight Line</option>
                            <option value="declining_balance">Declining Balance</option>
                            <option value="none">No Depreciation</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                            Useful Life (Years)
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="25"
                            value={form.useful_life_years}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, useful_life_years: e.target.value }))
                            }
                            className={`${INPUT_CLASS} font-mono tabular-nums`}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1">
                            Salvage Value
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={form.salvage_value}
                            onChange={(e) =>
                              setForm((f) => ({ ...f, salvage_value: e.target.value }))
                            }
                            className={`${INPUT_CLASS} font-mono tabular-nums`}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Extended Hardware / Network Specs */}
                    <div className="rounded-xl border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/50 p-3.5 space-y-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--av-text-subtle)]">
                        Hardware &amp; Network Profile (Optional)
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <input
                          type="text"
                          value={form.cpu}
                          onChange={(e) => setForm((f) => ({ ...f, cpu: e.target.value }))}
                          placeholder="CPU (e.g. M3 Pro / i7)"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="text"
                          value={form.ram}
                          onChange={(e) => setForm((f) => ({ ...f, ram: e.target.value }))}
                          placeholder="RAM (e.g. 32 GB)"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="text"
                          value={form.storage}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, storage: e.target.value }))
                          }
                          placeholder="Storage (e.g. 1 TB NVMe)"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="text"
                          value={form.os}
                          onChange={(e) => setForm((f) => ({ ...f, os: e.target.value }))}
                          placeholder="OS (e.g. macOS 15 / Win 11)"
                          className={INPUT_CLASS}
                        />
                        <input
                          type="text"
                          value={form.hostname}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, hostname: e.target.value }))
                          }
                          placeholder="Hostname"
                          className={`${INPUT_CLASS} font-mono`}
                        />
                        <input
                          type="text"
                          value={form.ip_address}
                          onChange={(e) =>
                            setForm((f) => ({ ...f, ip_address: e.target.value }))
                          }
                          placeholder="IP Address"
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>
                      <input
                        type="text"
                        value={form.mac_address}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, mac_address: e.target.value }))
                        }
                        placeholder="MAC Address (optional)"
                        className={`${INPUT_CLASS} font-mono`}
                      />
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

                    {hasCustomFields && (
                      <CustomFieldInputs
                        entityType="asset"
                        values={customValues}
                        onChange={setCustomValues}
                      />
                    )}
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

              <div className="flex-1 overflow-y-auto p-6 space-y-5">
                {/* Quick Action Bar */}
                <div className="flex flex-wrap items-center gap-2">
                  {canAssign && detailAsset.status === 'Available' && (
                    <button
                      type="button"
                      onClick={() => onRequestAssign(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Assign Asset</span>
                    </button>
                  )}
                  {hasQrBarcode && (
                    <button
                      type="button"
                      onClick={() => setLabelAsset(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                    >
                      <QrCode className="h-3.5 w-3.5 text-teal-500" />
                      <span>QR Label</span>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={detailLoading}
                    onClick={() => setMaintReportOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] disabled:opacity-50 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5 text-[var(--av-accent)]" />
                    <span>Maint. Report</span>
                  </button>
                  {canMaint && (
                    <button
                      type="button"
                      onClick={() => onRequestMaintenance(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                    >
                      <Wrench className="h-3.5 w-3.5 text-amber-500" />
                      <span>Maintenance</span>
                    </button>
                  )}
                  {canTransfer && (
                    <button
                      type="button"
                      onClick={() => setTransferAsset(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                    >
                      <ArrowRightLeft className="h-3.5 w-3.5 text-blue-500" />
                      <span>Transfer</span>
                    </button>
                  )}
                  {canUpdate && (
                    <button
                      type="button"
                      onClick={() => openEditModal(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5 text-indigo-500" />
                      <span>Edit</span>
                    </button>
                  )}
                  {canDispose && detailAsset.status !== 'Retired' && detailAsset.status !== 'Assigned' && (
                    <button
                      type="button"
                      onClick={() => setDisposeAsset(detailAsset)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300/60 dark:border-rose-500/30 bg-rose-50/60 dark:bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-400 hover:bg-rose-100/80 transition-colors"
                    >
                      <Archive className="h-3.5 w-3.5" />
                      <span>Retire</span>
                    </button>
                  )}
                </div>

                {/* Detail Drawer Tabs */}
                <div className="flex flex-wrap gap-1.5 border-b border-[var(--av-border-subtle)] pb-2.5">
                  {(
                    [
                      { id: 'overview', label: 'Overview & Specs' },
                      {
                        id: 'timeline',
                        label: `Timeline (${
                          buildAssetTimelineEvents(
                            detailAsset,
                            detailAssignments,
                            detailMaintenance,
                            detailTransfers
                          ).length
                        })`,
                      },
                      { id: 'assignments', label: `Assignments (${detailAssignments.length})` },
                      { id: 'maintenance', label: `Maintenance (${detailMaintenance.length})` },
                      {
                        id: 'lifecycle',
                        label: `Tickets & Transfers (${detailTickets.length + detailTransfers.length})`,
                      },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setDetailTab(tab.id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                        detailTab === tab.id
                          ? 'bg-[var(--av-accent)] text-white'
                          : 'text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {detailTab === 'overview' && (
                  <div className="space-y-4">
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
                            Acquisition Cost / Book Value
                          </div>
                          <div className="mt-1 font-mono text-xs font-semibold text-[var(--av-text)] tabular-nums">
                            {formatCurrencyExact(detailAsset.cost)} ·{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              Book {formatCurrencyExact(computeAssetBookValue(detailAsset))}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div className="text-[11px] font-medium text-[var(--av-text-subtle)]">
                            Location
                          </div>
                          <div className="mt-1 text-xs text-[var(--av-text)]">
                            {detailAsset.location}
                            {detailAsset.org_name ? ` · ${detailAsset.org_name}` : ''}
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
                      {detailAsset.disposal_status === 'disposed' && (
                        <div className="p-4 bg-rose-50/60 dark:bg-rose-500/10">
                          <div className="text-[11px] font-semibold text-rose-700 dark:text-rose-400">
                            Decommissioned / Disposed ({detailAsset.disposal_date})
                          </div>
                          <p className="mt-1 text-xs text-[var(--av-text-muted)]">
                            {detailAsset.disposal_reason} · Approved by {detailAsset.disposal_approved_by}
                          </p>
                        </div>
                      )}
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

                    {detailAsset.specs && Object.values(detailAsset.specs).some(Boolean) && (
                      <div className="rounded-xl border border-[var(--av-border)] p-4">
                        <div className="text-xs font-semibold text-[var(--av-text)] mb-2.5">
                          Hardware &amp; Network Specifications
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {detailAsset.specs.cpu && (
                            <div>
                              <span className="text-[var(--av-text-subtle)]">CPU:</span>{' '}
                              <span className="font-medium text-[var(--av-text)]">{detailAsset.specs.cpu}</span>
                            </div>
                          )}
                          {detailAsset.specs.ram && (
                            <div>
                              <span className="text-[var(--av-text-subtle)]">RAM:</span>{' '}
                              <span className="font-medium text-[var(--av-text)]">{detailAsset.specs.ram}</span>
                            </div>
                          )}
                          {detailAsset.specs.storage && (
                            <div>
                              <span className="text-[var(--av-text-subtle)]">Storage:</span>{' '}
                              <span className="font-medium text-[var(--av-text)]">{detailAsset.specs.storage}</span>
                            </div>
                          )}
                          {detailAsset.specs.os && (
                            <div>
                              <span className="text-[var(--av-text-subtle)]">OS:</span>{' '}
                              <span className="font-medium text-[var(--av-text)]">{detailAsset.specs.os}</span>
                            </div>
                          )}
                          {detailAsset.specs.hostname && (
                            <div>
                              <span className="text-[var(--av-text-subtle)]">Hostname:</span>{' '}
                              <span className="font-mono text-[var(--av-text)]">{detailAsset.specs.hostname}</span>
                            </div>
                          )}
                          {detailAsset.specs.ip_address && (
                            <div>
                              <span className="text-[var(--av-text-subtle)]">IP:</span>{' '}
                              <span className="font-mono text-[var(--av-text)]">{detailAsset.specs.ip_address}</span>
                            </div>
                          )}
                          {detailAsset.specs.mac_address && (
                            <div className="col-span-2">
                              <span className="text-[var(--av-text-subtle)]">MAC:</span>{' '}
                              <span className="font-mono text-[var(--av-text)]">{detailAsset.specs.mac_address}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="mb-2.5 flex items-center justify-between">
                        <h4 className="font-display text-sm font-semibold text-[var(--av-text)]">
                          Recent Lifecycle Timeline
                        </h4>
                        <button
                          type="button"
                          onClick={() => setDetailTab('timeline')}
                          className="text-xs font-semibold text-[var(--av-accent)] hover:underline"
                        >
                          Full timeline →
                        </button>
                      </div>
                      <AssetTimeline
                        asset={detailAsset}
                        assignments={detailAssignments}
                        maintenanceLogs={detailMaintenance}
                        transfers={detailTransfers}
                        loading={detailLoading}
                        compactLimit={4}
                        onViewAll={() => setDetailTab('timeline')}
                      />
                    </div>

                    {hasCustomFields && (
                      <CustomFieldValuesDisplay entityType="asset" entityId={detailAsset.id} />
                    )}

                    <AttachmentsPanel
                      entityType="asset"
                      entityId={detailAsset.id}
                      orgId={detailAsset.org_id}
                      canWrite={canUpdate}
                      onToast={onToast}
                    />
                  </div>
                )}

                {detailTab === 'timeline' && (
                  <div>
                    <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2.5">
                      Historical Asset Timeline
                    </h4>
                    <AssetTimeline
                      asset={detailAsset}
                      assignments={detailAssignments}
                      maintenanceLogs={detailMaintenance}
                      transfers={detailTransfers}
                      loading={detailLoading}
                    />
                  </div>
                )}

                {detailTab === 'assignments' && (
                  <div>
                    <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2.5">
                      Assignment History
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
                )}

                {detailTab === 'maintenance' && (
                  <div>
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <h4 className="font-display text-sm font-semibold text-[var(--av-text)]">
                        Maintenance &amp; Service History
                      </h4>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={detailLoading}
                          onClick={() => setMaintReportOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1.5 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] disabled:opacity-50 transition-colors"
                        >
                          <Printer className="h-3.5 w-3.5" />
                          <span>Preview &amp; Print</span>
                        </button>
                        <button
                          type="button"
                          disabled={detailLoading}
                          onClick={() => {
                            generateAssetMaintenanceSummaryPDF({
                              asset: detailAsset,
                              maintenanceLogs: detailMaintenance,
                              orgName:
                                detailAsset.org_name ||
                                tenantCtx?.activeOrg?.name ||
                                tenantCtx?.tenant?.name ||
                                undefined,
                            });
                            onToast(
                              'success',
                              `Maintenance summary PDF for ${detailAsset.asset_tag} downloaded.`
                            );
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-50 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span>Export PDF</span>
                        </button>
                      </div>
                    </div>
                    {detailLoading ? (
                      <div className="space-y-2 rounded-xl border border-[var(--av-border)] p-3.5">
                        <div className="flex items-center gap-2 text-xs text-[var(--av-text-subtle)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--av-accent)]" />
                          <span>Loading service logs...</span>
                        </div>
                        <div className="h-8 w-full rounded-lg av-shimmer" />
                      </div>
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
                )}

                {detailTab === 'lifecycle' && (
                  <div className="space-y-5">
                    <div>
                      <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2">
                        Linked Helpdesk Tickets
                      </h4>
                      {detailTickets.length === 0 ? (
                        <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                          No helpdesk tickets linked to this asset.
                        </p>
                      ) : (
                        <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                          {detailTickets.map((t) => (
                            <div key={t.id} className="p-3.5 text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-semibold text-[var(--av-accent)]">
                                  {t.ticketNumber}
                                </span>
                                <span className="font-medium text-[var(--av-text-muted)]">
                                  {t.status} · {t.priority}
                                </span>
                              </div>
                              <div className="mt-1 font-medium text-[var(--av-text)]">
                                {t.subject}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div>
                      <h4 className="font-display text-sm font-semibold text-[var(--av-text)] mb-2">
                        Location &amp; Org Transfer History
                      </h4>
                      {detailTransfers.length === 0 ? (
                        <p className="text-xs text-[var(--av-text-subtle)] rounded-xl border border-[var(--av-border)] p-4">
                          No transfers recorded for this asset.
                        </p>
                      ) : (
                        <div className="rounded-xl border border-[var(--av-border)] divide-y divide-[var(--av-border-subtle)]">
                          {detailTransfers.map((tr) => (
                            <div key={tr.id} className="p-3.5 text-xs">
                              <div className="font-semibold text-[var(--av-text)]">
                                {tr.fromLocation} → {tr.toLocation}
                              </div>
                              <div className="mt-1 text-[var(--av-text-subtle)]">
                                {tr.reason} · By {tr.transferredBy} on {tr.transferredAt.slice(0, 10)}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* QR/Barcode Label, Maintenance Summary PDF, Scanner Lookup, Bulk Import, Transfer, Dispose */}
      <AssetLabelModal
        asset={labelAsset}
        onClose={() => setLabelAsset(null)}
        onToast={onToast}
      />
      <AssetMaintenanceReportModal
        asset={maintReportOpen ? detailAsset : null}
        maintenanceLogs={detailMaintenance}
        orgName={
          detailAsset?.org_name ||
          tenantCtx?.activeOrg?.name ||
          tenantCtx?.tenant?.name ||
          undefined
        }
        onClose={() => setMaintReportOpen(false)}
        onToast={onToast}
      />
      <AssetLookupModal
        open={lookupOpen}
        assets={assets}
        onClose={() => setLookupOpen(false)}
        onSelectAsset={(id) => openDetail(id)}
        onToast={onToast}
      />
      <BulkImportAssetsModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={onRefresh}
        onToast={onToast}
        onPlanBlocked={onPlanBlocked}
      />
      <TransferAssetModal
        asset={transferAsset}
        tenantCtx={tenantCtx}
        onClose={() => setTransferAsset(null)}
        onTransferred={async () => {
          await onRefresh();
          if (detailAsset) await openDetail(detailAsset.id);
        }}
        onToast={onToast}
        onPlanBlocked={onPlanBlocked}
      />
      <DisposeAssetModal
        asset={disposeAsset}
        onClose={() => setDisposeAsset(null)}
        onDisposed={async () => {
          await onRefresh();
          if (detailAsset) await openDetail(detailAsset.id);
        }}
        onToast={onToast}
        onPlanBlocked={onPlanBlocked}
      />

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
