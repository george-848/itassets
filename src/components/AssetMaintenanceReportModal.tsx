import { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Download, FileText, Printer, X } from 'lucide-react';
import {
  computeMaintenanceSummaryStats,
  generateAssetMaintenanceSummaryPDF,
  type AssetMaintenanceSummaryStats,
} from '../lib/exports.ts';
import type { Asset, MaintenanceLog } from '../types/itams.ts';
import { formatCurrencyExact } from './StatusText.tsx';

interface AssetMaintenanceReportModalProps {
  asset: Asset | null;
  maintenanceLogs: MaintenanceLog[];
  orgName?: string;
  onClose: () => void;
  onToast: (type: 'success' | 'error', message: string) => void;
}

function MaintenanceReportSheet({
  asset,
  stats,
  orgName,
  generatedAt,
}: {
  asset: Asset;
  stats: AssetMaintenanceSummaryStats;
  orgName?: string;
  generatedAt: string;
}) {
  const custodyText = asset.assigned_employee_name
    ? `${asset.assigned_employee_name} (${asset.assigned_employee_department || 'Staff'})`
    : 'Unassigned / In Stock';

  return (
    <div className="bg-white text-slate-900 rounded-lg border border-slate-200 shadow-sm overflow-hidden print:border-0 print:shadow-none print:rounded-none">
      {/* Header Banner */}
      <div className="bg-slate-900 text-white px-7 py-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.18em] uppercase text-slate-300">
            {orgName || asset.org_name || 'AssetVault IT'} · Lifecycle Service Audit
          </p>
          <h2 className="mt-1 text-lg font-bold tracking-tight text-white">
            ASSET MAINTENANCE SUMMARY REPORT
          </h2>
          <p className="mt-1 text-xs text-slate-300">Generated {generatedAt}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono text-base font-bold text-white">{asset.asset_tag}</div>
          <div className="mt-0.5 text-xs text-slate-300">Status: {asset.status}</div>
        </div>
      </div>

      <div className="p-7 space-y-6">
        {/* Executive KPI Summary Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Total Events
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
              {stats.sortedLogs.length}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              {stats.completedCount} completed · {stats.inProgressCount + stats.scheduledCount} open
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Service Spend
            </div>
            <div className="mt-1 text-lg font-bold text-slate-900 tabular-nums">
              {formatCurrencyExact(stats.totalCost)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-600">
              {stats.spendRatioPct !== null
                ? `${stats.spendRatioPct}% of asset cost`
                : 'No asset cost set'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Last Service
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900 tabular-nums pt-0.5">
              {stats.lastServiceDate || 'None'}
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              {stats.totalDowntimeMinutes > 0
                ? `${stats.totalDowntimeMinutes} mins downtime`
                : 'No downtime logged'}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
              Next Scheduled
            </div>
            <div className="mt-1 font-mono text-sm font-bold text-slate-900 tabular-nums pt-0.5">
              {stats.nextScheduledDate || 'Not set'}
            </div>
            <div className="mt-1 text-[11px] text-slate-600">
              {asset.warranty_expiry ? `Warranty: ${asset.warranty_expiry}` : 'Warranty N/A'}
            </div>
          </div>
        </div>

        {/* Section 1: Asset Profile */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1.5 mb-3">
            1. Asset Profile &amp; Custody
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 border border-slate-200 rounded-md overflow-hidden text-xs">
            <div className="grid grid-cols-[120px_1fr] border-b border-slate-200 sm:border-r">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Asset Name</div>
              <div className="px-3 py-2 text-slate-900 font-medium">{asset.name}</div>
            </div>
            <div className="grid grid-cols-[120px_1fr] border-b border-slate-200">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Brand / Model</div>
              <div className="px-3 py-2 text-slate-900">
                {asset.brand} {asset.model}
              </div>
            </div>
            <div className="grid grid-cols-[120px_1fr] border-b border-slate-200 sm:border-r">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Category</div>
              <div className="px-3 py-2 text-slate-900">{asset.category}</div>
            </div>
            <div className="grid grid-cols-[120px_1fr] border-b border-slate-200">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Serial Number</div>
              <div className="px-3 py-2 font-mono text-slate-900">{asset.serial_number}</div>
            </div>
            <div className="grid grid-cols-[120px_1fr] border-b border-slate-200 sm:border-r">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Location</div>
              <div className="px-3 py-2 text-slate-900">{asset.location}</div>
            </div>
            <div className="grid grid-cols-[120px_1fr] border-b border-slate-200">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Current Custody</div>
              <div className="px-3 py-2 text-slate-900">{custodyText}</div>
            </div>
            <div className="grid grid-cols-[120px_1fr] border-b sm:border-b-0 border-slate-200 sm:border-r">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">Purchase Date</div>
              <div className="px-3 py-2 font-mono text-slate-900 tabular-nums">
                {asset.purchase_date || '—'}
              </div>
            </div>
            <div className="grid grid-cols-[120px_1fr]">
              <div className="bg-slate-50 px-3 py-2 font-semibold text-slate-600">
                Acquisition Cost
              </div>
              <div className="px-3 py-2 font-mono font-semibold text-slate-900 tabular-nums">
                {formatCurrencyExact(asset.cost)}
              </div>
            </div>
          </div>
        </section>

        {/* Section 2: Cost Breakdown by Category */}
        {stats.byType.length > 0 && (
          <section className="break-inside-avoid">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1.5 mb-3">
              2. Maintenance Breakdown by Category
            </h3>
            <table className="w-full border-collapse border border-slate-200 text-xs">
              <thead>
                <tr className="bg-slate-100 text-slate-700">
                  <th className="border border-slate-200 px-3 py-2 text-left font-semibold">
                    Maintenance Type
                  </th>
                  <th className="border border-slate-200 px-3 py-2 text-right font-semibold">
                    Events
                  </th>
                  <th className="border border-slate-200 px-3 py-2 text-right font-semibold">
                    Share
                  </th>
                  <th className="border border-slate-200 px-3 py-2 text-right font-semibold">
                    Total Spend
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.byType.map((row) => (
                  <tr key={row.type} className="even:bg-slate-50/70">
                    <td className="border border-slate-200 px-3 py-2 font-medium text-slate-900">
                      {row.type}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-mono tabular-nums">
                      {row.count}
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-mono tabular-nums">
                      {row.pct}%
                    </td>
                    <td className="border border-slate-200 px-3 py-2 text-right font-mono font-semibold tabular-nums">
                      {formatCurrencyExact(row.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {/* Section 3: Detailed Service & Repair Log */}
        <section>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 border-b border-slate-200 pb-1.5 mb-3">
            {stats.byType.length > 0
              ? '3. Detailed Maintenance & Service History'
              : '2. Detailed Maintenance & Service History'}
          </h3>

          {stats.sortedLogs.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-4 text-xs text-slate-600">
              No maintenance or repair records have been logged for this asset yet.
            </div>
          ) : (
            <table className="w-full border-collapse border border-slate-200 text-xs">
              <thead>
                <tr className="bg-slate-900 text-white">
                  <th className="border border-slate-700 px-2.5 py-2 text-left font-semibold">
                    Date
                  </th>
                  <th className="border border-slate-700 px-2.5 py-2 text-left font-semibold">
                    Type
                  </th>
                  <th className="border border-slate-700 px-2.5 py-2 text-left font-semibold">
                    Issue &amp; Notes
                  </th>
                  <th className="border border-slate-700 px-2.5 py-2 text-left font-semibold">
                    Vendor / Tech
                  </th>
                  <th className="border border-slate-700 px-2.5 py-2 text-left font-semibold">
                    Status
                  </th>
                  <th className="border border-slate-700 px-2.5 py-2 text-left font-semibold">
                    Next Service
                  </th>
                  <th className="border border-slate-700 px-2.5 py-2 text-right font-semibold">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.sortedLogs.map((log) => (
                  <tr key={log.id} className="even:bg-slate-50 align-top">
                    <td className="border border-slate-200 px-2.5 py-2 font-mono whitespace-nowrap tabular-nums">
                      {log.service_date || '—'}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 font-medium text-slate-800">
                      {log.maintenance_type}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 text-slate-900">
                      <div>{log.issue_description}</div>
                      {log.notes && (
                        <div className="mt-1 text-[11px] text-slate-600">Notes: {log.notes}</div>
                      )}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 text-slate-700">
                      {log.vendor_or_technician || '—'}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 font-medium text-slate-800 whitespace-nowrap">
                      {log.status}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 font-mono whitespace-nowrap tabular-nums text-slate-600">
                      {log.next_service_date || '—'}
                    </td>
                    <td className="border border-slate-200 px-2.5 py-2 text-right font-mono font-semibold whitespace-nowrap tabular-nums">
                      {formatCurrencyExact(log.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 font-bold text-slate-900">
                  <td colSpan={6} className="border border-slate-200 px-2.5 py-2 text-right">
                    Total Maintenance Spend
                  </td>
                  <td className="border border-slate-200 px-2.5 py-2 text-right font-mono tabular-nums">
                    {formatCurrencyExact(stats.totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        {/* Sign-off Block */}
        <div className="pt-8 grid grid-cols-2 gap-12 break-inside-avoid">
          <div>
            <div className="border-t border-slate-400 pt-2 text-[11px] text-slate-600">
              Prepared By (IT Asset Administrator)
            </div>
          </div>
          <div>
            <div className="border-t border-slate-400 pt-2 text-[11px] text-slate-600">
              Reviewed By (IT Operations / Finance)
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-3 flex items-center justify-between text-[10px] text-slate-400">
          <span>{asset.asset_tag} · Maintenance Summary Report · Internal Audit Record</span>
          <span>{orgName || asset.org_name || 'AssetVault IT'}</span>
        </div>
      </div>
    </div>
  );
}

export function AssetMaintenanceReportModal({
  asset,
  maintenanceLogs,
  orgName,
  onClose,
  onToast,
}: AssetMaintenanceReportModalProps) {
  const stats = useMemo(
    () => (asset ? computeMaintenanceSummaryStats(asset, maintenanceLogs) : null),
    [asset, maintenanceLogs]
  );

  const generatedAt = useMemo(
    () =>
      new Date().toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [asset?.id, maintenanceLogs.length]
  );

  const handleDownloadPdf = () => {
    if (!asset) return;
    generateAssetMaintenanceSummaryPDF({
      asset,
      maintenanceLogs,
      orgName,
    });
    onToast(
      'success',
      `Maintenance summary PDF for ${asset.asset_tag} downloaded.`
    );
  };

  const handlePrint = () => {
    if (!asset) return;
    window.print();
  };

  return (
    <>
      <AnimatePresence>
        {asset && stats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-label={`Printable maintenance summary report for ${asset.asset_tag}`}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--av-border-subtle)] px-6 py-4 bg-[var(--av-surface)]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <FileText className="h-4.5 w-4.5 text-[var(--av-accent)] shrink-0" />
                  <div className="min-w-0">
                    <h3 className="font-display text-sm sm:text-base font-semibold text-[var(--av-text)] truncate">
                      Maintenance Summary Report · {asset.asset_tag}
                    </h3>
                    <p className="text-xs text-[var(--av-text-subtle)] truncate">
                      {asset.name} · {stats.sortedLogs.length} service record
                      {stats.sortedLogs.length === 1 ? '' : 's'} ·{' '}
                      {formatCurrencyExact(stats.totalCost)} total spend
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrint}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3 py-2 text-xs font-semibold text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Print</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span>Download PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors"
                    aria-label="Close report preview"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-[var(--av-surface-muted)] p-4 sm:p-6">
                <div className="mx-auto max-w-3xl">
                  <MaintenanceReportSheet
                    asset={asset}
                    stats={stats}
                    orgName={orgName}
                    generatedAt={generatedAt}
                  />
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {asset &&
        stats &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="hidden av-print-sheet">
            <MaintenanceReportSheet
              asset={asset}
              stats={stats}
              orgName={orgName}
              generatedAt={generatedAt}
            />
          </div>,
          document.body
        )}
    </>
  );
}
