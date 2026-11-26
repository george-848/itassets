import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Building2,
  ClipboardCheck,
  PackageCheck,
  Paperclip,
  Plus,
  ShoppingCart,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import { ASSET_CATEGORIES } from '../types/itams.ts';
import type { PurchaseOrder, PurchaseRequest, Vendor } from '../types/saas.ts';
import { AttachmentsPanel } from './AttachmentsPanel.tsx';
import { formatGhsExact } from './StatusText.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

interface ProcurementViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onRefresh: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

type ProcTab = 'orders' | 'requests' | 'vendors';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

function isBlockedErr(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'FEATURE_LOCKED' ||
      err.code === 'SUBSCRIPTION_READ_ONLY')
  );
}

export function ProcurementView({
  tenantCtx,
  onRefresh,
  onToast,
  onPlanBlocked,
}: ProcurementViewProps) {
  const [tab, setTab] = useState<ProcTab>('orders');
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);

  // Modals
  const [vndOpen, setVndOpen] = useState(false);
  const [vndName, setVndName] = useState('');
  const [vndContact, setVndContact] = useState('');
  const [vndEmail, setVndEmail] = useState('');
  const [vndTerms, setVndTerms] = useState('Net 30');

  const [prOpen, setPrOpen] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prCat, setPrCat] = useState<string>('Laptops');
  const [prQty, setPrQty] = useState('2');
  const [prEstCost, setPrEstCost] = useState('15000');
  const [prJust, setPrJust] = useState('');

  const [poOpen, setPoOpen] = useState(false);
  const [poVendorId, setPoVendorId] = useState('');
  const [poItem, setPoItem] = useState('');
  const [poCat, setPoCat] = useState<string>('Laptops');
  const [poBrand, setPoBrand] = useState('Dell');
  const [poModel, setPoModel] = useState('Latitude 5440');
  const [poQty, setPoQty] = useState('2');
  const [poUnitCost, setPoUnitCost] = useState('9500');
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [poAttachmentsTarget, setPoAttachmentsTarget] =
    useState<PurchaseOrder | null>(null);

  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);
  const perms = tenantCtx?.permissions ?? [];
  const canCreate = !isReadOnly && perms.includes('procurement.create');
  const canApprove = !isReadOnly && perms.includes('procurement.approve');
  const canCreateAssets = !isReadOnly && perms.includes('assets.create');

  const loadProcurement = async () => {
    setLoading(true);
    try {
      const res = await api.getProcurement();
      setVendors(res.vendors);
      setRequests(res.purchaseRequests);
      setOrders(res.purchaseOrders);
      if (res.vendors[0] && !poVendorId) {
        setPoVendorId(res.vendors[0].id);
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load procurement data.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProcurement();
  }, [tenantCtx?.tenant.id, tenantCtx?.activeOrg.id, tenantCtx?.isAllOrgsView]);

  const handleErr = (err: unknown, fallback: string) => {
    if (isBlockedErr(err) && onPlanBlocked) {
      onPlanBlocked(err);
      return;
    }
    onToast('error', err instanceof ApiError ? err.message : fallback);
  };

  const handleCreateVendor = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createVendor({
        name: vndName.trim(),
        contactName: vndContact.trim(),
        email: vndEmail.trim(),
        paymentTerms: vndTerms.trim(),
      });
      onToast('success', `Vendor ${vndName.trim()} added.`);
      setVndOpen(false);
      setVndName('');
      setVndContact('');
      setVndEmail('');
      await loadProcurement();
    } catch (err) {
      handleErr(err, 'Failed to add vendor.');
    }
  };

  const handleCreatePr = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createPurchaseRequest({
        title: prTitle.trim(),
        category: prCat,
        quantity: Math.max(1, Number(prQty) || 1),
        estimatedCostGhs: Math.max(0, Number(prEstCost) || 0),
        justification: prJust.trim(),
      });
      onToast('success', 'Purchase request submitted.');
      setPrOpen(false);
      setPrTitle('');
      setPrJust('');
      await loadProcurement();
    } catch (err) {
      handleErr(err, 'Failed to submit purchase request.');
    }
  };

  const handleApprovePr = async (id: string, decision: 'Approved' | 'Rejected') => {
    try {
      await api.approvePurchaseRequest(id, decision);
      onToast('success', `Purchase request ${decision.toLowerCase()}.`);
      await loadProcurement();
    } catch (err) {
      handleErr(err, 'Failed to update purchase request.');
    }
  };

  const handleCreatePo = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createPurchaseOrder({
        vendorId: poVendorId,
        itemName: poItem.trim(),
        category: poCat,
        brand: poBrand.trim(),
        model: poModel.trim(),
        quantity: Math.max(1, Number(poQty) || 1),
        unitCostGhs: Math.max(0, Number(poUnitCost) || 0),
      });
      onToast('success', 'Purchase order issued.');
      setPoOpen(false);
      setPoItem('');
      await loadProcurement();
    } catch (err) {
      handleErr(err, 'Failed to issue purchase order.');
    }
  };

  const handleReceivePo = async (po: PurchaseOrder) => {
    setReceivingId(po.id);
    try {
      const res = await api.receivePurchaseOrder(po.id);
      onToast(
        'success',
        `Received ${res.createdAssets.length} units from ${po.poNumber} into Asset Inventory.`
      );
      await Promise.all([loadProcurement(), onRefresh()]);
    } catch (err) {
      handleErr(err, 'Failed to receive purchase order.');
    } finally {
      setReceivingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'orders', label: `Purchase Orders (${orders.length})`, icon: ShoppingCart },
              { id: 'requests', label: `Purchase Requests (${requests.length})`, icon: ClipboardCheck },
              { id: 'vendors', label: `Vendors (${vendors.length})`, icon: Building2 },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  tab === item.id
                    ? 'bg-[var(--av-accent)] text-white'
                    : 'bg-[var(--av-surface-muted)] text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {tab === 'vendors' && canCreate && (
            <button
              type="button"
              onClick={() => setVndOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              <span>Add Vendor</span>
            </button>
          )}
          {tab === 'requests' && canCreate && (
            <button
              type="button"
              onClick={() => setPrOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              <span>New Purchase Request</span>
            </button>
          )}
          {tab === 'orders' && canApprove && (
            <button
              type="button"
              onClick={() => setPoOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
            >
              <Plus className="h-4 w-4" />
              <span>Issue Purchase Order</span>
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-10 text-center text-xs text-[var(--av-text-subtle)]">
          Loading procurement &amp; vendor workspace...
        </div>
      ) : tab === 'orders' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {orders.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No purchase orders issued"
              description="Issue purchase orders to approved vendors and receive delivered hardware directly into Asset Inventory."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                    <th className="py-3 px-4">PO #</th>
                    <th className="py-3 px-4">Hardware / Item</th>
                    <th className="py-3 px-4">Vendor</th>
                    <th className="py-3 px-4">Qty</th>
                    <th className="py-3 px-4 text-right">Total (GH₵)</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Receiving</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {orders.map((po) => (
                    <tr key={po.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4 font-mono font-semibold text-[var(--av-accent)]">
                        {po.poNumber}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-[var(--av-text)]">{po.itemName}</div>
                        <div className="text-[11px] text-[var(--av-text-subtle)]">
                          {po.brand} {po.model} · {po.category}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">{po.vendorName}</td>
                      <td className="py-3 px-4 font-mono tabular-nums">{po.quantity}</td>
                      <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-[var(--av-text)]">
                        {formatGhsExact(po.totalCostGhs)}
                      </td>
                      <td className="py-3 px-4 font-semibold text-[var(--av-text-muted)]">
                        {po.status}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setPoAttachmentsTarget(po)}
                            title="Attach vendor quote, invoice, or delivery receipt"
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-2.5 py-1.5 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)]"
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                            <span>Docs</span>
                          </button>
                          {po.status !== 'Received' && canCreateAssets ? (
                            <button
                              type="button"
                              disabled={receivingId === po.id}
                              onClick={() => handleReceivePo(po)}
                              className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            >
                              <PackageCheck className="h-3.5 w-3.5" />
                              <span>
                                {receivingId === po.id ? 'Receiving...' : 'Receive into Inventory'}
                              </span>
                            </button>
                          ) : po.receivedAssetIds.length > 0 ? (
                            <span className="text-[var(--av-text-subtle)]">
                              {po.receivedAssetIds.length} assets logged
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : tab === 'requests' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {requests.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title="No purchase requests"
              description="Submit hardware or software purchase requests for budget approval."
            />
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)]">
              {requests.map((pr) => (
                <div
                  key={pr.id}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[var(--av-accent)]">
                        {pr.requestNumber}
                      </span>
                      <span className="font-semibold text-sm text-[var(--av-text)]">{pr.title}</span>
                    </div>
                    <div className="text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                      Qty {pr.quantity} · Est. {formatGhsExact(pr.estimatedCostGhs)} · Requested by{' '}
                      {pr.requestedByName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-[var(--av-text-muted)]">{pr.status}</span>
                    {canApprove && pr.status === 'Pending Approval' && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleApprovePr(pr.id, 'Approved')}
                          className="rounded-md bg-emerald-600 px-2.5 py-1 text-white font-semibold"
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApprovePr(pr.id, 'Rejected')}
                          className="rounded-md bg-rose-600 px-2.5 py-1 text-white font-semibold"
                        >
                          Reject
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          {vendors.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No vendors registered"
              description="Register approved hardware OEMs, resellers, and IT service providers."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                    <th className="py-3 px-4">Vendor Name</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Contact</th>
                    <th className="py-3 px-4">Payment Terms</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                  {vendors.map((v) => (
                    <tr key={v.id} className="hover:bg-[var(--av-surface-hover)]">
                      <td className="py-3 px-4 font-semibold text-[var(--av-text)]">{v.name}</td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">{v.category}</td>
                      <td className="py-3 px-4 text-[var(--av-text-muted)]">
                        {v.contactName} {v.email ? `· ${v.email}` : ''}
                      </td>
                      <td className="py-3 px-4 font-mono text-[var(--av-text-subtle)]">
                        {v.paymentTerms}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Vendor Modal */}
      <AnimatePresence>
        {vndOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Register Vendor
                </h3>
                <button type="button" onClick={() => setVndOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreateVendor} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={vndName}
                  onChange={(e) => setVndName(e.target.value)}
                  placeholder="Vendor name (e.g. Dell Enterprise Ghana)"
                  className={INPUT_CLASS}
                />
                <input
                  type="text"
                  value={vndContact}
                  onChange={(e) => setVndContact(e.target.value)}
                  placeholder="Account manager name"
                  className={INPUT_CLASS}
                />
                <input
                  type="email"
                  value={vndEmail}
                  onChange={(e) => setVndEmail(e.target.value)}
                  placeholder="orders@vendor.com"
                  className={INPUT_CLASS}
                />
                <input
                  type="text"
                  value={vndTerms}
                  onChange={(e) => setVndTerms(e.target.value)}
                  placeholder="Payment terms (Net 30)"
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setVndOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Vendor
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PR Modal */}
      <AnimatePresence>
        {prOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  New Purchase Request
                </h3>
                <button type="button" onClick={() => setPrOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreatePr} className="p-6 space-y-3.5">
                <input
                  type="text"
                  required
                  value={prTitle}
                  onChange={(e) => setPrTitle(e.target.value)}
                  placeholder="Request title (e.g. 4x Engineering Laptops)"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-3 gap-2.5">
                  <select
                    value={prCat}
                    onChange={(e) => setPrCat(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {ASSET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="1"
                    value={prQty}
                    onChange={(e) => setPrQty(e.target.value)}
                    placeholder="Qty"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <input
                    type="number"
                    min="0"
                    value={prEstCost}
                    onChange={(e) => setPrEstCost(e.target.value)}
                    placeholder="Est GH₵"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </div>
                <textarea
                  rows={2}
                  value={prJust}
                  onChange={(e) => setPrJust(e.target.value)}
                  placeholder="Justification..."
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPrOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Submit Request
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PO Modal */}
      <AnimatePresence>
        {poOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Issue Purchase Order
                </h3>
                <button type="button" onClick={() => setPoOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleCreatePo} className="p-6 space-y-3.5">
                <select
                  required
                  value={poVendorId}
                  onChange={(e) => setPoVendorId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">Select Vendor...</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={poItem}
                  onChange={(e) => setPoItem(e.target.value)}
                  placeholder="Hardware / Item Name"
                  className={INPUT_CLASS}
                />
                <div className="grid grid-cols-3 gap-2.5">
                  <select
                    value={poCat}
                    onChange={(e) => setPoCat(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {ASSET_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={poBrand}
                    onChange={(e) => setPoBrand(e.target.value)}
                    placeholder="Brand"
                    className={INPUT_CLASS}
                  />
                  <input
                    type="text"
                    value={poModel}
                    onChange={(e) => setPoModel(e.target.value)}
                    placeholder="Model"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="number"
                    min="1"
                    value={poQty}
                    onChange={(e) => setPoQty(e.target.value)}
                    placeholder="Quantity"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={poUnitCost}
                    onChange={(e) => setPoUnitCost(e.target.value)}
                    placeholder="Unit Cost (GH₵)"
                    className={`${INPUT_CLASS} font-mono`}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPoOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Issue PO
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PO Attachments Modal */}
      <AnimatePresence>
        {poAttachmentsTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPoAttachmentsTarget(null)}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    PO Documents · {poAttachmentsTarget.poNumber}
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)]">
                    {poAttachmentsTarget.itemName} · {poAttachmentsTarget.vendorName}
                  </p>
                </div>
                <button type="button" onClick={() => setPoAttachmentsTarget(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <div className="p-6">
                <AttachmentsPanel
                  entityType="po"
                  entityId={poAttachmentsTarget.id}
                  orgId={poAttachmentsTarget.orgId}
                  canWrite={canCreate || canApprove}
                  onToast={onToast}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
