import type { SlaPolicy, Ticket, TicketPriority } from '../src/types/saas.ts';

const DEFAULT_SLA_MINUTES: Record<
  TicketPriority,
  { firstResponse: number; resolution: number; escalationBefore: number }
> = {
  Urgent: { firstResponse: 15, resolution: 240, escalationBefore: 30 },
  High: { firstResponse: 60, resolution: 480, escalationBefore: 60 },
  Medium: { firstResponse: 240, resolution: 1440, escalationBefore: 120 },
  Low: { firstResponse: 480, resolution: 2880, escalationBefore: 240 },
};

/**
 * Adds minutes respecting business hours (Mon-Fri 08:00-17:00 UTC) when enabled.
 */
export function addSlaMinutes(
  startIso: string,
  minutes: number,
  businessHoursOnly: boolean
): string {
  const start = new Date(startIso);
  if (!businessHoursOnly) {
    return new Date(start.getTime() + minutes * 60_000).toISOString();
  }

  let remaining = Math.max(1, Math.round(minutes));
  const cursor = new Date(start.getTime());

  // Advance step-by-step in 15-minute increments across business hours (Mon-Fri, 08:00-17:00)
  let safety = 0;
  while (remaining > 0 && safety < 20000) {
    safety += 1;
    const day = cursor.getUTCDay(); // 0 Sun .. 6 Sat
    const hour = cursor.getUTCHours();
    const isWeekday = day >= 1 && day <= 5;
    const inHours = hour >= 8 && hour < 17;
    if (isWeekday && inHours) {
      const step = Math.min(15, remaining);
      cursor.setTime(cursor.getTime() + step * 60_000);
      remaining -= step;
    } else {
      cursor.setTime(cursor.getTime() + 15 * 60_000);
    }
  }
  return cursor.toISOString();
}

export function calculateTicketSlaTargets(params: {
  priority: TicketPriority;
  createdAt: string;
  policies: SlaPolicy[];
  orgId: string;
}): {
  slaPolicyId: string | null;
  firstResponseDueAt: string;
  resolutionDueAt: string;
} {
  const matchingPolicy =
    params.policies.find(
      (p) => p.orgId === params.orgId && p.priority === params.priority
    ) ||
    params.policies.find((p) => p.priority === params.priority) ||
    null;

  const fallback = DEFAULT_SLA_MINUTES[params.priority];
  const firstResponseMinutes =
    matchingPolicy?.firstResponseMinutes ?? fallback.firstResponse;
  const resolutionMinutes =
    matchingPolicy?.resolutionMinutes ?? fallback.resolution;
  const businessHoursOnly = matchingPolicy?.businessHoursOnly ?? false;

  return {
    slaPolicyId: matchingPolicy?.id ?? null,
    firstResponseDueAt: addSlaMinutes(
      params.createdAt,
      firstResponseMinutes,
      businessHoursOnly
    ),
    resolutionDueAt: addSlaMinutes(
      params.createdAt,
      resolutionMinutes,
      businessHoursOnly
    ),
  };
}

export function evaluateTicketBreach(ticket: Ticket, nowMs = Date.now()): {
  breached: boolean;
  needsEscalation: boolean;
} {
  if (ticket.status === 'Resolved' || ticket.status === 'Closed') {
    return { breached: ticket.slaBreached, needsEscalation: false };
  }
  const respMissed =
    !ticket.firstRespondedAt &&
    ticket.firstResponseDueAt !== null &&
    new Date(ticket.firstResponseDueAt).getTime() < nowMs;
  const resMissed =
    !ticket.resolvedAt &&
    ticket.resolutionDueAt !== null &&
    new Date(ticket.resolutionDueAt).getTime() < nowMs;

  const breached = ticket.slaBreached || respMissed || resMissed;

  const nearDeadline =
    !ticket.resolvedAt &&
    ticket.resolutionDueAt !== null &&
    new Date(ticket.resolutionDueAt).getTime() - nowMs <= 60 * 60_000;

  return {
    breached,
    needsEscalation: (breached || nearDeadline) && ticket.escalationLevel < 2,
  };
}
