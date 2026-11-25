import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, FileSpreadsheet, FileText } from 'lucide-react';
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
import type { PurchaseOrder, SoftwareLicence, Ticket } from '../types/saas.ts';
import { formatCurrencyExact, formatGhsExact } from './StatusText.tsx';
import { DataPagination } from './ui/DataPagination.tsx';
import { EmptyState } from './ui/EmptyState.tsx';

type ReportType =
  | 'inventory'
  | 'assigned'
  | 'maintenance'
  | 'warranty'
  | 'tickets'
  | 'licences'
  | 'procurement';

interface ReportsViewProps {
  assets: Asset[];
  assignments: AssetAssignment[];
  maintenanceLogs: MaintenanceLog[];
  tickets?: Ticket[];
  licences?: SoftwareLicence[];
  purchaseOrders?: PurchaseOrder[];
  onToast: (type: 'success' | 'error', message: string) => void;
}

const SELECT_CLASS =
  'rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-xs font-medium text-[var(--av-text)] transition-all focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

export function ReportsView({
  assets,
  assignments,
  maintenanceLogs,
  tickets = [],
  licences = [],
  purchaseOrders = [],
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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

    if (reportType === 'tickets') {
      const breachedCount = tickets.filter((t) => t.slaBreached).length;
      return {
        title: 'Helpdesk & SLA Compliance Report',
        subtitle: 'Support ticket queue, assignees, and SLA status',
        sheetName: 'Helpdesk SLA',
        filename: `AssetVault_Helpdesk_SLA_${new Date().toISOString().slice(0, 10)}`,
        columns: [
          'Ticket #',
          'Subject',
          'Category',
          'Priority',
          'Status',
          'Requester',
          'Assignee',
          'Asset Tag',
          'SLA Status',
          'Created',
        ],
        rows: tickets.map((t) => [
          t.ticketNumber,
          t.subject,
          t.category,
          t.priority,
          t.status,
          t.requesterName,
          t.assigneeName || 'Unassigned',
          t.assetTag || '—',
          t.slaBreached ? 'BREACHED' : 'On Track',
          t.createdAt.slice(0, 10),
        ]),
        summaryLines: [
          `Total Tickets: ${tickets.length}`,
          `SLA Breached: ${breachedCount}`,
        ],
      };
    }

    if (reportType === 'licences') {
      const annualSpend = licences.reduce((s, l) => s + Number(l.costPerYearGhs || 0), 0);
      return {
        title: 'Software Licences & Seat Allocation Report',
        subtitle: 'Active seats, renewal dates, and GH₵ annual spend',
        sheetName: 'Software Licences',
        filename: `AssetVault_Licences_${new Date().toISOString().slice(0, 10)}`,
        columns: [
          'Software',
          'Vendor',
          'Type',
          'Assigned / Total Seats',
          'Status',
          'Expiry Date',
          'Auto Renew',
          'Annual Cost (GH₵)',
        ],
        rows: licences.map((l) => [
          l.softwareName,
          l.vendor,
          l.licenceType,
          `${l.assignedSeats} / ${l.totalSeats}`,
          l.status,
          l.expiryDate,
          l.autoRenew ? 'Yes' : 'No',
          formatGhsExact(l.costPerYearGhs),
        ]),
        summaryLines: [
          `Tracked Titles: ${licences.length}`,
          `Annual Licence Spend: ${formatGhsExact(annualSpend)}`,
        ],
      };
    }

    if (reportType === 'procurement') {
      const totalSpend = purchaseOrders.reduce((s, p) => s + Number(p.totalCostGhs || 0), 0);
      return {
        title: 'IT Procurement & Purchase Order Spend Report',
        subtitle: 'Vendor orders, delivery status, and GH₵ total spend',
        sheetName: 'Procurement POs',
        filename: `AssetVault_Procurement_${new Date().toISOString().slice(0, 10)}`,
        columns: [
          'PO Number',
          'Item',
          'Category',
          'Vendor',
          'Qty',
          'Unit Cost (GH₵)',
          'Total Cost (GH₵)',
          'Expected Delivery',
          'Status',
        ],
        rows: purchaseOrders.map((p) => [
          p.poNumber,
          p.itemName,
          p.category,
          p.vendorName,
          p.quantity,
          formatGhsExact(p.unitCostGhs),
          formatGhsExact(p.totalCostGhs),
          p.expectedDeliveryDate,
          p.status,
        ]),
        summaryLines: [
          `Purchase Orders: ${purchaseOrders.length}`,
          `Total PO Value: ${formatGhsExact(totalSpend)}`,
        ],
      };
    }

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
    tickets,
    licences,
    purchaseOrders,
    categoryFilter,
    statusFilter,
    deptFilter,
    maintenanceStatus,
    warrantyScope,
    todayMs,
    dayMs,
  ]);

  useEffect(() => {
    setPage(1);
  }, [
    reportType,
    categoryFilter,
    statusFilter,
    deptFilter,
    maintenanceStatus,
    warrantyScope,
  ]);

  const paginatedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return reportPayload.rows.slice(start, start + pageSize);
  }, [reportPayload.rows, page, pageSize]);

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
    <div className="space-y-4">
      {/* Report Selector & Export Actions */}
      <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 sm:p-5 shadow-[var(--av-card-shadow)] space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)] p-1">
            {(
              [
                ['inventory', 'Asset Inventory'],
                ['assigned', 'Assigned Assets'],
                ['maintenance', 'Maintenance & Costs'],
                ['warranty', 'Warranty & Replacement'],
                ['tickets', 'Helpdesk & SLA'],
                ['licences', 'Software Licences'],
                ['procurement', 'Procurement Spend'],
              ] as const
            ).map(([key, label]) => {
              const active = reportType === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setReportType(key)}
                  className={`relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    active
                      ? 'text-[var(--av-text)]'
                      : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="reports-tab-indicator"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-md bg-[var(--av-surface)] border border-[var(--av-border-subtle)] shadow-xs"
                    />
                  )}
                  <span className="relative z-10">{label}</span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <motion.button
              whileTap={{ scale: 0.985 }}
              type="button"
              onClick={handleExportExcel}
              disabled={reportPayload.rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] px-3.5 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)] hover:text-[var(--av-text)] transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <FileSpreadsheet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
              <span>Export Excel</span>
            </motion.button>
            <motion.button
              whileTap={{ scale: 0.985 }}
              type="button"
              onClick={handleExportPDF}
              disabled={reportPayload.rows.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <FileText className="h-4 w-4" />
              <span>Export PDF</span>
            </motion.button>
          </div>
        </div>

        {/* Report-Specific Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--av-border-subtle)] pt-4">
          <div className="flex flex-wrap items-center gap-2.5">
            {reportType === 'inventory' && (
              <>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  aria-label="Filter report by category"
                  className={SELECT_CLASS}
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
                  aria-label="Filter report by status"
                  className={SELECT_CLASS}
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
                aria-label="Filter report by department"
                className={SELECT_CLASS}
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
                aria-label="Filter report by maintenance status"
                className={SELECT_CLASS}
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
                aria-label="Filter warranty risk scope"
                className={SELECT_CLASS}
              >
                <option value="all_risk">All Warranty &amp; Lifecycle Risks</option>
                <option value="expiring_45">Expiring Within 45 Days</option>
                <option value="expired">Warranty Already Expired</option>
                <option value="replacement_due">Replacement Due (4+ Years)</option>
              </select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-[var(--av-text-muted)] tabular-nums">
            {reportPayload.summaryLines.map((line, index) => (
              <span key={line} className="inline-flex items-center gap-3">
                {index > 0 && (
                  <span className="text-[var(--av-text-subtle)]" aria-hidden="true">
                    ·
                  </span>
                )}
                <span>{line}</span>
              </span>
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
          className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden"
        >
          <div className="border-b border-[var(--av-border-subtle)] px-5 py-3.5 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-sm font-semibold text-[var(--av-text)]">
                {reportPayload.title}
              </h3>
              <p className="text-xs text-[var(--av-text-subtle)] mt-0.5 tabular-nums">
                Live dataset preview · {reportPayload.rows.length} exportable rows
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                  {reportPayload.columns.map((col) => (
                    <th key={col} className="py-3 px-4 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                {paginatedRows.length === 0 ? (
                  <tr>
                    <td colSpan={reportPayload.columns.length}>
                      <EmptyState
                        icon={BarChart3}
                        title="No matching rows for export"
                        description="Adjust the selected category, status, or department filters to generate this report dataset."
                      />
                    </td>
                  </tr>
                ) : (
                  paginatedRows.map((row, idx) => (
                    <tr
                      key={(page - 1) * pageSize + idx}
                      className="hover:bg-[var(--av-surface-hover)] transition-colors"
                    >
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`py-3 px-4 tabular-nums whitespace-nowrap ${
                            cIdx === 0
                              ? 'font-mono font-semibold text-[var(--av-text)]'
                              : 'text-[var(--av-text-muted)]'
                          }`}
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

          <DataPagination
            totalItems={reportPayload.rows.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            itemLabel="rows"
          />
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
