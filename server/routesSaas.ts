import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  canAccessRecordOrg,
  requireFeature,
  requirePermission,
  requirePlatformSuperAdmin,
  requireWritableSubscription,
  type TenantRequest,
} from './context.ts';
import type { ItamsDatabase } from './db.ts';
import { checkQuotaExceeded } from './entitlements.ts';
import {
  initializePaystackPayment,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from './paystack.ts';
import { hashPassword } from './auth.ts';
import { sendTransactionalEmail } from './mailer.ts';
import { canViewInternalTicketNotes } from './rbac.ts';
import { registerIntegrationRoutes } from './routesIntegrations.ts';
import { registerPlatformDatabaseRoutes } from './platformDatabaseRoutes.ts';
import { DEFAULT_TENANT_ID, type SaasStore } from './saasStore.ts';
import { runScheduledComplianceSweep } from './scheduler.ts';
import { calculateTicketSlaTargets, evaluateTicketBreach } from './sla.ts';
import { dispatchWebhookEvent } from './webhooks.ts';
import type { Asset, AssetCategory } from '../src/types/itams.ts';
import type {
  BillingCycle,
  ChangeRequest,
  ClientOrganisation,
  DepartmentItem,
  Incident,
  InvoiceRecord,
  KnowledgeArticle,
  LocationItem,
  PaymentTransaction,
  PlanCode,
  ProblemRecord,
  PurchaseOrder,
  PurchaseRequest,
  ServiceContract,
  ServiceRequest,
  SlaPolicy,
  SoftwareLicence,
  Tenant,
  TenantRole,
  TenantSubscription,
  TenantType,
  Ticket,
  TicketComment,
  TicketPriority,
  TicketStatus,
  UserMembership,
  Vendor,
} from '../src/types/saas.ts';

function scopeMatch(
  item: { tenantId: string; orgId: string },
  req: TenantRequest
): boolean {
  const ctx = req.tenantCtx!;
  if (item.tenantId !== ctx.tenant.id) return false;
  if (ctx.scopeFilter.orgIds && !ctx.scopeFilter.orgIds.includes(item.orgId)) {
    return false;
  }
  return true;
}

function maskLicenceKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 6) return '••••••';
  return `${clean.slice(0, 4)}-${'•'.repeat(Math.min(10, clean.length - 8))}-${clean.slice(-4)}`;
}

