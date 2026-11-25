import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import * as XLSX from 'xlsx';
import {
  Archive,
  ArrowRightLeft,
  Download,
  FileSpreadsheet,
  QrCode,
  ScanLine,
  Upload,
  X,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type { Asset } from '../types/itams.ts';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function computeAssetBookValue(asset: Asset): number {
  const cost = Number(asset.cost || 0);
  const salvage = Number(asset.salvage_value ?? 0);
  const method = asset.depreciation_method ?? 'straight_line';
  const lifeYears = Math.max(1, Number(asset.useful_life_years ?? 4));
  if (method === 'none' || !asset.purchase_date) return cost;

  const purchasedMs = new Date(`${asset.purchase_date}T00:00:00`).getTime();
  if (!Number.isFinite(purchasedMs)) return cost;
  const elapsedYears = Math.max(0, (Date.now() - purchasedMs) / (365.25 * 86400_000));

  if (method === 'declining_balance') {
    const rate = Math.min(0.6, 2 / lifeYears);
    const val = cost * Math.pow(1 - rate, elapsedYears);
    return Math.max(salvage, Math.round(val * 100) / 100);
  }

  const ratio = Math.min(1, elapsedYears / lifeYears);
  const val = cost - (cost - salvage) * ratio;
  return Math.max(salvage, Math.round(val * 100) / 100);
}

export function AssetLabelModal({
  asset,
  onClose,
  onToast,
}: {
  asset: Asset | null;
  onClose: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const barcodeSvgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!asset) return;
    let active = true;
    const payload =
      asset.qr_payload ||
      JSON.stringify({
        tag: asset.asset_tag,
        serial: asset.serial_number,
        id: asset.id,
      });

    QRCode.toDataURL(payload, {
      width: 220,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' },
    })
      .then((url) => {
        if (active) setQrDataUrl(url);
      })
      .catch(() => {
        if (active) setQrDataUrl('');
      });

    if (barcodeSvgRef.current) {
      try {
        JsBarcode(barcodeSvgRef.current, asset.barcode_value || asset.asset_tag, {
          format: 'CODE128',
          width: 1.8,
          height: 44,
          displayValue: true,
          fontSize: 12,
          margin: 4,
          background: '#FFFFFF',
          lineColor: '#0F172A',
        });
      } catch {
        // Fallback handled silently
      }
    }

    return () => {
      active = false;
    };
  }, [asset]);

  const handleDownloadPdf = () => {
    if (!asset || !qrDataUrl) return;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: [280, 160] });
    doc.setFillColor(255, 255, 255);
    doc.rect(0, 0, 280, 160, 'F');
    doc.setDrawColor(203, 213, 225);
    doc.rect(8, 8, 264, 144);
    doc.addImage(qrDataUrl, 'PNG', 18, 24, 92, 92);
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('AssetVault IT', 122, 34);
    doc.setFontSize(13);
    doc.text(asset.asset_tag, 122, 54);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.text(`${asset.brand} ${asset.model}`.slice(0, 28), 122, 72);
    doc.text(`SN: ${asset.serial_number}`.slice(0, 28), 122, 86);
    doc.text(`Loc: ${asset.location}`.slice(0, 28), 122, 100);
    doc.setFontSize(8);
    doc.text(`Barcode: ${asset.barcode_value || asset.asset_tag}`, 18, 136);
    doc.save(`${asset.asset_tag}_Label.pdf`);
    onToast('success', `Asset tag label ${asset.asset_tag} downloaded as PDF.`);
  };

  return (
    <AnimatePresence>
      {asset && (
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
              <div className="flex items-center gap-2">
                <QrCode className="h-4.5 w-4.5 text-[var(--av-accent)]" />
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  QR &amp; Barcode Label · {asset.asset_tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-slate-900 space-y-3">
                <div className="flex items-center gap-4">
                  {qrDataUrl ? (
                    <img
                      src={qrDataUrl}
                      alt={`QR Code for ${asset.asset_tag}`}
                      className="h-24 w-24 shrink-0 rounded border border-slate-200"
                    />
                  ) : (
                    <div className="h-24 w-24 shrink-0 rounded bg-slate-100" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      AssetVault IT
                    </div>
                    <div className="font-mono text-base font-bold text-slate-900">
                      {asset.asset_tag}
                    </div>
                    <div className="text-xs font-medium text-slate-700 truncate">
                      {asset.name}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 truncate mt-0.5">
                      SN: {asset.serial_number}
                    </div>
                  </div>
                </div>
                <div className="flex justify-center border-t border-slate-100 pt-2">
                  <svg ref={barcodeSvgRef} className="max-w-full" />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download Label PDF</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function AssetLookupModal({
  open,
  assets,
  onClose,
  onSelectAsset,
  onToast,
}: {
  open: boolean;
  assets: Asset[];
  onClose: () => void;
  onSelectAsset: (assetId: string) => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}) {
  const [code, setCode] = useState('');

  const handleLookup = (e: FormEvent) => {
    e.preventDefault();
    const clean = code.trim().toLowerCase();
    if (!clean) return;
    let parsedTag = clean;
    try {
      const obj = JSON.parse(code) as { tag?: string; id?: string };
      if (obj.tag) parsedTag = obj.tag.toLowerCase();
    } catch {
      // Plain text tag/serial/barcode
    }
    const match = assets.find(
      (a) =>
        a.asset_tag.toLowerCase() === parsedTag ||
        a.serial_number.toLowerCase() === parsedTag ||
        (a.barcode_value || '').toLowerCase() === parsedTag ||
        a.id.toLowerCase() === parsedTag
    );
    if (!match) {
      onToast('error', `No asset matched tag or serial "${code.trim()}".`);
      return;
    }
    onSelectAsset(match.id);
    setCode('');
    onClose();
  };

  return (
    <AnimatePresence>
      {open && (
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
              <div className="flex items-center gap-2">
                <ScanLine className="h-4.5 w-4.5 text-[var(--av-accent)]" />
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  QR / Barcode Asset Lookup
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleLookup} className="p-6 space-y-4">
              <p className="text-xs text-[var(--av-text-muted)] leading-relaxed">
                Scan with a USB/Bluetooth barcode scanner or paste an Asset Tag, Serial Number, or QR JSON payload to jump directly to the asset record.
              </p>
              <input
                type="text"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. AV-1001 or C02YM4K9MD6R"
                className={`${INPUT_CLASS} font-mono`}
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                >
                  Open Asset Record
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function BulkImportAssetsModal({
  open,
  onClose,
  onImported,
  onToast,
  onPlanBlocked,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}) {
  const [rows, setRows] = useState<Array<Partial<Asset>>>([]);
  const [fileName, setFileName] = useState<string>('');
  const [importing, setImporting] = useState(false);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
      const mapped: Array<Partial<Asset>> = rawRows.map((r) => ({
        asset_tag: String(r.asset_tag || r['Asset Tag'] || '').trim().toUpperCase(),
        name: String(r.name || r['Name'] || r['Asset Name'] || '').trim(),
        category: (String(r.category || r['Category'] || 'Laptops').trim() ||
          'Laptops') as Asset['category'],
        brand: String(r.brand || r['Brand'] || 'Generic').trim(),
        model: String(r.model || r['Model'] || 'Standard').trim(),
        serial_number: String(r.serial_number || r['Serial Number'] || '').trim().toUpperCase(),
        purchase_date: String(
          r.purchase_date || r['Purchase Date'] || new Date().toISOString().slice(0, 10)
        ).slice(0, 10),
        warranty_expiry: String(
          r.warranty_expiry ||
            r['Warranty Expiry'] ||
            new Date(Date.now() + 3 * 365 * 86400_000).toISOString().slice(0, 10)
        ).slice(0, 10),
        cost: Number(r.cost || r['Cost'] || 0),
        location: String(r.location || r['Location'] || 'IT Vault').trim(),
      }));
      setRows(mapped.filter((m) => m.asset_tag && m.name && m.serial_number));
    } catch {
      onToast('error', 'Failed to parse spreadsheet. Ensure CSV or XLSX format.');
    }
  };

  const handleDownloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['asset_tag', 'name', 'category', 'brand', 'model', 'serial_number', 'purchase_date', 'warranty_expiry', 'cost', 'location'],
      ['AV-IMP-01', 'ThinkPad X1 Carbon Gen 11', 'Laptops', 'Lenovo', 'X1 Carbon', 'PF4ABC123', '2026-01-15', '2029-01-15', 1650, 'HQ Vault'],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'AssetsTemplate');
    XLSX.writeFile(wb, 'AssetVault_Import_Template.xlsx');
  };

  const handleImport = async () => {
    if (rows.length === 0) return;
    setImporting(true);
    try {
      const res = await api.importAssets(rows);
      onToast(
        'success',
        `Imported ${res.importedCount} assets.${
          res.skipped.length > 0 ? ` (${res.skipped.length} skipped)` : ''
        }`
      );
      setRows([]);
      setFileName('');
      onClose();
      await onImported();
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        (err.code === 'QUOTA_EXCEEDED' ||
          err.code === 'FEATURE_LOCKED' ||
          err.code === 'SUBSCRIPTION_READ_ONLY')
      ) {
        onClose();
        onPlanBlocked(err);
        return;
      }
      onToast('error', err instanceof ApiError ? err.message : 'Bulk import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
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
            className="w-full max-w-lg rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4.5 w-4.5 text-emerald-500" />
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Bulk CSV / Excel Asset Import
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] px-4 py-3 text-xs">
                <span className="text-[var(--av-text-muted)]">
                  Need the exact column headers?
                </span>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="font-semibold text-[var(--av-accent)] hover:underline"
                >
                  Download .xlsx Template
                </button>
              </div>

              <label className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--av-border)] bg-[var(--av-surface-muted)]/60 px-6 py-8 cursor-pointer hover:border-[var(--av-accent)] transition-colors text-center">
                <Upload className="h-6 w-6 text-[var(--av-accent)] mb-2" />
                <span className="text-xs font-semibold text-[var(--av-text)]">
                  {fileName || 'Choose CSV or Excel (.xlsx) file'}
                </span>
                <span className="text-[11px] text-[var(--av-text-subtle)] mt-1">
                  Columns: asset_tag, name, category, brand, model, serial_number, cost
                </span>
                <input
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>

              {rows.length > 0 && (
                <div className="text-xs text-emerald-700 dark:text-emerald-400 font-medium tabular-nums">
                  Ready to import {rows.length} valid asset rows.
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={rows.length === 0 || importing}
                  onClick={handleImport}
                  className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-50"
                >
                  {importing ? 'Importing...' : `Import ${rows.length} Assets`}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function TransferAssetModal({
  asset,
  tenantCtx,
  onClose,
  onTransferred,
  onToast,
  onPlanBlocked,
}: {
  asset: Asset | null;
  tenantCtx?: ExtendedTenantContext | null;
  onClose: () => void;
  onTransferred: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}) {
  const [toLocation, setToLocation] = useState('');
  const [toOrgId, setToOrgId] = useState('');
  const [toDepartment, setToDepartment] = useState('IT Infrastructure');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (asset) {
      setToLocation(asset.location || '');
      setToOrgId(asset.org_id || tenantCtx?.activeOrg.id || '');
      setReason('');
    }
  }, [asset, tenantCtx?.activeOrg.id]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!asset || !toLocation.trim() || !reason.trim()) return;
    setSubmitting(true);
    try {
      await api.transferAsset(asset.id, {
        toLocation: toLocation.trim(),
        toOrgId: toOrgId || undefined,
        toDepartment: toDepartment.trim(),
        reason: reason.trim(),
      });
      onToast('success', `Asset ${asset.asset_tag} transferred to ${toLocation}.`);
      onClose();
      await onTransferred();
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        err.code === 'SUBSCRIPTION_READ_ONLY'
      ) {
        onClose();
        onPlanBlocked(err);
        return;
      }
      onToast('error', err instanceof ApiError ? err.message : 'Transfer failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {asset && (
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
              <div className="flex items-center gap-2">
                <ArrowRightLeft className="h-4.5 w-4.5 text-[var(--av-accent)]" />
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Transfer Asset · {asset.asset_tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {(tenantCtx?.availableOrgs.length ?? 0) > 1 && (
                <div>
                  <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                    Target Client Organisation
                  </label>
                  <select
                    value={toOrgId}
                    onChange={(e) => setToOrgId(e.target.value)}
                    className={INPUT_CLASS}
                  >
                    {tenantCtx!.availableOrgs.map((org) => (
                      <option key={org.id} value={org.id}>
                        {org.name} ({org.code})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                  Destination Location *
                </label>
                <input
                  type="text"
                  required
                  value={toLocation}
                  onChange={(e) => setToLocation(e.target.value)}
                  placeholder="e.g. Kumasi Branch · Server Room"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                  Target Department
                </label>
                <input
                  type="text"
                  value={toDepartment}
                  onChange={(e) => setToDepartment(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                  Transfer Justification *
                </label>
                <input
                  type="text"
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Regional office deployment"
                  className={INPUT_CLASS}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                >
                  {submitting ? 'Transferring...' : 'Confirm Transfer'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DisposeAssetModal({
  asset,
  onClose,
  onDisposed,
  onToast,
  onPlanBlocked,
}: {
  asset: Asset | null;
  onClose: () => void;
  onDisposed: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleDispose = async (e: FormEvent) => {
    e.preventDefault();
    if (!asset || !reason.trim()) return;
    setSubmitting(true);
    try {
      await api.disposeAsset(asset.id, reason.trim());
      onToast('success', `Asset ${asset.asset_tag} retired & marked disposed.`);
      setReason('');
      onClose();
      await onDisposed();
    } catch (err) {
      if (
        err instanceof ApiError &&
        onPlanBlocked &&
        err.code === 'SUBSCRIPTION_READ_ONLY'
      ) {
        onClose();
        onPlanBlocked(err);
        return;
      }
      onToast('error', err instanceof ApiError ? err.message : 'Disposal failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {asset && (
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
              <div className="flex items-center gap-2">
                <Archive className="h-4.5 w-4.5 text-rose-500" />
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Retire &amp; Dispose · {asset.asset_tag}
                </h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleDispose} className="p-6 space-y-4">
              <p className="text-xs text-[var(--av-text-muted)] leading-relaxed">
                Decommission <strong>{asset.name}</strong>, set operational status to <strong>Retired</strong>, and record an immutable disposal audit entry.
              </p>
              <div>
                <label className="block text-xs font-medium text-[var(--av-text-muted)] mb-1.5">
                  Disposal / End-of-Life Reason *
                </label>
                <textarea
                  rows={2}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. End of 5-year lifecycle, certified e-waste wipe & recycle"
                  className={INPUT_CLASS}
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                >
                  {submitting ? 'Retiring...' : 'Retire & Dispose Asset'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
