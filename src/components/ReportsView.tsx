import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FileSpreadsheet, FileText } from 'lucide-react';
import { exportReportToExcel, exportReportToPDF } from '../lib/exports.ts';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  DEPARTMENTS,
  MAINTENANCE_STATUSES,
  type Asset,
  type AssetAssignment,
  type MaintenanceLog,
} from '../types/itams.ts';
import { formatCurrencyExact } from './StatusText.tsx';

type ReportType = 'inventory' | 'assigned' | 'maintenance' | 'warranty';

interface ReportsViewProps {
  assets: Asset[];
  assignments: AssetAssignment[];
  maintenanceLogs: MaintenanceLog[];
  onToast: (type: 'success' | 'error', message: string) => void;
}

export function ReportsView({
  assets,
  assignments,
  maintenanceLogs,
  onToast,
}: ReportsViewProps) {
  const [reportType, setReportType] = useState<ReportType>('inventory');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [maintenanceStatus, setMaintenanceStatus] = useState('ALL');
  const [warrantyScope, setWarrantyScope] = useState<
    'all_risk' | 'expiring_45' | 'expired' | 'replacement_due'
  >('all_risk');

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();
  const dayMs = 1000 * 60 * 60 * 24;

  const reportPayload = useMemo(() => {
    if (reportType === 'inventory') {
      const filtered = assets.filter((a) => {
        if (categoryFilter !== 'ALL' && a.category !== categoryFilter) return false;
        if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
        return true;
      });
      const totalVal = filtered.reduce((s, a) => s + Number(a.cost || 0), 0);
      return {
        title: 'IT Asset Inventory Report',
        subtitle: `Category: ${categoryFilter} · Status: ${statusFilter}`,
        sheetName: 'Asset Inventory',
        filename: `AssetVault_Inventory_${new Date().toISOString().slice(0, 10)}`,
        columns: [
          'Asset Tag',
          'Name',
          'Category',
          'Brand / Model',
          'Serial Number',
          'Status',
          'Assigned To',
          'Purchase Date',
          'Warranty Expiry',
          'Cost (USD)',
        ],
        rows: filtered.map((a) => [
          a.asset_tag,
          a.name,
          a.category,
          `${a.brand} ${a.model}`,
          a.serial_number,
          a.status,
          a.assigned_employee_name || 'Unassigned',
          a.purchase_date,
          a.warranty_expiry,
          formatCurrencyExact(a.cost),
        ]),
        summaryLines: [
          `Total Units: ${filtered.length}`,
          `Total Portfolio Value: ${formatCurrencyExact(totalVal)}`,
        ],
      };
    }

    if (reportType === 'assigned') {
      const activeOnly = assignments.filter((a) => {
        if (a.status !== 'Active') return false;
        if (deptFilter !== 'ALL' && a.employee_department !== deptFilter)
          return false;
        return true;
      });
      return {
        title: 'Assigned IT Assets Custody Report',
        subtitle: `Department: ${deptFilter}`,
        sheetName: 'Assigned Assets',
        filename: `AssetVault_Assigned_${new Date().toISOString().slice(0, 10)}`,
        columns: [
          'Handover #',
          'Asset Tag',
          'Equipment',
          'Category',
          'Serial Number',
          'Employee',
          'Employee ID',
          'Department',
          'Assigned Date',
          'Condition',
        ],
        rows: activeOnly.map((a) => [
          a.handover_number,
          a.asset_tag || '—',
          a.asset_name || '—',
          a.asset_category || '—',
          a.asset_serial || '—',
          a.employee_name || '—',
          a.employee_code || '—',
          a.employee_department || '—',
          a.assigned_date,
          a.condition_out,
        ]),
        summaryLines: [`Active Assigned Units: ${activeOnly.length}`],
      };
    }

    if (reportType === 'maintenance') {
      const filtered = maintenanceLogs.filter((m) => {
        if (maintenanceStatus !== 'ALL' && m.status !== maintenanceStatus)
          return false;
        return true;
      });
      const totalCost = filtered.reduce((s, m) => s + Number(m.cost || 0), 0);
      return {
        title: 'IT Equipment Maintenance & Service Cost Report',
        subtitle: `Ticket Status: ${maintenanceStatus}`,
        sheetName: 'Maintenance Report',
        filename: `AssetVault_Maintenance_${new Date().toISOString().slice(0, 10)}`,
        columns: [
          'Asset Tag',
          'Equipment',
          'Type',
          'Issue Description',
          'Technician / Vendor',
          'Service Date',
          'Next Due',
          'Status',
          'Cost (USD)',
        ],
        rows: filtered.map((m) => [
          m.asset_tag || '—',
          m.asset_name || '—',
          m.maintenance_type,
          m.issue_description,
          m.vendor_or_technician,
          m.service_date,
          m.next_service_date || '—',
          m.status,
          formatCurrencyExact(m.cost),
        ]),
        summaryLines: [
          `Service Records: ${filtered.length}`,
          `Total Maintenance Spend: ${formatCurrencyExact(totalCost)}`,
        ],
      };
    }

    // Warranty & Replacement Report
    const warrantyItems = assets
      .filter((a) => a.status !== 'Retired')
      .map((a) => {
        const expDays = Math.ceil(
          (new Date(`${a.warranty_expiry}T00:00:00`).getTime() - todayMs) / dayMs
        );
        const ageYears =
          (todayMs - new Date(`${a.purchase_date}T00:00:00`).getTime()) /
          (dayMs * 365.25);
        let riskLabel = 'Nominal';
        if (expDays < 0) riskLabel = `Warranty Expired (${Math.abs(expDays)}d ago)`;
        else if (expDays <= 45) riskLabel = `Expiring in ${expDays}d`;
        if (ageYears >= 4) {
          riskLabel =
            riskLabel === 'Nominal'
              ? `Replacement Due (${ageYears.toFixed(1)}y)`
              : `${riskLabel} · Refresh Due`;
        }
        return { asset: a, expDays, ageYears, riskLabel };
      })
      .filter((item) => {
        if (warrantyScope === 'expiring_45')
          return item.expDays >= 0 && item.expDays <= 45;
        if (warrantyScope === 'expired') return item.expDays < 0;
        if (warrantyScope === 'replacement_due') return item.ageYears >= 4;
        return item.expDays <= 45 || item.ageYears >= 4;
      });

    return {
      title: 'Warranty Expiry & Lifecycle Replacement Report',
      subtitle: `Scope: ${warrantyScope.replace('_', ' ')}`,
      sheetName: 'Warranty & Lifecycle',
      filename: `AssetVault_Warranty_Expiry_${new Date().toISOString().slice(0, 10)}`,
      columns: [
        'Asset Tag',
        'Equipment',
        'Category',
        'Purchase Date',
        'Age (Years)',
        'Warranty Expiry',
        'Status',
        'Risk / Action Flag',
        'Original Cost',
      ],
      rows: warrantyItems.map(({ asset, ageYears, riskLabel }) => [
        asset.asset_tag,
        asset.name,
        asset.category,
        asset.purchase_date,
        ageYears.toFixed(1),
        asset.warranty_expiry,
        asset.status,
        riskLabel,
        formatCurrencyExact(asset.cost),
      ]),
      summaryLines: [`Flagged Assets: ${warrantyItems.length}`],
    };
  }, [
    reportType,
    assets,
    assignments,
    maintenanceLogs,
    categoryFilter,
    statusFilter,
    deptFilter,
    maintenanceStatus,
    warrantyScope,
    todayMs,
    dayMs,
  ]);

  const handleExportPDF = () => {
    exportReportToPDF(reportPayload);
    onToast('success', `${reportPayload.title} exported as PDF.`);
  };

  const handleExportExcel = () => {
    exportReportToExcel({
      sheetName: reportPayload.sheetName,
      columns: reportPayload.columns,
      rows: reportPayload.rows,
      filename: reportPayload.filename,
    });
    onToast('success', `${reportPayload.title} exported as Excel (.xlsx).`);
  };

  return (
    <div className="space-y-5">
      {/* Report Selector & Export Actions */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(
              [
                ['inventory', 'Asset Inventory'],
                ['assigned', 'Assigned Assets'],
                ['maintenance', 'Maintenance & Costs'],
                ['warranty', 'Warranty & Replacement'],
              ] as const
            ).map(([key, label]) => {
              const active = reportType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReportType(key)}
                  className={`relative px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="reports-tab-indicator"
                      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute inset-0 rounded-md bg-white shadow-xs"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleExportExcel}
              disabled={reportPayload.rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
              <span>Export Excel</span>
            </button>
            <button
              type="button"
              onClick={handleExportPDF}
              disabled={reportPayload.rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              <span>Export PDF</span>
            </button>
          </div>
        </div>

        {/* Report-Specific Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {reportType === 'inventory' && (
              <>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                >
                  <option value="ALL">All Categories</option>
                  {ASSET_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
                >
                  <option value="ALL">All Statuses</option>
                  {ASSET_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </>
            )}

            {reportType === 'assigned' && (
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
              >
                <option value="ALL">All Departments</option>
                {DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}

            {reportType === 'maintenance' && (
              <select
                value={maintenanceStatus}
                onChange={(e) => setMaintenanceStatus(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
              >
                <option value="ALL">All Maintenance Statuses</option>
                {MAINTENANCE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}

            {reportType === 'warranty' && (
              <select
                value={warrantyScope}
                onChange={(e) =>
                  setWarrantyScope(
                    e.target.value as
                      | 'all_risk'
                      | 'expiring_45'
                      | 'expired'
                      | 'replacement_due'
                  )
                }
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"
              >
                <option value="all_risk">All Warranty & Lifecycle Risks</option>
                <option value="expiring_45">Expiring Within 45 Days</option>
                <option value="expired">Warranty Already Expired</option>
                <option value="replacement_due">Replacement Due (4+ Years)</option>
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-700 tabular-nums">
            {reportPayload.summaryLines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Live Preview Table */}
      <AnimatePresence mode="wait">
        <motion.div
          key={reportType}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white overflow-hidden"
        >
        <div className="border-b border-slate-100 px-5 py-3.5 flex items-center justify-between">
          <div>
            <h3 className="font-display text-sm font-semibold text-slate-900">
              {reportPayload.title}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Live dataset preview · {reportPayload.rows.length} rows
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                {reportPayload.columns.map((col) => (
                  <th key={col} className="py-3 px-4 whitespace-nowrap">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {reportPayload.rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={reportPayload.columns.length}
                    className="py-12 text-center text-slate-500"
                  >
                    No records match the selected report filters.
                  </td>
                </tr>
              ) : (
                reportPayload.rows.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70">
                    {row.map((cell, cIdx) => (
                      <td
                        key={cIdx}
                        className="py-2.5 px-4 text-slate-700 tabular-nums whitespace-nowrap"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