export function registerSaasRoutes(params: {
  app: Express;
  db: ItamsDatabase;
  store: SaasStore;
  requireAuth: (req: Request, res: Response, next: () => void) => void;
  resolveTenantContext: (req: Request, res: Response, next: () => void) => void;
}) {
  const { app, db, store, requireAuth, resolveTenantContext } = params;

  const tenantGuard = [requireAuth, resolveTenantContext];

  // -------------------------------------------------------------------------
  // Public Plans & Paystack Webhook (No session required for webhook/plans)
  // -------------------------------------------------------------------------
  app.get('/api/billing/plans', (_req, res) => {
    res.json({
      plans: store.data.plans.filter((p) => p.isPublic),
      currency: 'GHS',
    });
  });

  app.post('/api/billing/paystack/webhook', async (req, res) => {
    try {
      const signature =
        typeof req.headers['x-paystack-signature'] === 'string'
          ? req.headers['x-paystack-signature']
          : '';
      const rawBody =
        typeof (req as Request & { rawBody?: string }).rawBody === 'string'
          ? (req as Request & { rawBody?: string }).rawBody!
          : JSON.stringify(req.body ?? {});

      if (!verifyPaystackWebhookSignature(rawBody, signature)) {
        res.status(401).json({ error: 'Invalid Paystack webhook signature.' });
        return;
      }

      const event = req.body as {
        event?: string;
        data?: { reference?: string; amount?: number; channel?: string };
      };
      const reference = String(event?.data?.reference ?? '').trim();
      if (!reference) {
        res.status(400).json({ error: 'Missing transaction reference.' });
        return;
      }

      if (store.data.processedWebhookRefs.includes(reference)) {
        res.json({ ok: true, idempotent: true });
        return;
      }

      if (event.event === 'charge.success') {
        await finalizePaymentSuccess(store, reference, {
          channel: event.data?.channel || 'paystack_webhook',
          verifiedAmountGhs:
            typeof event.data?.amount === 'number'
              ? event.data.amount / 100
              : null,
        });
        store.data.processedWebhookRefs.push(reference);
        await store.persist();
      }

      res.json({ ok: true });
    } catch (err) {
      console.error('Paystack webhook error:', err);
      res.status(500).json({ error: 'Webhook processing error.' });
    }
  });

  // -------------------------------------------------------------------------
  // Tenant Context & Org Structure (Client Orgs, Locations, Departments)
  // -------------------------------------------------------------------------
  app.get('/api/auth/context', ...tenantGuard, (req: TenantRequest, res) => {
    const ctx = req.tenantCtx!;
    res.json({
      tenant: ctx.tenant,
      activeOrg: ctx.activeOrg,
      availableOrgs: ctx.availableOrgs,
      availableTenants: ctx.availableTenants,
      membership: ctx.membership,
      permissions: ctx.permissions,
      subscription: ctx.subscription,
      plan: ctx.plan,
      effectiveLimits: ctx.effectiveLimits,
      effectiveFeatures: ctx.effectiveFeatures,
      usage: ctx.usage,
      isReadOnlyGraceOrExpired: ctx.isReadOnlyGraceOrExpired,
      isAllOrgsView: ctx.isAllOrgsView,
      isSuperAdmin: ctx.isSuperAdmin,
    });
  });

  app.get(
    '/api/orgs',
    ...tenantGuard,
    requirePermission('org.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      res.json({
        organisations: ctx.availableOrgs,
        locations: store.data.locations.filter((l) => scopeMatch(l, req)),
        departments: store.data.departments.filter((d) => scopeMatch(d, req)),
      });
    }
  );

  app.post(
    '/api/orgs/client-organisations',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const tenantOrgs = store.data.clientOrganisations.filter(
        (o) => o.tenantId === ctx.tenant.id
      );
      const quota = checkQuotaExceeded(
        ctx.effectiveLimits.maxClientOrgs,
        tenantOrgs.length,
        'client organisations',
        ctx.plan.name
      );
      if (!quota.ok) {
        res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
        return;
      }

      const name = String(req.body?.name ?? '').trim();
      const code = String(req.body?.code ?? '').trim().toUpperCase();
      if (!name || !code) {
        res.status(400).json({ error: 'Organisation name and code are required.' });
        return;
      }
      if (tenantOrgs.some((o) => o.code.toUpperCase() === code)) {
        res.status(409).json({ error: `Organisation code "${code}" already exists.` });
        return;
      }

      const now = new Date().toISOString();
      const org: ClientOrganisation = {
        id: `org-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        name,
        code,
        industry: String(req.body?.industry ?? 'Enterprise IT').trim(),
        contactName: String(req.body?.contactName ?? '').trim(),
        contactEmail: String(req.body?.contactEmail ?? '').trim(),
        contactPhone: String(req.body?.contactPhone ?? '').trim(),
        address: String(req.body?.address ?? '').trim(),
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await store.mutate((s) => {
        s.clientOrganisations.push(org);
      });
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: org.id,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'ORG_CREATED',
        entityType: 'client_organisation',
        entityId: org.id,
        summary: `Created client organisation ${org.name} (${org.code})`,
      });
      res.status(201).json({ organisation: org });
    }
  );

  app.post(
    '/api/orgs/locations',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const tenantLocations = store.data.locations.filter(
        (l) => l.tenantId === ctx.tenant.id
      );
      const quota = checkQuotaExceeded(
        ctx.effectiveLimits.maxLocations,
        tenantLocations.length,
        'locations',
        ctx.plan.name
      );
      if (!quota.ok) {
        res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
        return;
      }
      const name = String(req.body?.name ?? '').trim();
      const code = String(req.body?.code ?? '').trim().toUpperCase();
      if (!name || !code) {
        res.status(400).json({ error: 'Location name and code are required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      if (!canAccessRecordOrg(ctx, ctx.tenant.id, orgId)) {
        res.status(403).json({ error: 'Access denied to target organisation.' });
        return;
      }
      const loc: LocationItem = {
        id: `loc-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        name,
        code,
        city: String(req.body?.city ?? '').trim(),
        country: String(req.body?.country ?? 'Ghana').trim(),
        address: String(req.body?.address ?? '').trim(),
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => {
        s.locations.push(loc);
      });
      res.status(201).json({ location: loc });
    }
  );

  app.post(
    '/api/orgs/departments',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const name = String(req.body?.name ?? '').trim();
      const code = String(req.body?.code ?? '').trim().toUpperCase();
      if (!name || !code) {
        res.status(400).json({ error: 'Department name and code are required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      if (!canAccessRecordOrg(ctx, ctx.tenant.id, orgId)) {
        res.status(403).json({ error: 'Access denied to target organisation.' });
        return;
      }
      const dept: DepartmentItem = {
        id: `dept-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        name,
        code,
        managerName: String(req.body?.managerName ?? '').trim(),
        costCenter: String(req.body?.costCenter ?? '').trim(),
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => {
        s.departments.push(dept);
      });
      res.status(201).json({ department: dept });
    }
  );

  app.delete(
    '/api/orgs/client-organisations/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const tenantOrgs = store.data.clientOrganisations.filter(
          (o) => o.tenantId === ctx.tenant.id
        );
        const target = tenantOrgs.find((o) => o.id === id);
        if (!target) {
          res.status(404).json({ error: 'Client organisation not found.' });
          return;
        }
        if (!canAccessRecordOrg(ctx, ctx.tenant.id, target.id)) {
          res.status(403).json({ error: 'Access denied to target organisation.' });
          return;
        }
        if (tenantOrgs.length <= 1) {
          res.status(400).json({
            error: 'Cannot delete the only client organisation in this workspace.',
          });
          return;
        }

        const [linkedAssets, linkedEmployees] = await Promise.all([
          db.listAssets({ tenantId: ctx.tenant.id, orgIds: [id] }),
          db.listEmployees({ tenantId: ctx.tenant.id, orgIds: [id] }),
        ]);
        const linkedTickets = store.data.tickets.filter(
          (t) => t.tenantId === ctx.tenant.id && t.orgId === id
        );
        const linkedContracts = store.data.contracts.filter(
          (c) => c.tenantId === ctx.tenant.id && c.orgId === id
        );
        const linkedLicences = store.data.softwareLicences.filter(
          (l) => l.tenantId === ctx.tenant.id && l.orgId === id
        );

        const blockers: string[] = [];
        if (linkedAssets.length > 0) blockers.push(`${linkedAssets.length} asset(s)`);
        if (linkedEmployees.length > 0)
          blockers.push(`${linkedEmployees.length} employee(s)`);
        if (linkedTickets.length > 0) blockers.push(`${linkedTickets.length} ticket(s)`);
        if (linkedContracts.length > 0)
          blockers.push(`${linkedContracts.length} contract(s)`);
        if (linkedLicences.length > 0)
          blockers.push(`${linkedLicences.length} software licence(s)`);

        if (blockers.length > 0) {
          res.status(409).json({
            error: `Cannot delete "${target.name}" while ${blockers.join(', ')} are linked to it. Reassign or remove them first.`,
          });
          return;
        }

        await store.mutate((s) => {
          s.clientOrganisations = s.clientOrganisations.filter(
            (o) => !(o.id === id && o.tenantId === ctx.tenant.id)
          );
          s.locations = s.locations.filter(
            (l) => !(l.orgId === id && l.tenantId === ctx.tenant.id)
          );
          s.departments = s.departments.filter(
            (d) => !(d.orgId === id && d.tenantId === ctx.tenant.id)
          );
          s.memberships.forEach((m) => {
            if (m.tenantId === ctx.tenant.id && Array.isArray(m.allowedOrgIds)) {
              m.allowedOrgIds = m.allowedOrgIds.filter((oid) => oid !== id);
            }
          });
          s.invitations.forEach((inv) => {
            if (inv.tenantId === ctx.tenant.id && Array.isArray(inv.allowedOrgIds)) {
              inv.allowedOrgIds = inv.allowedOrgIds.filter((oid) => oid !== id);
            }
          });
        });

        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ORG_DELETED',
          entityType: 'client_organisation',
          entityId: id,
          summary: `Deleted client organisation ${target.name} (${target.code})`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete client org error:', err);
        res.status(500).json({ error: 'Failed to delete client organisation.' });
      }
    }
  );

  app.delete(
    '/api/orgs/locations/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const target = store.data.locations.find(
          (l) => l.id === id && l.tenantId === ctx.tenant.id
        );
        if (!target) {
          res.status(404).json({ error: 'Site / location not found.' });
          return;
        }
        if (!canAccessRecordOrg(ctx, ctx.tenant.id, target.orgId)) {
          res.status(403).json({ error: 'Access denied to target site / location.' });
          return;
        }

        const [assets, employees] = await Promise.all([
          db.listAssets({ tenantId: ctx.tenant.id }),
          db.listEmployees({ tenantId: ctx.tenant.id }),
        ]);
        const targetNameLower = target.name.toLowerCase();
        const linkedAssets = assets.filter(
          (a) =>
            a.location_id === target.id ||
            (a.location || '').trim().toLowerCase() === targetNameLower
        );
        const linkedEmployees = employees.filter(
          (e) =>
            e.location_id === target.id ||
            (e.location || '').trim().toLowerCase() === targetNameLower
        );
        if (linkedAssets.length > 0 || linkedEmployees.length > 0) {
          const parts: string[] = [];
          if (linkedAssets.length > 0) parts.push(`${linkedAssets.length} asset(s)`);
          if (linkedEmployees.length > 0)
            parts.push(`${linkedEmployees.length} employee(s)`);
          res.status(409).json({
            error: `Cannot delete site "${target.name}" while ${parts.join(' and ')} reference it. Transfer or update them first.`,
          });
          return;
        }

        await store.mutate((s) => {
          s.locations = s.locations.filter(
            (l) => !(l.id === id && l.tenantId === ctx.tenant.id)
          );
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: target.orgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'LOCATION_DELETED',
          entityType: 'location',
          entityId: id,
          summary: `Deleted site / location ${target.name} (${target.code})`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete location error:', err);
        res.status(500).json({ error: 'Failed to delete site / location.' });
      }
    }
  );

  app.delete(
    '/api/orgs/departments/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const target = store.data.departments.find(
          (d) => d.id === id && d.tenantId === ctx.tenant.id
        );
        if (!target) {
          res.status(404).json({ error: 'Department not found.' });
          return;
        }
        if (!canAccessRecordOrg(ctx, ctx.tenant.id, target.orgId)) {
          res.status(403).json({ error: 'Access denied to target department.' });
          return;
        }

        const employees = await db.listEmployees({ tenantId: ctx.tenant.id });
        const targetNameLower = target.name.toLowerCase();
        const linkedEmployees = employees.filter(
          (e) =>
            e.department_id === target.id ||
            (e.department || '').trim().toLowerCase() === targetNameLower
        );
        if (linkedEmployees.length > 0) {
          res.status(409).json({
            error: `Cannot delete department "${target.name}" while ${linkedEmployees.length} employee(s) are assigned to it.`,
          });
          return;
        }

        await store.mutate((s) => {
          s.departments = s.departments.filter(
            (d) => !(d.id === id && d.tenantId === ctx.tenant.id)
          );
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: target.orgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'DEPARTMENT_DELETED',
          entityType: 'department',
          entityId: id,
          summary: `Deleted department ${target.name} (${target.code})`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete department error:', err);
        res.status(500).json({ error: 'Failed to delete department.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Helpdesk Ticketing + SLA + CSAT
  // -------------------------------------------------------------------------
  app.get(
    '/api/tickets',
    ...tenantGuard,
    requirePermission('tickets.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const orgMap = new Map(
        store.data.clientOrganisations.map((o) => [o.id, o.name])
      );
      const tickets = store.data.tickets
        .filter((t) => scopeMatch(t, req))
        .map((t) => {
          const check = evaluateTicketBreach(t);
          return {
            ...t,
            slaBreached: t.slaBreached || check.breached,
            orgName: orgMap.get(t.orgId) || 'Primary Org',
          };
        });
      // Employees only see their own tickets unless they have assign/resolve rights
      const canViewAll =
        ctx.permissions.includes('tickets.assign') ||
        ctx.permissions.includes('tickets.resolve');
      const filtered = canViewAll
        ? tickets
        : tickets.filter((t) => t.requesterId === req.authUser!.id);

      res.json({ tickets: filtered });
    }
  );

  app.get(
    '/api/tickets/:id',
    ...tenantGuard,
    requirePermission('tickets.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const ticket = store.data.tickets.find((t) => t.id === id);
      if (!ticket || !canAccessRecordOrg(ctx, ticket.tenantId, ticket.orgId)) {
        res.status(404).json({ error: 'Ticket not found.' });
        return;
      }
      const allowInternal = canViewInternalTicketNotes(ctx.permissions);
      const comments = store.data.ticketComments.filter(
        (c) => c.ticketId === ticket.id && (allowInternal || !c.isInternal)
      );
      res.json({ ticket, comments });
    }
  );

  app.post(
    '/api/tickets',
    ...tenantGuard,
    requirePermission('tickets.create'),
    requireWritableSubscription,
    requireFeature('helpdesk', 'IT Helpdesk Ticketing'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const quota = checkQuotaExceeded(
        ctx.effectiveLimits.maxTicketsPerMonth,
        ctx.usage.ticketsThisMonth,
        'monthly tickets',
        ctx.plan.name
      );
      if (!quota.ok) {
        res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
        return;
      }

      const subject = String(req.body?.subject ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      const category = (String(req.body?.category ?? 'General').trim() ||
        'General') as Ticket['category'];
      const priority = (String(req.body?.priority ?? 'Medium').trim() ||
        'Medium') as TicketPriority;
      const assetId = req.body?.assetId ? String(req.body.assetId).trim() : null;
      let assetTag: string | null = null;
      if (assetId) {
        const asset = await db.getAssetById(assetId);
        if (!asset || !canAccessRecordOrg(ctx, asset.tenant_id, asset.org_id)) {
          res.status(404).json({ error: 'Linked asset not found in your workspace.' });
          return;
        }
        assetTag = asset.asset_tag;
      }

      if (!subject || !description) {
        res.status(400).json({ error: 'Ticket subject and description are required.' });
        return;
      }

      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      if (!canAccessRecordOrg(ctx, ctx.tenant.id, orgId)) {
        res.status(403).json({ error: 'Access denied to target organisation.' });
        return;
      }

      const now = new Date().toISOString();
      const slaTargets = calculateTicketSlaTargets({
        priority,
        createdAt: now,
        policies: store.data.slaPolicies.filter((p) => p.tenantId === ctx.tenant.id),
        orgId,
      });

      const seq =
        store.data.tickets.filter((t) => t.tenantId === ctx.tenant.id).length + 1;
      const ticket: Ticket = {
        id: `tkt-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        ticketNumber: `TKT-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
        subject,
        description,
        category,
        priority,
        status: 'Open',
        requesterId: req.authUser!.id,
        requesterName: req.authUser!.name,
        requesterEmail: req.authUser!.email,
        assigneeId: null,
        assigneeName: null,
        assetId,
        assetTag,
        slaPolicyId: slaTargets.slaPolicyId,
        firstResponseDueAt: slaTargets.firstResponseDueAt,
        firstRespondedAt: null,
        resolutionDueAt: slaTargets.resolutionDueAt,
        resolvedAt: null,
        slaBreached: false,
        escalationLevel: 0,
        csatRating: null,
        csatFeedback: null,
        createdAt: now,
        updatedAt: now,
      };

      await store.mutate((s) => {
        s.tickets.unshift(ticket);
      });
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'TICKET_CREATED',
        entityType: 'ticket',
        entityId: ticket.id,
        summary: `Opened ticket ${ticket.ticketNumber}: ${ticket.subject}`,
      });
      void dispatchWebhookEvent(store, ctx.tenant.id, 'ticket.created', {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        priority: ticket.priority,
        requesterEmail: ticket.requesterEmail,
      });
      res.status(201).json({ ticket });
    }
  );

  app.put(
    '/api/tickets/:id',
    ...tenantGuard,
    requirePermission('tickets.read'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const ticket = store.data.tickets.find((t) => t.id === id);
      if (!ticket || !canAccessRecordOrg(ctx, ticket.tenantId, ticket.orgId)) {
        res.status(404).json({ error: 'Ticket not found.' });
        return;
      }

      const body = req.body ?? {};
      const now = new Date().toISOString();

      // CSAT rating by requester or admin
      if (body.csatRating !== undefined) {
        const rating = Number(body.csatRating);
        if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
          res.status(400).json({ error: 'CSAT rating must be between 1 and 5.' });
          return;
        }
        ticket.csatRating = rating;
        ticket.csatFeedback = String(body.csatFeedback ?? '').trim();
        ticket.updatedAt = now;
        await store.persist();
        res.json({ ticket });
        return;
      }

      if (
        !ctx.permissions.includes('tickets.assign') &&
        !ctx.permissions.includes('tickets.resolve')
      ) {
        res.status(403).json({
          error: 'Technician or Manager permissions required to update ticket workflow.',
        });
        return;
      }

      if (body.status) {
        const nextStatus = String(body.status) as TicketStatus;
        ticket.status = nextStatus;
        if (!ticket.firstRespondedAt && nextStatus !== 'Open') {
          ticket.firstRespondedAt = now;
        }
        if (nextStatus === 'Resolved' || nextStatus === 'Closed') {
          ticket.resolvedAt = ticket.resolvedAt || now;
        }
        if (nextStatus === 'Escalated') {
          ticket.escalationLevel = Math.max(1, ticket.escalationLevel + 1);
        }
      }
      if (body.priority) {
        ticket.priority = String(body.priority) as TicketPriority;
      }
      if (body.assigneeId !== undefined) {
        const assigneeId = body.assigneeId ? String(body.assigneeId) : null;
        if (assigneeId) {
          const assignee = await db.findUserById(assigneeId);
          ticket.assigneeId = assigneeId;
          ticket.assigneeName = assignee?.name || 'Technician';
        } else {
          ticket.assigneeId = null;
          ticket.assigneeName = null;
        }
      }
      ticket.updatedAt = now;
      await store.persist();
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: ticket.orgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'TICKET_UPDATED',
        entityType: 'ticket',
        entityId: ticket.id,
        summary: `Updated ticket ${ticket.ticketNumber} (${ticket.status})`,
      });
      res.json({ ticket });
    }
  );

  app.post(
    '/api/tickets/:id/comments',
    ...tenantGuard,
    requirePermission('tickets.read'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const ticket = store.data.tickets.find((t) => t.id === id);
      if (!ticket || !canAccessRecordOrg(ctx, ticket.tenantId, ticket.orgId)) {
        res.status(404).json({ error: 'Ticket not found.' });
        return;
      }
      const isInternal = Boolean(req.body?.isInternal);
      if (isInternal && !canViewInternalTicketNotes(ctx.permissions)) {
        res.status(403).json({ error: 'Internal technician notes require staff permission.' });
        return;
      }
      const text = String(req.body?.body ?? '').trim();
      if (!text) {
        res.status(400).json({ error: 'Comment text is required.' });
        return;
      }
      const now = new Date().toISOString();
      const comment: TicketComment = {
        id: `cmt-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: ticket.orgId,
        ticketId: ticket.id,
        authorId: req.authUser!.id,
        authorName: req.authUser!.name,
        isInternal,
        body: text,
        createdAt: now,
      };
      await store.mutate((s) => {
        s.ticketComments.push(comment);
        if (!isInternal && !ticket.firstRespondedAt && req.authUser!.id !== ticket.requesterId) {
          ticket.firstRespondedAt = now;
        }
        ticket.updatedAt = now;
      });
      res.status(201).json({ comment });
    }
  );

  // -------------------------------------------------------------------------
  // ITSM Suite (Incidents, Problems, Changes, Service Catalogue & Requests)
  // -------------------------------------------------------------------------
  app.get(
    '/api/itsm',
    ...tenantGuard,
    requirePermission('itsm.read'),
    (req: TenantRequest, res) => {
      res.json({
        incidents: store.data.incidents.filter((i) => scopeMatch(i, req)),
        problems: store.data.problems.filter((p) => scopeMatch(p, req)),
        changes: store.data.changes.filter((c) => scopeMatch(c, req)),
        catalogue: store.data.serviceCatalogue.filter((c) => scopeMatch(c, req)),
        serviceRequests: store.data.serviceRequests.filter((r) => scopeMatch(r, req)),
      });
    }
  );

  app.post(
    '/api/itsm/incidents',
    ...tenantGuard,
    requirePermission('itsm.manage'),
    requireWritableSubscription,
    requireFeature('itsm_suite', 'ITSM Suite'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const title = String(req.body?.title ?? '').trim();
      const description = String(req.body?.description ?? '').trim();
      if (!title) {
        res.status(400).json({ error: 'Incident title is required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      if (!canAccessRecordOrg(ctx, ctx.tenant.id, orgId)) {
        res.status(403).json({ error: 'Access denied to target organisation.' });
        return;
      }
      const seq =
        store.data.incidents.filter((i) => i.tenantId === ctx.tenant.id).length + 1;
      const incident: Incident = {
        id: `inc-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        incidentNumber: `INC-${String(seq).padStart(4, '0')}`,
        title,
        description,
        impact: (req.body?.impact || 'Medium') as Incident['impact'],
        urgency: (req.body?.urgency || 'Medium') as Incident['urgency'],
        severity: (req.body?.severity || 'SEV-3') as Incident['severity'],
        status: 'Detected',
        affectedAssetIds: Array.isArray(req.body?.affectedAssetIds)
          ? req.body.affectedAssetIds
          : [],
        linkedProblemId: null,
        commanderName: String(req.body?.commanderName || req.authUser!.name),
        rootCauseSummary: '',
        createdAt: new Date().toISOString(),
        resolvedAt: null,
      };
      await store.mutate((s) => s.incidents.unshift(incident));
      res.status(201).json({ incident });
    }
  );

  app.put(
    '/api/itsm/incidents/:id',
    ...tenantGuard,
    requirePermission('itsm.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const inc = store.data.incidents.find((i) => i.id === req.params.id);
      if (!inc || !canAccessRecordOrg(ctx, inc.tenantId, inc.orgId)) {
        res.status(404).json({ error: 'Incident not found.' });
        return;
      }
      if (req.body?.status) inc.status = req.body.status;
      if (req.body?.rootCauseSummary !== undefined) {
        inc.rootCauseSummary = String(req.body.rootCauseSummary);
      }
      if (inc.status === 'Resolved' && !inc.resolvedAt) {
        inc.resolvedAt = new Date().toISOString();
      }
      await store.persist();
      res.json({ incident: inc });
    }
  );

  app.post(
    '/api/itsm/problems',
    ...tenantGuard,
    requirePermission('itsm.manage'),
    requireWritableSubscription,
    requireFeature('itsm_suite', 'ITSM Suite'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: 'Problem title is required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      const seq =
        store.data.problems.filter((p) => p.tenantId === ctx.tenant.id).length + 1;
      const problem: ProblemRecord = {
        id: `prb-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        problemNumber: `PRB-${String(seq).padStart(4, '0')}`,
        title,
        symptomSummary: String(req.body?.symptomSummary ?? '').trim(),
        rootCause: String(req.body?.rootCause ?? '').trim(),
        workaround: String(req.body?.workaround ?? '').trim(),
        knownError: Boolean(req.body?.knownError),
        status: (req.body?.status || 'Open') as ProblemRecord['status'],
        linkedIncidentIds: Array.isArray(req.body?.linkedIncidentIds)
          ? req.body.linkedIncidentIds
          : [],
        ownerName: req.authUser!.name,
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.problems.unshift(problem));
      res.status(201).json({ problem });
    }
  );

  app.post(
    '/api/itsm/changes',
    ...tenantGuard,
    requirePermission('itsm.manage'),
    requireWritableSubscription,
    requireFeature('itsm_suite', 'ITSM Suite'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: 'Change title is required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      const seq =
        store.data.changes.filter((c) => c.tenantId === ctx.tenant.id).length + 1;
      const change: ChangeRequest = {
        id: `chg-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        changeNumber: `CHG-${String(seq).padStart(4, '0')}`,
        title,
        changeType: (req.body?.changeType || 'Normal') as ChangeRequest['changeType'],
        riskLevel: (req.body?.riskLevel || 'Medium') as ChangeRequest['riskLevel'],
        implementationPlan: String(req.body?.implementationPlan ?? '').trim(),
        rollbackPlan: String(req.body?.rollbackPlan ?? '').trim(),
        scheduledStart: String(req.body?.scheduledStart ?? new Date().toISOString()),
        scheduledEnd: String(req.body?.scheduledEnd ?? new Date().toISOString()),
        status: 'Pending CAB Approval',
        requestedByName: req.authUser!.name,
        approvedByName: null,
        linkedAssetIds: Array.isArray(req.body?.linkedAssetIds)
          ? req.body.linkedAssetIds
          : [],
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.changes.unshift(change));
      res.status(201).json({ change });
    }
  );

  app.post(
    '/api/itsm/changes/:id/approve',
    ...tenantGuard,
    requirePermission('itsm.approve'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const change = store.data.changes.find((c) => c.id === req.params.id);
      if (!change || !canAccessRecordOrg(ctx, change.tenantId, change.orgId)) {
        res.status(404).json({ error: 'Change request not found.' });
        return;
      }
      const decision = req.body?.decision === 'Rejected' ? 'Rejected' : 'Approved';
      change.status = decision;
      change.approvedByName = req.authUser!.name;
      await store.persist();
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: change.orgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: `CHANGE_${decision.toUpperCase()}`,
        entityType: 'change_request',
        entityId: change.id,
        summary: `${decision} CAB change ${change.changeNumber}: ${change.title}`,
      });
      res.json({ change });
    }
  );

  app.post(
    '/api/itsm/service-requests',
    ...tenantGuard,
    requirePermission('tickets.create'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const catalogueItemId = String(req.body?.catalogueItemId ?? '').trim();
      const item = store.data.serviceCatalogue.find(
        (c) => c.id === catalogueItemId && c.tenantId === ctx.tenant.id
      );
      if (!item) {
        res.status(404).json({ error: 'Service catalogue item not found.' });
        return;
      }
      const seq =
        store.data.serviceRequests.filter((r) => r.tenantId === ctx.tenant.id).length + 1;
      const sr: ServiceRequest = {
        id: `sr-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: item.orgId,
        requestNumber: `SR-${String(seq).padStart(4, '0')}`,
        catalogueItemId: item.id,
        itemName: item.name,
        requesterId: req.authUser!.id,
        requesterName: req.authUser!.name,
        justification: String(req.body?.justification ?? '').trim(),
        status: item.requiresApproval ? 'Pending Approval' : 'Approved',
        approvedByName: null,
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.serviceRequests.unshift(sr));
      res.status(201).json({ serviceRequest: sr });
    }
  );

  app.post(
    '/api/itsm/service-requests/:id/approve',
    ...tenantGuard,
    requirePermission('itsm.approve'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const sr = store.data.serviceRequests.find((r) => r.id === req.params.id);
      if (!sr || !canAccessRecordOrg(ctx, sr.tenantId, sr.orgId)) {
        res.status(404).json({ error: 'Service request not found.' });
        return;
      }
      const status =
        req.body?.status === 'Rejected' || req.body?.status === 'Fulfilled'
          ? req.body.status
          : 'Approved';
      sr.status = status;
      sr.approvedByName = req.authUser!.name;
      await store.persist();
      res.json({ serviceRequest: sr });
    }
  );

  // -------------------------------------------------------------------------
  // SLA Policies & Service Contracts
  // -------------------------------------------------------------------------
  app.get(
    '/api/sla-policies',
    ...tenantGuard,
    requirePermission('sla.read'),
    (req: TenantRequest, res) => {
      res.json({
        policies: store.data.slaPolicies.filter((p) => scopeMatch(p, req)),
      });
    }
  );

  app.post(
    '/api/sla-policies',
    ...tenantGuard,
    requirePermission('sla.manage'),
    requireWritableSubscription,
    requireFeature('sla_automation', 'SLA Policy Automation'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const name = String(req.body?.name ?? '').trim();
      const priority = String(req.body?.priority ?? 'Medium') as TicketPriority;
      const firstResponseMinutes = Number(req.body?.firstResponseMinutes ?? 60);
      const resolutionMinutes = Number(req.body?.resolutionMinutes ?? 480);
      if (!name || firstResponseMinutes <= 0 || resolutionMinutes <= 0) {
        res.status(400).json({ error: 'Valid policy name and SLA durations are required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      const policy: SlaPolicy = {
        id: `sla-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        name,
        priority,
        firstResponseMinutes,
        resolutionMinutes,
        businessHoursOnly: Boolean(req.body?.businessHoursOnly),
        escalationMinutesBeforeBreach: Number(
          req.body?.escalationMinutesBeforeBreach ?? 30
        ),
        isDefault: Boolean(req.body?.isDefault),
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.slaPolicies.push(policy));
      res.status(201).json({ policy });
    }
  );

  app.get(
    '/api/contracts',
    ...tenantGuard,
    requirePermission('contracts.read'),
    (req: TenantRequest, res) => {
      res.json({
        contracts: store.data.contracts.filter((c) => scopeMatch(c, req)),
      });
    }
  );

  app.post(
    '/api/contracts',
    ...tenantGuard,
    requirePermission('contracts.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: 'Contract title is required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      const seq =
        store.data.contracts.filter((c) => c.tenantId === ctx.tenant.id).length + 1;
      const contract: ServiceContract = {
        id: `ctr-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        contractNumber: `CTR-${String(seq).padStart(4, '0')}`,
        title,
        clientOrgName: String(req.body?.clientOrgName || ctx.activeOrg.name),
        vendorOrProvider: String(req.body?.vendorOrProvider || ctx.tenant.name),
        contractType: (req.body?.contractType || 'MSP Retainer') as ServiceContract['contractType'],
        startDate: String(req.body?.startDate || new Date().toISOString().slice(0, 10)),
        endDate: String(req.body?.endDate || new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)),
        annualValueGhs: Number(req.body?.annualValueGhs ?? 0),
        autoRenew: Boolean(req.body?.autoRenew),
        status: 'Active',
        notes: String(req.body?.notes ?? '').trim(),
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.contracts.unshift(contract));
      res.status(201).json({ contract });
    }
  );

  // -------------------------------------------------------------------------
  // Software Licences (Key Masking Enforcement)
  // -------------------------------------------------------------------------
  app.get(
    '/api/licences',
    ...tenantGuard,
    requirePermission('licences.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const canViewKeys = ctx.permissions.includes('licences.view_keys');
      const licences = store.data.softwareLicences
        .filter((l) => scopeMatch(l, req))
        .map((l) => ({
          ...l,
          licenceKey: canViewKeys ? l.licenceKey : maskLicenceKey(l.licenceKey),
          maskedKey: maskLicenceKey(l.licenceKey),
        }));
      res.json({ licences, canViewKeys });
    }
  );

  app.post(
    '/api/licences',
    ...tenantGuard,
    requirePermission('licences.manage'),
    requireWritableSubscription,
    requireFeature('software_licences', 'Software & Licence Management'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const softwareName = String(req.body?.softwareName ?? '').trim();
      const vendor = String(req.body?.vendor ?? '').trim();
      if (!softwareName || !vendor) {
        res.status(400).json({ error: 'Software name and vendor are required.' });
        return;
      }
      const orgId = String(req.body?.orgId || ctx.targetOrgId);
      if (!canAccessRecordOrg(ctx, ctx.tenant.id, orgId)) {
        res.status(403).json({ error: 'Access denied to target organisation.' });
        return;
      }
      const licence: SoftwareLicence = {
        id: `lic-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId,
        softwareName,
        vendor,
        licenceType: (req.body?.licenceType || 'Per Seat') as SoftwareLicence['licenceType'],
        licenceKey: String(req.body?.licenceKey ?? '').trim() || 'UNSPECIFIED',
        totalSeats: Math.max(1, Number(req.body?.totalSeats ?? 1)),
        assignedSeats: Math.max(0, Number(req.body?.assignedSeats ?? 0)),
        assignedEmployeeIds: Array.isArray(req.body?.assignedEmployeeIds)
          ? req.body.assignedEmployeeIds
          : [],
        costPerYearGhs: Math.max(0, Number(req.body?.costPerYearGhs ?? 0)),
        purchaseDate: String(
          req.body?.purchaseDate || new Date().toISOString().slice(0, 10)
        ),
        expiryDate: String(
          req.body?.expiryDate ||
            new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)
        ),
        autoRenew: Boolean(req.body?.autoRenew),
        status: 'Active',
        notes: String(req.body?.notes ?? '').trim(),
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.softwareLicences.unshift(licence));
      res.status(201).json({ licence });
    }
  );

  // -------------------------------------------------------------------------
  // Procurement (Vendors, Purchase Requests, Purchase Orders, Receive -> Assets)
  // -------------------------------------------------------------------------
  app.get(
    '/api/procurement',
    ...tenantGuard,
    requirePermission('procurement.read'),
    (req: TenantRequest, res) => {
      res.json({
        vendors: store.data.vendors.filter((v) => scopeMatch(v, req)),
        purchaseRequests: store.data.purchaseRequests.filter((p) =>
          scopeMatch(p, req)
        ),
        purchaseOrders: store.data.purchaseOrders.filter((p) =>
          scopeMatch(p, req)
        ),
      });
    }
  );

  app.post(
    '/api/procurement/vendors',
    ...tenantGuard,
    requirePermission('procurement.create'),
    requireWritableSubscription,
    requireFeature('procurement', 'Vendors & Procurement'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const name = String(req.body?.name ?? '').trim();
      if (!name) {
        res.status(400).json({ error: 'Vendor name is required.' });
        return;
      }
      const vendor: Vendor = {
        id: `vnd-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: String(req.body?.orgId || ctx.targetOrgId),
        name,
        category: String(req.body?.category ?? 'Hardware').trim(),
        contactName: String(req.body?.contactName ?? '').trim(),
        email: String(req.body?.email ?? '').trim(),
        phone: String(req.body?.phone ?? '').trim(),
        website: String(req.body?.website ?? '').trim(),
        paymentTerms: String(req.body?.paymentTerms ?? 'Net 30').trim(),
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.vendors.unshift(vendor));
      res.status(201).json({ vendor });
    }
  );

  app.post(
    '/api/procurement/purchase-requests',
    ...tenantGuard,
    requirePermission('procurement.create'),
    requireWritableSubscription,
    requireFeature('procurement', 'Vendors & Procurement'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const title = String(req.body?.title ?? '').trim();
      if (!title) {
        res.status(400).json({ error: 'Purchase request title is required.' });
        return;
      }
      const seq =
        store.data.purchaseRequests.filter((p) => p.tenantId === ctx.tenant.id)
          .length + 1;
      const pr: PurchaseRequest = {
        id: `pr-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: String(req.body?.orgId || ctx.targetOrgId),
        requestNumber: `PR-${String(seq).padStart(4, '0')}`,
        title,
        category: String(req.body?.category ?? 'Laptops').trim(),
        quantity: Math.max(1, Number(req.body?.quantity ?? 1)),
        estimatedCostGhs: Math.max(0, Number(req.body?.estimatedCostGhs ?? 0)),
        justification: String(req.body?.justification ?? '').trim(),
        requestedByUserId: req.authUser!.id,
        requestedByName: req.authUser!.name,
        status: 'Pending Approval',
        approvedByUserId: null,
        approvedAt: null,
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.purchaseRequests.unshift(pr));
      res.status(201).json({ purchaseRequest: pr });
    }
  );

  app.post(
    '/api/procurement/purchase-requests/:id/approve',
    ...tenantGuard,
    requirePermission('procurement.approve'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const pr = store.data.purchaseRequests.find((p) => p.id === req.params.id);
      if (!pr || !canAccessRecordOrg(ctx, pr.tenantId, pr.orgId)) {
        res.status(404).json({ error: 'Purchase request not found.' });
        return;
      }
      pr.status = req.body?.decision === 'Rejected' ? 'Rejected' : 'Approved';
      pr.approvedByUserId = req.authUser!.id;
      pr.approvedAt = new Date().toISOString();
      await store.persist();
      res.json({ purchaseRequest: pr });
    }
  );

  app.post(
    '/api/procurement/purchase-orders',
    ...tenantGuard,
    requirePermission('procurement.approve'),
    requireWritableSubscription,
    requireFeature('procurement', 'Vendors & Procurement'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const vendorId = String(req.body?.vendorId ?? '').trim();
      const vendor = store.data.vendors.find(
        (v) => v.id === vendorId && v.tenantId === ctx.tenant.id
      );
      if (!vendor) {
        res.status(404).json({ error: 'Vendor not found.' });
        return;
      }
      const itemName = String(req.body?.itemName ?? '').trim();
      const quantity = Math.max(1, Number(req.body?.quantity ?? 1));
      const unitCostGhs = Math.max(0, Number(req.body?.unitCostGhs ?? 0));
      if (!itemName) {
        res.status(400).json({ error: 'Item name is required.' });
        return;
      }
      const seq =
        store.data.purchaseOrders.filter((p) => p.tenantId === ctx.tenant.id)
          .length + 1;
      const po: PurchaseOrder = {
        id: `po-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: vendor.orgId,
        poNumber: `PO-${String(seq).padStart(4, '0')}`,
        prId: req.body?.prId ? String(req.body.prId) : null,
        vendorId: vendor.id,
        vendorName: vendor.name,
        itemName,
        category: String(req.body?.category ?? 'Laptops').trim(),
        brand: String(req.body?.brand ?? 'Dell').trim(),
        model: String(req.body?.model ?? 'Enterprise').trim(),
        quantity,
        unitCostGhs,
        totalCostGhs: quantity * unitCostGhs,
        expectedDeliveryDate: String(
          req.body?.expectedDeliveryDate ||
            new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10)
        ),
        status: 'Issued',
        receivedAssetIds: [],
        createdBy: req.authUser!.id,
        createdAt: new Date().toISOString(),
      };
      if (po.prId) {
        const pr = store.data.purchaseRequests.find((p) => p.id === po.prId);
        if (pr) pr.status = 'Ordered';
      }
      await store.mutate((s) => s.purchaseOrders.unshift(po));
      res.status(201).json({ purchaseOrder: po });
    }
  );

  app.post(
    '/api/procurement/purchase-orders/:id/receive',
    ...tenantGuard,
    requirePermission('assets.create'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const po = store.data.purchaseOrders.find((p) => p.id === req.params.id);
      if (!po || !canAccessRecordOrg(ctx, po.tenantId, po.orgId)) {
        res.status(404).json({ error: 'Purchase order not found.' });
        return;
      }
      if (po.status === 'Received') {
        res.status(400).json({ error: 'Purchase order has already been received.' });
        return;
      }

      const quota = checkQuotaExceeded(
        ctx.effectiveLimits.maxAssets,
        ctx.usage.assetsCount + po.quantity - 1,
        'assets',
        ctx.plan.name
      );
      if (!quota.ok) {
        res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
        return;
      }

      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const warrantyEnd = new Date(Date.now() + 365 * 3 * 86400_000)
        .toISOString()
        .slice(0, 10);
      const createdAssets: Asset[] = [];

      for (let i = 0; i < po.quantity; i += 1) {
        const rand = crypto.randomUUID().slice(0, 6).toUpperCase();
        const assetTag = `AV-${po.poNumber}-${i + 1}-${rand.slice(0, 3)}`;
        const asset: Asset = {
          id: `ast-${crypto.randomUUID().slice(0, 8)}`,
          asset_tag: assetTag,
          name: po.itemName,
          category: (po.category || 'Laptops') as AssetCategory,
          brand: po.brand,
          model: po.model,
          serial_number: `SN-${rand}-${i + 1}`,
          purchase_date: today,
          cost: po.unitCostGhs,
          warranty_expiry: warrantyEnd,
          status: 'Available',
          assigned_employee_id: null,
          assigned_date: null,
          location: 'Receiving Vault',
          notes: `Received via ${po.poNumber} from ${po.vendorName}`,
          created_at: now,
          updated_at: now,
          tenant_id: ctx.tenant.id,
          org_id: po.orgId,
        };
        const created = await db.createAsset(asset);
        createdAssets.push(created);
        po.receivedAssetIds.push(created.id);
      }

      po.status = 'Received';
      await store.persist();
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: po.orgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'PO_RECEIVED',
        entityType: 'purchase_order',
        entityId: po.id,
        summary: `Received ${po.quantity} assets from ${po.poNumber}`,
      });
      void dispatchWebhookEvent(store, ctx.tenant.id, 'po.received', {
        poId: po.id,
        poNumber: po.poNumber,
        vendorName: po.vendorName,
        receivedCount: createdAssets.length,
      });
      res.json({ purchaseOrder: po, createdAssets });
    }
  );

  // -------------------------------------------------------------------------
  // Knowledge Base, Audit Logs & Scheduled Compliance Jobs
  // -------------------------------------------------------------------------
  app.get(
    '/api/kb',
    ...tenantGuard,
    requirePermission('kb.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const canSeeInternal = ctx.permissions.includes('kb.manage') || ctx.permissions.includes('tickets.internal_notes');
      const articles = store.data.knowledgeArticles.filter(
        (a) =>
          scopeMatch(a, req) &&
          (canSeeInternal || a.visibility === 'public_portal')
      );
      res.json({ articles });
    }
  );

  app.post(
    '/api/kb',
    ...tenantGuard,
    requirePermission('kb.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const title = String(req.body?.title ?? '').trim();
      const content = String(req.body?.content ?? '').trim();
      if (!title || !content) {
        res.status(400).json({ error: 'Article title and content are required.' });
        return;
      }
      const article: KnowledgeArticle = {
        id: `kb-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: ctx.targetOrgId,
        title,
        category: String(req.body?.category ?? 'Guides').trim(),
        visibility:
          req.body?.visibility === 'internal_it' ? 'internal_it' : 'public_portal',
        summary: String(req.body?.summary ?? content.slice(0, 140)).trim(),
        content,
        tags: Array.isArray(req.body?.tags) ? req.body.tags : [],
        helpfulCount: 0,
        authorName: req.authUser!.name,
        updatedAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.knowledgeArticles.unshift(article));
      res.status(201).json({ article });
    }
  );

  app.get(
    '/api/audit-logs',
    ...tenantGuard,
    requirePermission('audit.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const logs = store.data.auditLogs.filter(
        (l) =>
          l.tenantId === ctx.tenant.id &&
          (!ctx.scopeFilter.orgIds || ctx.scopeFilter.orgIds.includes(l.orgId))
      );
      res.json({ auditLogs: logs.slice(0, 300) });
    }
  );

  // Scheduled compliance & SLA sweep endpoint (idempotent, protected by auth or cron secret)
  app.post('/api/jobs/run', async (req, res) => {
    const cronSecret = process.env.CRON_SECRET?.trim();
    const headerSecret = req.headers['x-cron-secret'];
    const hasCronSecret = Boolean(cronSecret && headerSecret === cronSecret);

    if (!hasCronSecret) {
      // Fall back to authenticated user check
      await new Promise<void>((resolve) => {
        requireAuth(req, res, () => resolve());
      });
      if (res.headersSent) return;
    }

    const result = await runScheduledComplianceSweep(store, db, {
      forceReports: Boolean(req.body?.forceReports),
    });
    res.json({ ok: true, ...result });
  });

  // -------------------------------------------------------------------------
  // Tenant Subscription & Paystack Billing Routes
  // -------------------------------------------------------------------------
  app.get(
    '/api/billing/subscription',
    ...tenantGuard,
    requirePermission('billing.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      res.json({
        subscription: ctx.subscription,
        plan: ctx.plan,
        plans: store.data.plans.filter((p) => p.isPublic),
        payments: store.data.payments.filter((p) => p.tenantId === ctx.tenant.id),
        invoices: store.data.invoices.filter((i) => i.tenantId === ctx.tenant.id),
        paystackConfigured: store.data.platformSettings.paystackConfigured,
      });
    }
  );

  app.post(
    '/api/billing/subscribe/initialize',
    ...tenantGuard,
    requirePermission('billing.manage'),
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const planCode = String(req.body?.planCode ?? 'professional') as PlanCode;
        const billingCycle = (
          req.body?.billingCycle === 'annual' ? 'annual' : 'monthly'
        ) as BillingCycle;

        const plan = store.data.plans.find((p) => p.code === planCode);
        if (!plan) {
          res.status(400).json({ error: 'Invalid subscription plan selected.' });
          return;
        }

        const amountGhs =
          billingCycle === 'annual' ? plan.annualPriceGhs : plan.monthlyPriceGhs;
        const reference = `AV-PAY-${crypto.randomUUID().slice(0, 10).toUpperCase()}`;

        const payment: PaymentTransaction = {
          id: `pay-${crypto.randomUUID().slice(0, 8)}`,
          tenantId: ctx.tenant.id,
          subscriptionId: ctx.subscription.id,
          reference,
          provider: 'paystack',
          planCode,
          billingCycle,
          amountGhs,
          currency: 'GHS',
          status: 'pending',
          paidAt: null,
          createdBy: req.authUser!.id,
          createdAt: new Date().toISOString(),
        };

        await store.mutate((s) => s.payments.unshift(payment));

        const callbackUrl = `${req.protocol}://${req.get('host')}/?paystack_ref=${reference}`;
        const initRes = await initializePaystackPayment({
          email: req.authUser!.email,
          amountGhs,
          reference,
          callbackUrl,
          tenantId: ctx.tenant.id,
          planCode,
          billingCycle,
        });

        res.json({
          payment,
          mode: initRes.mode,
          authorizationUrl: initRes.authorizationUrl,
          reference: initRes.reference,
        });
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? err.message
              : 'Failed to initialize Paystack checkout.',
        });
      }
    }
  );

  app.post(
    '/api/billing/subscribe/verify',
    ...tenantGuard,
    requirePermission('billing.manage'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const reference = String(req.body?.reference ?? '').trim();
      if (!reference) {
        res.status(400).json({ error: 'Payment reference is required.' });
        return;
      }

      const payment = store.data.payments.find(
        (p) => p.reference === reference && p.tenantId === ctx.tenant.id
      );
      if (!payment) {
        res.status(404).json({ error: 'Payment transaction not found.' });
        return;
      }

      const verification = await verifyPaystackTransaction(reference);
      if (!verification.verified) {
        payment.status = 'failed';
        await store.persist();
        res.status(400).json({ error: 'Paystack verification failed or incomplete.' });
        return;
      }

      const result = await finalizePaymentSuccess(store, reference, {
        channel: verification.channel,
        verifiedAmountGhs: verification.amountGhs,
      });

      res.json({
        ok: true,
        mode: verification.mode,
        payment: result.payment,
        subscription: result.subscription,
        invoice: result.invoice,
      });
    }
  );

  // -------------------------------------------------------------------------
  // Platform Super Admin Routes (/api/platform/*)
  // -------------------------------------------------------------------------
  app.get(
    '/api/platform/overview',
    requireAuth,
    requirePlatformSuperAdmin,
    async (_req, res) => {
      const state = store.data;
      const allAssets = await db.listAssets();
      const allUsers = await db.listUsers();

      const activeSubs = state.subscriptions.filter(
        (s) => s.status === 'active' || s.status === 'trialing'
      );
      const mrrGhs = activeSubs.reduce((sum, s) => {
        if (s.status !== 'active') return sum;
        const plan = state.plans.find((p) => p.code === s.planCode);
        const monthlyEq =
          s.billingCycle === 'annual'
            ? (plan?.annualPriceGhs ?? s.amountGhs) / 12
            : plan?.monthlyPriceGhs ?? s.amountGhs;
        return sum + monthlyEq;
      }, 0);

      const totalRevenueGhs = state.payments
        .filter((p) => p.status === 'success')
        .reduce((sum, p) => sum + p.amountGhs, 0);

      const tenantsSummary = state.tenants.map((t) => {
        const sub = state.subscriptions.find((s) => s.tenantId === t.id);
        const orgCount = state.clientOrganisations.filter(
          (o) => o.tenantId === t.id
        ).length;
        const userCount = state.memberships.filter(
          (m) => m.tenantId === t.id && m.status === 'active'
        ).length;
        const assetCount = allAssets.filter(
          (a) => (a.tenant_id || 'ten-default-01') === t.id
        ).length;
        return {
          tenant: t,
          subscription: sub || null,
          orgCount,
          userCount,
          assetCount,
        };
      });

      res.json({
        kpis: {
          totalTenants: state.tenants.length,
          companyTenants: state.tenants.filter((t) => t.type === 'company').length,
          mspTenants: state.tenants.filter((t) => t.type === 'msp').length,
          activeSubscriptions: state.subscriptions.filter(
            (s) => s.status === 'active'
          ).length,
          trialTenants: state.subscriptions.filter((s) => s.status === 'trialing')
            .length,
          totalUsers: allUsers.length,
          totalAssets: allAssets.length,
          mrrGhs: Math.round(mrrGhs),
          arrGhs: Math.round(mrrGhs * 12),
          totalRevenueGhs,
        },
        tenants: tenantsSummary,
        plans: state.plans,
        payments: state.payments,
        settings: state.platformSettings,
        platformAuditLogs: state.platformAuditLogs.slice(0, 150),
      });
    }
  );

  app.post(
    '/api/platform/tenants',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const companyName = String(body.companyName ?? '').trim();
        const tenantType: TenantType = body.tenantType === 'msp' ? 'msp' : 'company';
        const ownerEmail = String(body.ownerEmail ?? '').trim().toLowerCase();
        const ownerName = String(body.ownerName ?? '').trim();
        const ownerPassword = String(body.ownerPassword ?? '');
        const country = String(body.country ?? 'Ghana').trim() || 'Ghana';
        const industry = String(body.industry ?? 'Enterprise IT').trim() || 'Enterprise IT';

        const validPlans: PlanCode[] = [
          'starter',
          'professional',
          'business',
          'enterprise',
        ];
        const requestedPlan = String(body.planCode ?? 'professional') as PlanCode;
        const planCode: PlanCode = validPlans.includes(requestedPlan)
          ? requestedPlan
          : 'professional';

        const billingCycle: BillingCycle =
          body.billingCycle === 'annual' ? 'annual' : 'monthly';
        const subscriptionStatus: TenantSubscription['status'] =
          body.subscriptionStatus === 'trialing' ? 'trialing' : 'active';
        const deploymentMode: Tenant['deploymentMode'] =
          body.deploymentMode === 'dedicated_enterprise'
            ? 'dedicated_enterprise'
            : 'shared_cloud';

        if (!companyName) {
          res.status(400).json({ error: 'Workspace / organisation name is required.' });
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
          res.status(400).json({ error: 'A valid workspace owner email is required.' });
          return;
        }

        const existingOwner = await db.findUserByEmail(ownerEmail);
        if (!existingOwner) {
          if (!ownerName) {
            res.status(400).json({
              error: 'Owner full name is required for a new user account.',
            });
            return;
          }
          if (ownerPassword.length < 8) {
            res.status(400).json({
              error: 'Initial password (minimum 8 characters) is required for a new owner account.',
            });
            return;
          }
        }

        const now = new Date().toISOString();
        const ownerUser = existingOwner
          ? existingOwner
          : await db.createUser({
              id: `usr-${crypto.randomUUID().slice(0, 8)}`,
              name: ownerName,
              email: ownerEmail,
              password_hash: hashPassword(ownerPassword),
              role: 'admin',
              department: 'IT Infrastructure',
              status: 'active',
              created_at: now,
              last_login: null,
              email_verified: true,
              mfa_enabled: false,
              is_super_admin: false,
            });

        const tenantId = `ten-${crypto.randomUUID().slice(0, 8)}`;
        const slugBase = companyName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/(^-|-$)/g, '')
          .slice(0, 32);

        const tenant: Tenant = {
          id: tenantId,
          name: companyName,
          slug: `${slugBase || 'workspace'}-${tenantId.slice(-4)}`,
          type: tenantType,
          status: subscriptionStatus === 'trialing' ? 'trial' : 'active',
          ownerUserId: ownerUser.id,
          planCode,
          deploymentMode,
          ...(deploymentMode === 'dedicated_enterprise'
            ? {
                dedicatedConfig: {
                  customDomain: String(body.customDomain ?? '').trim() || undefined,
                  dedicatedProjectId: String(body.dedicatedProjectId ?? '').trim() || undefined,
                  isolationTier: 'dedicated_cluster' as const,
                },
              }
            : {}),
          supportEmail: ownerEmail,
          country,
          createdAt: now,
          updatedAt: now,
        };

        const primaryClientName =
          String(body.primaryClientName ?? '').trim() ||
          (tenantType === 'msp' ? `${companyName} (Primary Client)` : companyName);
        const primaryClientCode =
          String(body.primaryClientCode ?? 'HQ-01')
            .trim()
            .toUpperCase() || 'HQ-01';

        const defaultOrg: ClientOrganisation = {
          id: `org-${crypto.randomUUID().slice(0, 8)}`,
          tenantId,
          name: primaryClientName,
          code: primaryClientCode,
          industry,
          contactName: ownerUser.name,
          contactEmail: ownerEmail,
          contactPhone: '',
          address: '',
          status: 'active',
          isDefault: true,
          createdAt: now,
          updatedAt: now,
        };

        const ownerRole: TenantRole =
          tenantType === 'msp' ? 'msp_admin' : 'tenant_owner';
        const ownerMembership: UserMembership = {
          id: `${ownerUser.id}_${tenantId}`,
          userId: ownerUser.id,
          tenantId,
          role: ownerRole,
          status: 'active',
          orgAccessMode: 'all',
          allowedOrgIds: [],
          createdAt: now,
          updatedAt: now,
        };

        const plan =
          store.data.plans.find((p) => p.code === planCode) || store.data.plans[0];
        const planPrice =
          billingCycle === 'annual' ? plan.annualPriceGhs : plan.monthlyPriceGhs;
        const defaultTrialDays = store.data.platformSettings.trialDays || 14;
        const trialDays = Math.max(
          1,
          Number(body.trialDays ?? defaultTrialDays) || defaultTrialDays
        );
        const periodDays =
          subscriptionStatus === 'trialing'
            ? trialDays
            : billingCycle === 'annual'
              ? 365
              : 30;
        const periodEnd = new Date(
          Date.now() + periodDays * 24 * 60 * 60 * 1000
        ).toISOString();

        const subscription: TenantSubscription = {
          id: `sub-${crypto.randomUUID().slice(0, 8)}`,
          tenantId,
          planCode,
          billingCycle,
          status: subscriptionStatus,
          trialEndsAt: subscriptionStatus === 'trialing' ? periodEnd : null,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          amountGhs: planPrice,
          updatedAt: now,
        };

        await store.mutate(() => {
          store.seedTenantDefaults({
            tenant,
            defaultOrg,
            ownerMembership,
            subscription,
          });
        });

        let paymentResult: Awaited<ReturnType<typeof finalizePaymentSuccess>> | null =
          null;
        if (
          subscriptionStatus === 'active' &&
          Boolean(body.recordInitialPayment) &&
          planPrice > 0
        ) {
          const ref = `AV-ADM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
          const payment: PaymentTransaction = {
            id: `pay-${crypto.randomUUID().slice(0, 8)}`,
            tenantId,
            subscriptionId: subscription.id,
            reference: ref,
            provider: 'manual',
            planCode,
            billingCycle,
            amountGhs: planPrice,
            currency: 'GHS',
            status: 'pending',
            paidAt: null,
            createdBy: (req as TenantRequest).authUser!.id,
            createdAt: now,
          };
          store.data.payments.unshift(payment);
          paymentResult = await finalizePaymentSuccess(store, ref, {
            channel: 'super_admin_provision',
            verifiedAmountGhs: planPrice,
          });
        }

        await store.appendAuditLog({
          tenantId: tenant.id,
          orgId: 'platform',
          actorUserId: (req as TenantRequest).authUser!.id,
          actorEmail: (req as TenantRequest).authUser!.email,
          actorRole: 'super_admin',
          action: 'PLATFORM_TENANT_CREATED',
          entityType: 'tenant',
          entityId: tenant.id,
          summary: `Super Admin registered ${tenant.type.toUpperCase()} tenant "${tenant.name}" (${plan.name}, ${subscriptionStatus}/${billingCycle}) for ${ownerEmail}`,
          isPlatform: true,
        });

        res.status(201).json({
          tenant,
          subscription: paymentResult?.subscription || subscription,
          owner: {
            id: ownerUser.id,
            name: ownerUser.name,
            email: ownerUser.email,
            isExisting: Boolean(existingOwner),
          },
          invoice: paymentResult?.invoice || null,
        });
      } catch (err) {
        console.error('Create platform tenant error:', err);
        res.status(500).json({ error: 'Failed to register tenant workspace.' });
      }
    }
  );

  app.put(
    '/api/platform/tenants/:id',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      const tenant = store.data.tenants.find((t) => t.id === req.params.id);
      if (!tenant) {
        res.status(404).json({ error: 'Tenant not found.' });
        return;
      }
      const sub = store.data.subscriptions.find((s) => s.tenantId === tenant.id);
      if (req.body?.status) tenant.status = req.body.status;
      if (req.body?.deploymentMode) {
        tenant.deploymentMode = req.body.deploymentMode;
      }
      if (req.body?.dedicatedConfig) {
        tenant.dedicatedConfig = req.body.dedicatedConfig;
      }
      if (req.body?.planCode) {
        tenant.planCode = req.body.planCode;
        if (sub) {
          sub.planCode = req.body.planCode;
          sub.status = 'active';
          sub.updatedAt = new Date().toISOString();
        }
      }
      if (req.body?.subscriptionStatus && sub) {
        sub.status = req.body.subscriptionStatus;
        sub.updatedAt = new Date().toISOString();
      }
      if (req.body?.customOverrides && sub) {
        sub.customOverrides = req.body.customOverrides;
      }
      tenant.updatedAt = new Date().toISOString();
      await store.persist();
      await store.appendAuditLog({
        tenantId: tenant.id,
        orgId: 'platform',
        actorUserId: (req as TenantRequest).authUser!.id,
        actorEmail: (req as TenantRequest).authUser!.email,
        actorRole: 'super_admin',
        action: 'PLATFORM_TENANT_UPDATED',
        entityType: 'tenant',
        entityId: tenant.id,
        summary: `Super Admin updated tenant ${tenant.name} (plan=${tenant.planCode}, status=${tenant.status})`,
        isPlatform: true,
      });
      res.json({ tenant, subscription: sub || null });
    }
  );

  app.delete(
    '/api/platform/tenants/:id',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        const tenantId = String(req.params.id);
        if (tenantId === DEFAULT_TENANT_ID) {
          res.status(400).json({
            error: 'Cannot delete the primary platform workspace.',
          });
          return;
        }
        const tenant = store.data.tenants.find((t) => t.id === tenantId);
        if (!tenant) {
          res.status(404).json({ error: 'Tenant not found.' });
          return;
        }

        // Delete tenant assets & employees from primary database
        const [tenantAssets, tenantEmployees, allUsers] = await Promise.all([
          db.listAssets({ tenantId }),
          db.listEmployees({ tenantId }),
          db.listUsers(),
        ]);

        for (const asset of tenantAssets) {
          await db.deleteAsset(asset.id);
        }
        for (const emp of tenantEmployees) {
          await db.deleteEmployee(emp.id);
        }

        const removedAssetIds = new Set(tenantAssets.map((a) => a.id));
        const removedTicketIds = new Set(
          store.data.tickets
            .filter((t) => t.tenantId === tenantId)
            .map((t) => t.id)
        );
        const affectedUserIds = Array.from(
          new Set(
            store.data.memberships
              .filter((m) => m.tenantId === tenantId)
              .map((m) => m.userId)
          )
        );

        await store.mutate((s) => {
          s.tenants = s.tenants.filter((t) => t.id !== tenantId);
          s.clientOrganisations = s.clientOrganisations.filter(
            (o) => o.tenantId !== tenantId
          );
          s.locations = s.locations.filter((l) => l.tenantId !== tenantId);
          s.departments = s.departments.filter((d) => d.tenantId !== tenantId);
          s.memberships = s.memberships.filter((m) => m.tenantId !== tenantId);
          s.invitations = s.invitations.filter((i) => i.tenantId !== tenantId);
          s.subscriptions = s.subscriptions.filter((sub) => sub.tenantId !== tenantId);
          s.payments = s.payments.filter((p) => p.tenantId !== tenantId);
          s.invoices = s.invoices.filter((inv) => inv.tenantId !== tenantId);
          s.assetTransfers = s.assetTransfers.filter((tr) => tr.tenantId !== tenantId);
          s.softwareLicences = s.softwareLicences.filter(
            (l) => l.tenantId !== tenantId
          );
          s.vendors = s.vendors.filter((v) => v.tenantId !== tenantId);
          s.purchaseRequests = s.purchaseRequests.filter(
            (pr) => pr.tenantId !== tenantId
          );
          s.purchaseOrders = s.purchaseOrders.filter((po) => po.tenantId !== tenantId);
          s.tickets = s.tickets.filter((t) => t.tenantId !== tenantId);
          s.ticketComments = s.ticketComments.filter(
            (c) => !removedTicketIds.has(c.ticketId)
          );
          s.incidents = s.incidents.filter((i) => i.tenantId !== tenantId);
          s.problems = s.problems.filter((p) => p.tenantId !== tenantId);
          s.changes = s.changes.filter((c) => c.tenantId !== tenantId);
          s.serviceCatalogue = s.serviceCatalogue.filter(
            (sc) => sc.tenantId !== tenantId
          );
          s.serviceRequests = s.serviceRequests.filter(
            (sr) => sr.tenantId !== tenantId
          );
          s.slaPolicies = s.slaPolicies.filter((sp) => sp.tenantId !== tenantId);
          s.contracts = s.contracts.filter((c) => c.tenantId !== tenantId);
          s.knowledgeArticles = s.knowledgeArticles.filter(
            (k) => k.tenantId !== tenantId
          );
          s.auditLogs = s.auditLogs.filter((a) => a.tenantId !== tenantId);
          s.customFields = s.customFields.filter((cf) => cf.tenantId !== tenantId);
          for (const assetId of removedAssetIds) {
            delete s.assetMeta[assetId];
          }
        });

        // Clean up user accounts that belonged exclusively to this deleted tenant
        const actorId = (req as TenantRequest).authUser!.id;
        for (const uid of affectedUserIds) {
          if (uid === actorId) continue;
          const userRecord = allUsers.find((u) => u.id === uid);
          if (!userRecord || userRecord.is_super_admin) continue;
          const stillHasMembership = store.data.memberships.some(
            (m) => m.userId === uid
          );
          if (!stillHasMembership) {
            await db.deleteUser(uid);
          }
        }

        await store.appendAuditLog({
          tenantId: 'platform',
          orgId: 'platform',
          actorUserId: actorId,
          actorEmail: (req as TenantRequest).authUser!.email,
          actorRole: 'super_admin',
          action: 'PLATFORM_TENANT_DELETED',
          entityType: 'tenant',
          entityId: tenantId,
          summary: `Super Admin deleted tenant ${tenant.name} (${tenant.type})`,
          isPlatform: true,
        });

        res.json({ ok: true });
      } catch (err) {
        console.error('Delete platform tenant error:', err);
        res.status(500).json({ error: 'Failed to delete tenant workspace.' });
      }
    }
  );

  app.put(
    '/api/platform/plans/:code',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      const plan = store.data.plans.find((p) => p.code === req.params.code);
      if (!plan) {
        res.status(404).json({ error: 'Plan not found.' });
        return;
      }
      if (req.body?.name) plan.name = String(req.body.name).trim();
      if (req.body?.tagline !== undefined) plan.tagline = String(req.body.tagline).trim();
      if (req.body?.isPublic !== undefined) plan.isPublic = Boolean(req.body.isPublic);
      if (req.body?.isCustomAnnual !== undefined) {
        plan.isCustomAnnual = Boolean(req.body.isCustomAnnual);
      }
      if (req.body?.monthlyPriceGhs !== undefined) {
        plan.monthlyPriceGhs = Math.max(0, Number(req.body.monthlyPriceGhs));
      }
      if (req.body?.annualPriceGhs !== undefined) {
        plan.annualPriceGhs = Math.max(0, Number(req.body.annualPriceGhs));
      }
      if (req.body?.limits) {
        plan.limits = { ...plan.limits, ...req.body.limits };
      }
      if (Array.isArray(req.body?.features)) {
        plan.features = req.body.features;
      }
      plan.updatedAt = new Date().toISOString();
      await store.persist();
      await store.appendAuditLog({
        tenantId: 'platform',
        orgId: 'platform',
        actorUserId: (req as TenantRequest).authUser!.id,
        actorEmail: (req as TenantRequest).authUser!.email,
        actorRole: 'super_admin',
        action: 'PLATFORM_PLAN_UPDATED',
        entityType: 'plan',
        entityId: plan.id,
        summary: `Updated plan ${plan.name} (GH₵${plan.monthlyPriceGhs}/mo)`,
        isPlatform: true,
      });
      res.json({ plan });
    }
  );

  app.post(
    '/api/platform/payments/manual',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      const tenantId = String(req.body?.tenantId ?? '').trim();
      const planCode = String(req.body?.planCode ?? 'business') as PlanCode;
      const billingCycle = (
        req.body?.billingCycle === 'annual' ? 'annual' : 'monthly'
      ) as BillingCycle;
      const amountGhs = Math.max(0, Number(req.body?.amountGhs ?? 0));

      const tenant = store.data.tenants.find((t) => t.id === tenantId);
      if (!tenant) {
        res.status(404).json({ error: 'Tenant not found.' });
        return;
      }
      const sub = store.data.subscriptions.find((s) => s.tenantId === tenantId);
      const ref = `AV-MAN-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const payment: PaymentTransaction = {
        id: `pay-${crypto.randomUUID().slice(0, 8)}`,
        tenantId,
        subscriptionId: sub?.id || '',
        reference: ref,
        provider: 'manual',
        planCode,
        billingCycle,
        amountGhs,
        currency: 'GHS',
        status: 'pending',
        paidAt: null,
        createdBy: (req as TenantRequest).authUser!.id,
        createdAt: new Date().toISOString(),
      };
      store.data.payments.unshift(payment);
      const result = await finalizePaymentSuccess(store, ref, {
        channel: 'manual_bank_transfer',
        verifiedAmountGhs: amountGhs,
      });
      await store.appendAuditLog({
        tenantId,
        orgId: 'platform',
        actorUserId: (req as TenantRequest).authUser!.id,
        actorEmail: (req as TenantRequest).authUser!.email,
        actorRole: 'super_admin',
        action: 'MANUAL_PAYMENT_RECORDED',
        entityType: 'payment',
        entityId: payment.id,
        summary: `Recorded manual payment GH₵${amountGhs} for ${tenant.name}`,
        isPlatform: true,
      });
      res.status(201).json(result);
    }
  );

  app.post(
    '/api/platform/payments/:id/refund',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      const payment = store.data.payments.find((p) => p.id === req.params.id);
      if (!payment) {
        res.status(404).json({ error: 'Payment transaction not found.' });
        return;
      }
      payment.status = 'refunded';
      payment.refundedAt = new Date().toISOString();
      payment.refundReason = String(req.body?.reason ?? 'Super Admin refund').trim();
      const inv = store.data.invoices.find((i) => i.paymentId === payment.id);
      if (inv) inv.status = 'refunded';
      await store.persist();
      await store.appendAuditLog({
        tenantId: payment.tenantId,
        orgId: 'platform',
        actorUserId: (req as TenantRequest).authUser!.id,
        actorEmail: (req as TenantRequest).authUser!.email,
        actorRole: 'super_admin',
        action: 'PAYMENT_REFUNDED',
        entityType: 'payment',
        entityId: payment.id,
        summary: `Refunded payment ${payment.reference} (GH₵${payment.amountGhs})`,
        isPlatform: true,
      });
      res.json({ payment });
    }
  );

  app.put(
    '/api/platform/settings',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      const s = store.data.platformSettings;
      if (req.body?.platformName) s.platformName = String(req.body.platformName).trim();
      if (req.body?.supportEmail) s.supportEmail = String(req.body.supportEmail).trim();
      if (req.body?.trialDays !== undefined) {
        s.trialDays = Math.max(1, Number(req.body.trialDays));
      }
      if (req.body?.gracePeriodDays !== undefined) {
        s.gracePeriodDays = Math.max(0, Number(req.body.gracePeriodDays));
      }
      if (req.body?.maintenanceMode !== undefined) {
        s.maintenanceMode = Boolean(req.body.maintenanceMode);
      }
      s.updatedAt = new Date().toISOString();
      await store.persist();
      res.json({ settings: s });
    }
  );

  app.post(
    '/api/platform/reset-database',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      try {
        if (String(req.body?.confirm ?? '').trim() !== 'RESET_ALL_DATA') {
          res.status(400).json({
            error: 'Confirmation text "RESET_ALL_DATA" is required.',
          });
          return;
        }
        await db.resetToCleanState();
        await store.resetToCleanState();
        res.json({
          ok: true,
          message:
            'All operational and tenant data cleared. Restored clean starter state.',
        });
      } catch (err) {
        console.error('Reset database error:', err);
        res.status(500).json({ error: 'Failed to reset database.' });
      }
    }
  );

  app.get(
    '/api/platform/email/outbox',
    requireAuth,
    requirePlatformSuperAdmin,
    (_req, res) => {
      res.json({ outbox: store.data.emailOutbox.slice(0, 60) });
    }
  );

  app.post(
    '/api/platform/email/test',
    requireAuth,
    requirePlatformSuperAdmin,
    async (req, res) => {
      const to = String(req.body?.to ?? '').trim().toLowerCase();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        res.status(400).json({ error: 'Valid recipient email is required.' });
        return;
      }
      const entry = await sendTransactionalEmail(store, {
        tenantId: 'platform',
        to,
        subject: `${store.data.platformSettings.platformName} — SMTP Delivery Verification`,
        text: `This is a verification email from ${store.data.platformSettings.platformName}. Delivery mode: ${
          store.data.platformSettings.smtpConfigured ? 'SMTP Live' : 'Local Console Outbox'
        }.`,
      });
      res.json({ ok: true, entry });
    }
  );

  registerIntegrationRoutes({
    app,
    db,
    store,
    requireAuth,
    resolveTenantContext,
  });

  registerPlatformDatabaseRoutes({
    app,
    db,
    store,
    requireAuth,
    requirePlatformSuperAdmin,
  });
}

