import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import type { AssetAssignment } from '../types/itams.ts';

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
