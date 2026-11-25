import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { Asset, AssetAssignment, MaintenanceLog } from '../types/itams.ts';

export function exportReportToPDF(params: {
  title: string;
  subtitle: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  summaryLines?: string[];
  filename: string;
}): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 68, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('AssetVault IT', 36, 30);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(203, 213, 225);
  doc.text(params.title, 36, 49);

  doc.setFontSize(9);
  doc.text(
    `Generated: ${new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    pageWidth - 36,
    30,
    { align: 'right' }
  );
  doc.text(params.subtitle, pageWidth - 36, 49, { align: 'right' });

  let startY = 88;
  if (params.summaryLines && params.summaryLines.length > 0) {
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.text(params.summaryLines.join('   |   '), 36, startY);
    startY += 18;
  }

  autoTable(doc, {
    startY,
    head: [params.columns],
    body: params.rows,
    margin: { left: 36, right: 36 },
    styles: {
      fontSize: 8.5,
      cellPadding: 6,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
  });

  doc.save(params.filename.endsWith('.pdf') ? params.filename : `${params.filename}.pdf`);
}

export function exportReportToExcel(params: {
  sheetName: string;
  columns: string[];
  rows: Array<Array<string | number>>;
  filename: string;
}): void {
  const worksheetData = [params.columns, ...params.rows];
  const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

  // Auto-size columns cleanly
  worksheet['!cols'] = params.columns.map((col, idx) => {
    const maxLen = Math.max(
      col.length,
      ...params.rows.map((r) => String(r[idx] ?? '').length)
    );
    return { wch: Math.min(Math.max(maxLen + 4, 12), 42) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    worksheet,
    params.sheetName.slice(0, 31)
  );
  XLSX.writeFile(
    workbook,
    params.filename.endsWith('.xlsx') ? params.filename : `${params.filename}.xlsx`
  );
}

export function generateHandoverPDF(assignment: AssetAssignment): void {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Enterprise Document Header
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 84, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('IT ASSET HANDOVER RECORD', 40, 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(203, 213, 225);
  doc.text('AssetVault IT · Corporate Equipment Custody & Acknowledgement', 40, 58);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`Ref: ${assignment.handover_number}`, pageWidth - 40, 38, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(`Status: ${assignment.status}`, pageWidth - 40, 58, { align: 'right' });

  let y = 114;

  const drawSection = (title: string, pairs: Array<[string, string]>) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(title, 40, y);
    y += 8;
    doc.setDrawColor(203, 213, 225);
    doc.line(40, y, pageWidth - 40, y);
    y += 14;

    autoTable(doc, {
      startY: y,
      body: pairs,
      theme: 'plain',
      margin: { left: 40, right: 40 },
      columnStyles: {
        0: { cellWidth: 150, fontStyle: 'bold', textColor: [71, 85, 105] },
        1: { textColor: [15, 23, 42] },
      },
      styles: {
        fontSize: 9.5,
        cellPadding: 4,
      },
    });
    const lastTable = (doc as unknown as { lastAutoTable?: { finalY: number } })
      .lastAutoTable;
    y = (lastTable?.finalY ?? y + 60) + 22;
  };

  drawSection('1. Equipment Details', [
    ['Asset Tag', assignment.asset_tag || '—'],
    ['Asset Name', assignment.asset_name || '—'],
    ['Category', assignment.asset_category || '—'],
    ['Brand / Model', `${assignment.asset_brand || ''} ${assignment.asset_model || ''}`.trim() || '—'],
    ['Serial Number', assignment.asset_serial || '—'],
  ]);

  drawSection('2. Employee Custody Information', [
    ['Employee Name', assignment.employee_name || '—'],
    ['Employee ID', assignment.employee_code || '—'],
    ['Department', assignment.employee_department || '—'],
    ['Work Email', assignment.employee_email || '—'],
  ]);

  drawSection('3. Assignment & Condition Log', [
    ['Issued By (IT)', assignment.assigned_by_name || 'IT Administrator'],
    ['Assignment Date', assignment.assigned_date],
    ['Condition at Issue', assignment.condition_out],
    ['Return Date', assignment.returned_date || 'Currently Assigned'],
    ['Condition at Return', assignment.condition_in || '—'],
    ['Notes', assignment.notes || 'None'],
  ]);

  // Compliance acknowledgement
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('4. Custody Acknowledgement & Policy Terms', 40, y);
  y += 14;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  const disclaimer =
    'By accepting this equipment, the employee acknowledges receipt of the listed IT asset in the condition stated above and agrees to adhere to corporate acceptable-use, physical security, and data-protection policies. Any loss, theft, or hardware damage must be reported immediately to the IT Department.';
  const lines = doc.splitTextToSize(disclaimer, pageWidth - 80);
  doc.text(lines, 40, y);
  y += lines.length * 13 + 36;

  // Signature lines
  doc.setDrawColor(148, 163, 184);
  doc.line(40, y, 240, y);
  doc.line(pageWidth - 240, y, pageWidth - 40, y);
  y += 14;
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  doc.text(`Employee Signature (${assignment.employee_name || 'Recipient'})`, 40, y);
  doc.text(
    `IT Administrator (${assignment.assigned_by_name || 'Authorized Signatory'})`,
    pageWidth - 240,
    y
  );

  doc.save(`${assignment.handover_number}_Handover.pdf`);
}

export interface AssetMaintenanceSummaryStats {
  sortedLogs: MaintenanceLog[];
  totalCost: number;
  completedCount: number;
  inProgressCount: number;
  scheduledCount: number;
  spendRatioPct: number | null;
  totalDowntimeMinutes: number;
  lastServiceDate: string | null;
  nextScheduledDate: string | null;
  byType: Array<{
    type: string;
    count: number;
    cost: number;
    pct: number;
  }>;
}

function formatMoneyUSD(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(amount || 0));
}

export function computeMaintenanceSummaryStats(
  asset: Asset,
  maintenanceLogs: MaintenanceLog[]
): AssetMaintenanceSummaryStats {
  const sortedLogs = [...maintenanceLogs].sort((a, b) =>
    (b.service_date || '').localeCompare(a.service_date || '')
  );

  const totalCost = sortedLogs.reduce((sum, m) => sum + Number(m.cost || 0), 0);
  const completedCount = sortedLogs.filter((m) => m.status === 'Completed').length;
  const inProgressCount = sortedLogs.filter((m) => m.status === 'In Progress').length;
  const scheduledCount = sortedLogs.filter((m) => m.status === 'Scheduled').length;
  const totalDowntimeMinutes = sortedLogs.reduce(
    (sum, m) => sum + Number(m.downtime_minutes || 0),
    0
  );

  const assetCost = Number(asset.cost || 0);
  const spendRatioPct =
    assetCost > 0 ? Math.round((totalCost / assetCost) * 1000) / 10 : null;

  const completedOrPast = sortedLogs.filter((m) => m.status !== 'Scheduled');
  const lastServiceDate =
    completedOrPast[0]?.service_date || sortedLogs[0]?.service_date || null;

  const upcomingDates = sortedLogs
    .flatMap((m) => {
      const dates: string[] = [];
      if (m.next_service_date) dates.push(m.next_service_date);
      if (m.status === 'Scheduled' && m.service_date) dates.push(m.service_date);
      return dates;
    })
    .filter(Boolean)
    .sort();
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextScheduledDate =
    upcomingDates.find((d) => d >= todayIso) || upcomingDates[upcomingDates.length - 1] || null;

  const typeMap = new Map<string, { count: number; cost: number }>();
  for (const log of sortedLogs) {
    const key = log.maintenance_type || 'Other';
    const current = typeMap.get(key) || { count: 0, cost: 0 };
    current.count += 1;
    current.cost += Number(log.cost || 0);
    typeMap.set(key, current);
  }

  const byType = Array.from(typeMap.entries())
    .map(([type, info]) => ({
      type,
      count: info.count,
      cost: info.cost,
      pct:
        totalCost > 0
          ? Math.round((info.cost / totalCost) * 1000) / 10
          : sortedLogs.length > 0
          ? Math.round((info.count / sortedLogs.length) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.cost - a.cost || b.count - a.count);

  return {
    sortedLogs,
    totalCost,
    completedCount,
    inProgressCount,
    scheduledCount,
    spendRatioPct,
    totalDowntimeMinutes,
    lastServiceDate,
    nextScheduledDate,
    byType,
  };
}

export function generateAssetMaintenanceSummaryPDF(params: {
  asset: Asset;
  maintenanceLogs: MaintenanceLog[];
  orgName?: string;
}): void {
  const { asset, maintenanceLogs, orgName } = params;
  const stats = computeMaintenanceSummaryStats(asset, maintenanceLogs);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 36;

  // Header Band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 86, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text('ASSET MAINTENANCE SUMMARY REPORT', margin, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `${orgName || asset.org_name || 'AssetVault IT'}  |  Lifecycle Service & Repair Audit`,
    margin,
    56
  );
  doc.text(
    `Generated: ${new Date().toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    margin,
    71
  );

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(asset.asset_tag, pageWidth - margin, 38, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Status: ${asset.status}`, pageWidth - margin, 56, { align: 'right' });

  let y = 108;

  // Executive KPI Strip (4 cards)
  const cardGap = 10;
  const cardWidth = (pageWidth - margin * 2 - cardGap * 3) / 4;
  const kpis = [
    {
      label: 'TOTAL EVENTS',
      value: String(stats.sortedLogs.length),
      sub: `${stats.completedCount} completed · ${stats.inProgressCount + stats.scheduledCount} open`,
    },
    {
      label: 'TOTAL SERVICE SPEND',
      value: formatMoneyUSD(stats.totalCost),
      sub:
        stats.spendRatioPct !== null
          ? `${stats.spendRatioPct}% of asset cost`
          : 'No acquisition cost recorded',
    },
    {
      label: 'LAST SERVICE DATE',
      value: stats.lastServiceDate || 'None',
      sub:
        stats.totalDowntimeMinutes > 0
          ? `${stats.totalDowntimeMinutes} mins downtime`
          : 'No downtime logged',
    },
    {
      label: 'NEXT SCHEDULED',
      value: stats.nextScheduledDate || 'Not set',
      sub: asset.warranty_expiry ? `Warranty: ${asset.warranty_expiry}` : 'Warranty N/A',
    },
  ];

  kpis.forEach((kpi, idx) => {
    const x = margin + idx * (cardWidth + cardGap);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(x, y, cardWidth, 54, 4, 4, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 8, y + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, x + 8, y + 32);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(71, 85, 105);
    doc.text(kpi.sub.slice(0, 28), x + 8, y + 45);
  });

  y += 74;

  // Section 1: Asset Profile
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text('1. Asset Profile & Custody', margin, y);
  y += 8;

  const custodyText = asset.assigned_employee_name
    ? `${asset.assigned_employee_name} (${asset.assigned_employee_department || 'Staff'})`
    : 'Unassigned / In Stock';

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: 'grid',
    body: [
      ['Asset Name', asset.name, 'Brand / Model', `${asset.brand} ${asset.model}`],
      ['Category', asset.category, 'Serial Number', asset.serial_number],
      ['Location', asset.location, 'Current Custody', custodyText],
      ['Purchase Date', asset.purchase_date || '—', 'Acquisition Cost', formatMoneyUSD(asset.cost)],
    ],
    columnStyles: {
      0: { cellWidth: 88, fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [71, 85, 105] },
      1: { cellWidth: 170, textColor: [15, 23, 42] },
      2: { cellWidth: 94, fontStyle: 'bold', fillColor: [248, 250, 252], textColor: [71, 85, 105] },
      3: { textColor: [15, 23, 42] },
    },
    styles: {
      fontSize: 8.5,
      cellPadding: 5,
      lineColor: [226, 232, 240],
      lineWidth: 0.5,
    },
  });

  y =
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 90) +
    18;

  // Section 2: Cost Breakdown by Service Type
  if (stats.byType.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('2. Maintenance Breakdown by Category', margin, y);
    y += 8;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Maintenance Type', 'Events', 'Share', 'Total Spend']],
      body: stats.byType.map((item) => [
        item.type,
        String(item.count),
        `${item.pct}%`,
        formatMoneyUSD(item.cost),
      ]),
      styles: {
        fontSize: 8.5,
        cellPadding: 5,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      columnStyles: {
        1: { halign: 'right' },
        2: { halign: 'right' },
        3: { halign: 'right', fontStyle: 'bold' },
      },
    });

    y =
      ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 70) +
      18;
  }

  // Section 3: Detailed Service & Repair Log
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(
    stats.byType.length > 0
      ? '3. Detailed Maintenance & Service History'
      : '2. Detailed Maintenance & Service History',
    margin,
    y
  );
  y += 8;

  if (stats.sortedLogs.length === 0) {
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, pageWidth - margin * 2, 36, 4, 4, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'No maintenance or repair records have been logged for this asset yet.',
      margin + 12,
      y + 22
    );
    y += 52;
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin, bottom: 56 },
      head: [['Date', 'Type', 'Issue & Technician Notes', 'Vendor / Tech', 'Status', 'Next Service', 'Cost']],
      body: stats.sortedLogs.map((m) => [
        m.service_date || '—',
        m.maintenance_type,
        m.notes ? `${m.issue_description}\nNotes: ${m.notes}` : m.issue_description,
        m.vendor_or_technician || '—',
        m.status,
        m.next_service_date || '—',
        formatMoneyUSD(m.cost),
      ]),
      foot: [['', '', '', '', '', 'Total Spend', formatMoneyUSD(stats.totalCost)]],
      styles: {
        fontSize: 8,
        cellPadding: 5,
        textColor: [15, 23, 42],
        lineColor: [226, 232, 240],
        lineWidth: 0.5,
        valign: 'top',
      },
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 250, 252],
      },
      columnStyles: {
        0: { cellWidth: 58 },
        1: { cellWidth: 74 },
        2: { cellWidth: 145 },
        3: { cellWidth: 80 },
        4: { cellWidth: 58 },
        5: { cellWidth: 58 },
        6: { halign: 'right', cellWidth: 50, fontStyle: 'bold' },
      },
    });

    y =
      ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 80) +
      24;
  }

  // Sign-off Block (move to new page if near bottom)
  if (y > pageHeight - 90) {
    doc.addPage();
    y = 60;
  }
  doc.setDrawColor(148, 163, 184);
  doc.line(margin, y + 20, margin + 190, y + 20);
  doc.line(pageWidth - margin - 190, y + 20, pageWidth - margin, y + 20);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Prepared By (IT Asset Administrator)', margin, y + 33);
  doc.text('Reviewed By (IT Operations / Finance)', pageWidth - margin - 190, y + 33);

  // Page Footer across all pages
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `${asset.asset_tag} · Maintenance Summary Report · Internal Audit Record`,
      margin,
      pageHeight - 20
    );
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 20, {
      align: 'right',
    });
  }

  doc.save(`${asset.asset_tag}_Maintenance_Summary.pdf`);
}