async function finalizePaymentSuccess(
  store: SaasStore,
  reference: string,
  meta: { channel: string; verifiedAmountGhs: number | null }
) {
  const payment = store.data.payments.find((p) => p.reference === reference);
  if (!payment) {
    throw new Error('Payment record not found.');
  }
  const now = new Date().toISOString();
  if (payment.status !== 'success') {
    payment.status = 'success';
    payment.paidAt = now;
    payment.channel = meta.channel;
    if (meta.verifiedAmountGhs !== null) {
      payment.amountGhs = meta.verifiedAmountGhs;
    }
  }

  const tenant = store.data.tenants.find((t) => t.id === payment.tenantId);
  if (tenant) {
    tenant.planCode = payment.planCode;
    tenant.status = 'active';
    tenant.updatedAt = now;
  }

  let sub = store.data.subscriptions.find((s) => s.tenantId === payment.tenantId);
  const periodDays = payment.billingCycle === 'annual' ? 365 : 30;
  const periodEnd = new Date(
    Date.now() + periodDays * 24 * 60 * 60 * 1000
  ).toISOString();
  if (sub) {
    sub.planCode = payment.planCode;
    sub.billingCycle = payment.billingCycle;
    sub.status = 'active';
    sub.currentPeriodStart = now;
    sub.currentPeriodEnd = periodEnd;
    sub.graceEndsAt = null;
    sub.amountGhs = payment.amountGhs;
    sub.updatedAt = now;
  }

  let invoice = store.data.invoices.find((i) => i.paymentId === payment.id);
  if (!invoice) {
    const plan = store.data.plans.find((p) => p.code === payment.planCode);
    const seq = store.data.invoices.length + 1;
    invoice = {
      id: `inv-${crypto.randomUUID().slice(0, 8)}`,
      invoiceNumber: `INV-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`,
      tenantId: payment.tenantId,
      paymentId: payment.id,
      planName: plan?.name || payment.planCode,
      billingCycle: payment.billingCycle,
      amountGhs: payment.amountGhs,
      status: 'paid',
      issuedAt: now,
      dueAt: now,
    };
    store.data.invoices.unshift(invoice);
  }

  await store.persist();
  return { payment, subscription: sub || null, invoice };
}
