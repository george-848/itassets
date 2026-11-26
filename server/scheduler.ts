import type { ItamsDatabase } from './db.ts';
import type { SaasStore } from './saasStore.ts';
import { evaluateTicketBreach } from './sla.ts';
import { sendTransactionalEmail } from './mailer.ts';
import { dispatchWebhookEvent } from './webhooks.ts';
import type { ScheduledReportConfig } from '../src/types/saas.ts';

export function computeNextRunIso(
  frequency: ScheduledReportConfig['frequency'],
  fromMs = Date.now()
): string {
  const days = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 30;
  return new Date(fromMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export async function buildScheduledReportSummary(
  store: SaasStore,
  db: ItamsDatabase,
  schedule: ScheduledReportConfig
): Promise<{ subject: string; text: string }> {
  const tenant = store.data.tenants.find((t) => t.id === schedule.tenantId);
  const tenantName = tenant?.name || 'AssetVault Workspace';
  const currency = tenant?.currency || 'USD';
  const assets = await db.listAssets({ tenantId: schedule.tenantId, orgIds: null });
  const maint = await db.listMaintenanceLogs({ tenantId: schedule.tenantId, orgIds: null });
  const tickets = store.data.tickets.filter((t) => t.tenantId === schedule.tenantId);
  const licences = store.data.softwareLicences.filter(
    (l) => l.tenantId === schedule.tenantId
  );

  const dateLabel = new Date().toISOString().slice(0, 10);
  const subject = `[${tenantName}] Scheduled ${schedule.reportType.toUpperCase()} Digest — ${dateLabel}`;

  if (schedule.reportType === 'inventory' || schedule.reportType === 'depreciation') {
    const totalCost = assets.reduce((s, a) => s + Number(a.cost || 0), 0);
    const assigned = assets.filter((a) => a.status === 'Assigned').length;
    const available = assets.filter((a) => a.status === 'Available').length;
    const maintenance = assets.filter((a) => a.status === 'Under Maintenance').length;
    return {
      subject,
      text: [
        `Scheduled Report: ${schedule.name}`,
        `Workspace: ${tenantName} (${currency})`,
        `Total Assets: ${assets.length} (Assigned: ${assigned}, Available: ${available}, Under Maintenance: ${maintenance})`,
        `Total Portfolio Acquisition Value: ${currency} ${totalCost.toFixed(2)}`,
      ].join('\n'),
    };
  }

  if (schedule.reportType === 'maintenance') {
    const totalMaintCost = maint.reduce((s, m) => s + Number(m.cost || 0), 0);
    const openMaint = maint.filter((m) => m.status !== 'Completed').length;
    return {
      subject,
      text: [
        `Scheduled Report: ${schedule.name}`,
        `Workspace: ${tenantName}`,
        `Total Maintenance Tickets: ${maint.length} (${openMaint} active/scheduled)`,
        `Cumulative Service Spend: ${currency} ${totalMaintCost.toFixed(2)}`,
      ].join('\n'),
    };
  }

  if (schedule.reportType === 'warranty') {
    const nowMs = Date.now();
    const expiring = assets.filter((a) => {
      const diff = (new Date(a.warranty_expiry).getTime() - nowMs) / 86400_000;
      return diff >= 0 && diff <= 45;
    });
    const expired = assets.filter(
      (a) => new Date(a.warranty_expiry).getTime() < nowMs
    );
    return {
      subject,
      text: [
        `Scheduled Report: ${schedule.name}`,
        `Workspace: ${tenantName}`,
        `Expired Warranties: ${expired.length}`,
        `Expiring Within 45 Days: ${expiring.length}`,
      ].join('\n'),
    };
  }

  if (schedule.reportType === 'licences') {
    const expiringSoon = licences.filter((l) => l.status !== 'Active').length;
    const spend = licences.reduce((s, l) => s + Number(l.costPerYearGhs || 0), 0);
    return {
      subject,
      text: [
        `Scheduled Report: ${schedule.name}`,
        `Workspace: ${tenantName}`,
        `Tracked Software Licences: ${licences.length} (${expiringSoon} expiring/expired)`,
        `Annual Licence Spend: GHS ${spend.toFixed(2)}`,
      ].join('\n'),
    };
  }

  const openTickets = tickets.filter(
    (t) => t.status !== 'Resolved' && t.status !== 'Closed'
  ).length;
  const breached = tickets.filter((t) => t.slaBreached).length;
  return {
    subject,
    text: [
      `Scheduled Report: ${schedule.name}`,
      `Workspace: ${tenantName}`,
      `Total Tickets: ${tickets.length} (${openTickets} open, ${breached} SLA breached)`,
    ].join('\n'),
  };
}

export async function runScheduledComplianceSweep(
  store: SaasStore,
  db: ItamsDatabase,
  options?: { forceReports?: boolean }
): Promise<{
  escalatedCount: number;
  alertsRecorded: number;
  reportsDispatched: number;
}> {
  const nowMs = Date.now();
  const todayKey = new Date().toISOString().slice(0, 10);
  let escalatedCount = 0;
  let alertsRecorded = 0;
  let reportsDispatched = 0;

  for (const ticket of store.data.tickets) {
    const check = evaluateTicketBreach(ticket, nowMs);
    if (check.breached && !ticket.slaBreached) {
      ticket.slaBreached = true;
      void dispatchWebhookEvent(store, ticket.tenantId, 'ticket.sla_breached', {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        priority: ticket.priority,
      });
    }
    if (check.needsEscalation) {
      ticket.escalationLevel += 1;
      ticket.status = 'Escalated';
      escalatedCount += 1;
      const jobKey = `sla-esc:${ticket.id}:${ticket.escalationLevel}:${todayKey}`;
      if (!store.data.alertJobHistory.some((h) => h.key === jobKey)) {
        store.data.alertJobHistory.push({
          key: jobKey,
          triggeredAt: new Date().toISOString(),
        });
        alertsRecorded += 1;

        const tenant = store.data.tenants.find((t) => t.id === ticket.tenantId);
        if (tenant?.supportEmail) {
          await sendTransactionalEmail(store, {
            tenantId: ticket.tenantId,
            to: tenant.supportEmail,
            subject: `[SLA Escalation] ${ticket.ticketNumber}: ${ticket.subject}`,
            text: `Ticket ${ticket.ticketNumber} (${ticket.priority}) breached SLA and was automatically escalated to level ${ticket.escalationLevel}.`,
          });
        }
      }
    }
  }

  for (const lic of store.data.softwareLicences) {
    const diff = Math.ceil(
      (new Date(lic.expiryDate).getTime() - nowMs) / 86400_000
    );
    lic.status = diff < 0 ? 'Expired' : diff <= 30 ? 'Expiring Soon' : 'Active';
  }
  for (const ctr of store.data.contracts) {
    const diff = Math.ceil(
      (new Date(ctr.endDate).getTime() - nowMs) / 86400_000
    );
    ctr.status = diff < 0 ? 'Expired' : diff <= 30 ? 'Expiring Soon' : 'Active';
  }

  for (const schedule of store.data.scheduledReports) {
    if (!schedule.enabled) continue;
    const due = options?.forceReports || new Date(schedule.nextRunAt).getTime() <= nowMs;
    if (!due) continue;

    const digest = await buildScheduledReportSummary(store, db, schedule);
    for (const recipient of schedule.recipients) {
      await sendTransactionalEmail(store, {
        tenantId: schedule.tenantId,
        to: recipient,
        subject: digest.subject,
        text: digest.text,
      });
    }
    schedule.lastRunAt = new Date(nowMs).toISOString();
    schedule.nextRunAt = computeNextRunIso(schedule.frequency, nowMs);
    reportsDispatched += 1;
  }

  await store.persist();
  return { escalatedCount, alertsRecorded, reportsDispatched };
}

export function startBackgroundScheduler(
  store: SaasStore,
  db: ItamsDatabase,
  intervalMs = 15 * 60 * 1000
): NodeJS.Timeout {
  const timer = setInterval(() => {
    void runScheduledComplianceSweep(store, db).catch((err) => {
      console.error('[AssetVault Scheduler] Background sweep failed:', err);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
