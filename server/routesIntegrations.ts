import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import {
  requireFeature,
  requirePermission,
  requireWritableSubscription,
  type TenantRequest,
} from './context.ts';
import type { ItamsDatabase } from './db.ts';
import type { SaasStore } from './saasStore.ts';
import {
  buildScheduledReportSummary,
  computeNextRunIso,
} from './scheduler.ts';
import { sendTransactionalEmail } from './mailer.ts';
import { dispatchWebhookEvent, validateWebhookUrl } from './webhooks.ts';
import type {
  AttachmentItem,
  CustomFieldDef,
  CurrencyCode,
  ScheduledReportConfig,
} from '../src/types/saas.ts';

const ALLOWED_ATTACHMENT_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

const VALID_ENTITY_TYPES = new Set([
  'asset',
  'maintenance',
  'ticket',
  'po',
  'contract',
]);

const VALID_CURRENCIES: CurrencyCode[] = ['USD', 'GHS', 'EUR', 'GBP'];

export function registerIntegrationRoutes(params: {
  app: Express;
  db: ItamsDatabase;
  store: SaasStore;
  requireAuth: (req: Request, res: Response, next: () => void) => void;
  resolveTenantContext: (req: Request, res: Response, next: () => void) => void;
}) {
  const { app, db, store, requireAuth, resolveTenantContext } = params;
  const tenantGuard = [requireAuth, resolveTenantContext];

  // -------------------------------------------------------------------------
  // Workspace Settings (Multi-Currency & Branding)
  // -------------------------------------------------------------------------
  app.put(
    '/api/workspace/settings',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const body = req.body ?? {};
      const tenant = store.data.tenants.find((t) => t.id === ctx.tenant.id);
      if (!tenant) {
        res.status(404).json({ error: 'Workspace not found.' });
        return;
      }

      if (body.name && String(body.name).trim()) {
        tenant.name = String(body.name).trim().slice(0, 80);
      }
      if (body.country && String(body.country).trim()) {
        tenant.country = String(body.country).trim().slice(0, 60);
      }
      if (body.supportEmail && String(body.supportEmail).trim()) {
        tenant.supportEmail = String(body.supportEmail).trim().toLowerCase();
      }
      if (body.currency) {
        const cur = String(body.currency).toUpperCase() as CurrencyCode;
        if (!VALID_CURRENCIES.includes(cur)) {
          res.status(400).json({ error: 'Unsupported currency code.' });
          return;
        }
        tenant.currency = cur;
      }
      tenant.updatedAt = new Date().toISOString();

      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: ctx.targetOrgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'WORKSPACE_SETTINGS_UPDATED',
        entityType: 'tenant',
        entityId: tenant.id,
        summary: `Updated workspace settings (currency: ${tenant.currency || 'USD'})`,
      });
      res.json({ tenant });
    }
  );

  // -------------------------------------------------------------------------
  // Document & Image Attachments (Receipts, Invoices, Photos, Signed Handovers)
  // -------------------------------------------------------------------------
  app.get(
    '/api/attachments',
    ...tenantGuard,
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const entityType = String(req.query.entityType ?? '');
      const entityId = String(req.query.entityId ?? '');
      const items = store.data.attachments.filter((a) => {
        if (a.tenantId !== ctx.tenant.id) return false;
        if (ctx.scopeFilter.orgIds && !ctx.scopeFilter.orgIds.includes(a.orgId)) {
          return false;
        }
        if (entityType && a.entityType !== entityType) return false;
        if (entityId && a.entityId !== entityId) return false;
        return true;
      });
      res.json({ attachments: items });
    }
  );

  app.post(
    '/api/attachments',
    ...tenantGuard,
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const body = req.body ?? {};
      const entityType = String(body.entityType ?? '');
      const entityId = String(body.entityId ?? '').trim();
      const fileName = String(body.fileName ?? '').trim().slice(0, 140);
      const mimeType = String(body.mimeType ?? '').trim().toLowerCase();
      const dataUrl = String(body.dataUrl ?? '');

      if (!VALID_ENTITY_TYPES.has(entityType) || !entityId || !fileName) {
        res.status(400).json({ error: 'Valid entityType, entityId, and fileName are required.' });
        return;
      }
      if (!ALLOWED_ATTACHMENT_MIMES.has(mimeType)) {
        res.status(400).json({
          error: 'Unsupported file format. Allowed: PNG, JPG, WEBP, PDF, TXT, CSV.',
        });
        return;
      }
      if (!dataUrl.startsWith(`data:${mimeType};base64,`)) {
        res.status(400).json({ error: 'Invalid base64 file payload.' });
        return;
      }
      const b64Part = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const sizeBytes = Math.floor((b64Part.length * 3) / 4);
      if (sizeBytes > 4 * 1024 * 1024) {
        res.status(400).json({ error: 'Attachment exceeds the 4 MB per-file limit.' });
        return;
      }

      const maxStorageMb = ctx.effectiveLimits.maxStorageMb ?? null;
      if (maxStorageMb !== null) {
        const currentStorageBytes = ctx.usage.storageUsedBytes ?? 0;
        const limitBytes = maxStorageMb * 1024 * 1024;
        if (currentStorageBytes + sizeBytes > limitBytes) {
          res.status(403).json({
            code: 'QUOTA_EXCEEDED',
            error: `Storage quota exceeded: your ${ctx.plan.name} plan includes ${maxStorageMb >= 1024 ? `${(maxStorageMb / 1024).toFixed(1)} GB` : `${maxStorageMb} MB`} of attachment storage. Upgrade your plan or remove unused files.`,
          });
          return;
        }
      }

      const item: AttachmentItem = {
        id: `att-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: String(body.orgId || ctx.targetOrgId),
        entityType: entityType as AttachmentItem['entityType'],
        entityId,
        fileName,
        mimeType,
        sizeBytes,
        dataUrl,
        uploadedByUserId: req.authUser!.id,
        uploadedByName: req.authUser!.name,
        createdAt: new Date().toISOString(),
      };

      await store.mutate((s) => s.attachments.unshift(item));
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: item.orgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'ATTACHMENT_UPLOADED',
        entityType: item.entityType,
        entityId: item.entityId,
        summary: `Uploaded attachment "${item.fileName}" (${Math.max(1, Math.round(sizeBytes / 1024))} KB)`,
      });

      res.status(201).json({ attachment: item });
    }
  );

  app.delete(
    '/api/attachments/:id',
    ...tenantGuard,
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const item = store.data.attachments.find(
        (a) => a.id === id && a.tenantId === ctx.tenant.id
      );
      if (!item) {
        res.status(404).json({ error: 'Attachment not found.' });
        return;
      }
      const isAdmin =
        ctx.permissions.includes('assets.delete') ||
        ctx.permissions.includes('org.manage') ||
        item.uploadedByUserId === req.authUser!.id;
      if (!isAdmin) {
        res.status(403).json({ error: 'You cannot delete attachments uploaded by another user.' });
        return;
      }
      await store.mutate((s) => {
        s.attachments = s.attachments.filter((a) => a.id !== id);
      });
      res.json({ ok: true });
    }
  );

  // -------------------------------------------------------------------------
  // Custom Fields Builder & Values (Gated by custom_fields)
  // -------------------------------------------------------------------------
  app.get('/api/custom-fields', ...tenantGuard, (req: TenantRequest, res) => {
    const ctx = req.tenantCtx!;
    const entityType = req.query.entityType ? String(req.query.entityType) : null;
    const fields = store.data.customFields.filter(
      (f) => f.tenantId === ctx.tenant.id && (!entityType || f.entityType === entityType)
    );
    res.json({ fields });
  });

  app.post(
    '/api/custom-fields',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    requireFeature('custom_fields', 'Custom Fields Builder'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const body = req.body ?? {};
      const entityType = String(body.entityType ?? 'asset') as CustomFieldDef['entityType'];
      const label = String(body.label ?? '').trim();
      const fieldType = String(body.fieldType ?? 'text') as CustomFieldDef['fieldType'];
      if (!['asset', 'ticket', 'employee'].includes(entityType) || !label) {
        res.status(400).json({ error: 'Valid entityType and field label are required.' });
        return;
      }
      if (!['text', 'number', 'date', 'select'].includes(fieldType)) {
        res.status(400).json({ error: 'Invalid fieldType.' });
        return;
      }
      const fieldKey =
        String(body.fieldKey ?? label)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '') || `field_${crypto.randomUUID().slice(0, 4)}`;

      const duplicate = store.data.customFields.some(
        (f) =>
          f.tenantId === ctx.tenant.id &&
          f.entityType === entityType &&
          f.fieldKey === fieldKey
      );
      if (duplicate) {
        res.status(409).json({ error: `A custom field with key "${fieldKey}" already exists for ${entityType}.` });
        return;
      }

      const options =
        fieldType === 'select' && Array.isArray(body.options)
          ? body.options.map((o: unknown) => String(o).trim()).filter(Boolean)
          : undefined;

      const field: CustomFieldDef = {
        id: `cf-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        entityType,
        fieldKey,
        label,
        fieldType,
        options,
        required: Boolean(body.required),
      };
      await store.mutate((s) => s.customFields.push(field));
      res.status(201).json({ field });
    }
  );

  app.delete(
    '/api/custom-fields/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    requireFeature('custom_fields', 'Custom Fields Builder'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const exists = store.data.customFields.some(
        (f) => f.id === id && f.tenantId === ctx.tenant.id
      );
      if (!exists) {
        res.status(404).json({ error: 'Custom field not found.' });
        return;
      }
      await store.mutate((s) => {
        s.customFields = s.customFields.filter((f) => f.id !== id);
      });
      res.json({ ok: true });
    }
  );

  app.get(
    '/api/custom-fields/values/:entityType/:entityId',
    ...tenantGuard,
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const key = `${ctx.tenant.id}:${req.params.entityType}:${req.params.entityId}`;
      res.json({ values: store.data.customFieldValues[key] || {} });
    }
  );

  app.put(
    '/api/custom-fields/values/:entityType/:entityId',
    ...tenantGuard,
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const entityType = String(req.params.entityType);
      const entityId = String(req.params.entityId);
      if (!['asset', 'ticket', 'employee'].includes(entityType)) {
        res.status(400).json({ error: 'Invalid entity type.' });
        return;
      }
      const raw = req.body?.values;
      const sanitized: Record<string, string> = {};
      if (raw && typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            sanitized[String(k)] = String(v).trim().slice(0, 500);
          }
        }
      }
      const key = `${ctx.tenant.id}:${entityType}:${entityId}`;
      await store.mutate((s) => {
        s.customFieldValues[key] = sanitized;
      });
      res.json({ values: sanitized });
    }
  );

  // -------------------------------------------------------------------------
  // API Keys & Outbound Webhooks (Gated by api_webhooks)
  // -------------------------------------------------------------------------
  app.get(
    '/api/integrations/api-keys',
    ...tenantGuard,
    requirePermission('org.manage'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const keys = store.data.apiKeys
        .filter((k) => k.tenantId === ctx.tenant.id)
        .map(({ keyHash: _h, ...safe }) => safe);
      res.json({ apiKeys: keys });
    }
  );

  app.post(
    '/api/integrations/api-keys',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    requireFeature('api_webhooks', 'API Keys & Outbound Webhooks'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const name = String(req.body?.name ?? '').trim();
      if (!name) {
        res.status(400).json({ error: 'API key name is required.' });
        return;
      }
      const rawSecret = `av_live_${crypto.randomBytes(24).toString('hex')}`;
      const keyHash = crypto.createHash('sha256').update(rawSecret).digest('hex');
      const keyPrefix = rawSecret.slice(0, 14);
      const scopes = Array.isArray(req.body?.scopes) && req.body.scopes.length > 0
        ? req.body.scopes.map(String)
        : ['assets:read', 'tickets:read'];

      const record = {
        id: `key-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        name,
        keyPrefix,
        keyHash,
        scopes,
        createdBy: req.authUser!.name,
        lastUsedAt: null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
      await store.mutate((s) => s.apiKeys.unshift(record));
      const { keyHash: _h, ...safe } = record;
      res.status(201).json({ apiKey: safe, plaintextKey: rawSecret });
    }
  );

  app.delete(
    '/api/integrations/api-keys/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const key = store.data.apiKeys.find(
        (k) => k.id === req.params.id && k.tenantId === ctx.tenant.id
      );
      if (!key) {
        res.status(404).json({ error: 'API key not found.' });
        return;
      }
      await store.mutate((s) => {
        const target = s.apiKeys.find((k) => k.id === key.id);
        if (target) target.revokedAt = new Date().toISOString();
      });
      res.json({ ok: true });
    }
  );

  app.get(
    '/api/integrations/webhooks',
    ...tenantGuard,
    requirePermission('org.manage'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const webhooks = store.data.webhooks
        .filter((w) => w.tenantId === ctx.tenant.id)
        .map(({ secret: _sec, ...safe }) => safe);
      const deliveries = store.data.webhookDeliveries
        .filter((d) => d.tenantId === ctx.tenant.id)
        .slice(0, 50);
      res.json({ webhooks, deliveries });
    }
  );

  app.post(
    '/api/integrations/webhooks',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    requireFeature('api_webhooks', 'API Keys & Outbound Webhooks'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const name = String(req.body?.name ?? '').trim();
      const rawUrl = String(req.body?.url ?? '').trim();
      const events = Array.isArray(req.body?.events) && req.body.events.length > 0
        ? req.body.events.map(String)
        : ['asset.created', 'asset.assigned', 'ticket.created'];

      if (!name || !rawUrl) {
        res.status(400).json({ error: 'Webhook name and endpoint URL are required.' });
        return;
      }
      const check = await validateWebhookUrl(rawUrl);
      if (!check.ok || !check.url) {
        res.status(400).json({ error: check.error || 'Invalid webhook URL.' });
        return;
      }

      const secret = `whsec_${crypto.randomBytes(20).toString('hex')}`;
      const record = {
        id: `wh-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        name,
        url: check.url,
        secret,
        events,
        active: true,
        createdBy: req.authUser!.name,
        createdAt: new Date().toISOString(),
        lastTriggeredAt: null,
      };
      await store.mutate((s) => s.webhooks.unshift(record));
      const { secret: _sec, ...safe } = record;
      res.status(201).json({ webhook: safe, signingSecret: secret });
    }
  );

  app.post(
    '/api/integrations/webhooks/:id/test',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireFeature('api_webhooks', 'API Keys & Outbound Webhooks'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const wh = store.data.webhooks.find(
        (w) => w.id === req.params.id && w.tenantId === ctx.tenant.id
      );
      if (!wh) {
        res.status(404).json({ error: 'Webhook endpoint not found.' });
        return;
      }
      const deliveries = await dispatchWebhookEvent(
        store,
        ctx.tenant.id,
        'webhook.test',
        { message: 'Test event from AssetVault IT', triggeredBy: req.authUser!.email },
        wh.id
      );
      res.json({ delivery: deliveries[0] || null });
    }
  );

  app.delete(
    '/api/integrations/webhooks/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const exists = store.data.webhooks.some(
        (w) => w.id === req.params.id && w.tenantId === ctx.tenant.id
      );
      if (!exists) {
        res.status(404).json({ error: 'Webhook not found.' });
        return;
      }
      await store.mutate((s) => {
        s.webhooks = s.webhooks.filter((w) => w.id !== req.params.id);
      });
      res.json({ ok: true });
    }
  );

  // Public Tenant REST API v1 authenticated via X-API-Key header
  const requireApiKey = async (req: Request, res: Response, next: () => void) => {
    const rawKey = String(req.headers['x-api-key'] ?? '').trim();
    if (!rawKey) {
      res.status(401).json({ error: 'Missing X-API-Key header.' });
      return;
    }
    const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const match = store.data.apiKeys.find(
      (k) => k.keyHash === hash && !k.revokedAt
    );
    if (!match) {
      res.status(401).json({ error: 'Invalid or revoked API key.' });
      return;
    }
    match.lastUsedAt = new Date().toISOString();
    (req as Request & { apiKeyTenantId?: string }).apiKeyTenantId = match.tenantId;
    next();
  };

  app.get('/api/v1/assets', requireApiKey, async (req, res) => {
    const tenantId = (req as Request & { apiKeyTenantId?: string }).apiKeyTenantId!;
    const assets = await db.listAssets({ tenantId, orgIds: null });
    res.json({ count: assets.length, assets });
  });

  app.get('/api/v1/tickets', requireApiKey, (req, res) => {
    const tenantId = (req as Request & { apiKeyTenantId?: string }).apiKeyTenantId!;
    const tickets = store.data.tickets.filter((t) => t.tenantId === tenantId);
    res.json({ count: tickets.length, tickets });
  });

  // -------------------------------------------------------------------------
  // Scheduled Reports & Transactional Email Outbox
  // -------------------------------------------------------------------------
  app.get(
    '/api/automation/schedules',
    ...tenantGuard,
    requirePermission('reports.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const schedules = store.data.scheduledReports.filter(
        (s) => s.tenantId === ctx.tenant.id
      );
      const outbox = store.data.emailOutbox
        .filter((m) => m.tenantId === ctx.tenant.id)
        .slice(0, 40);
      res.json({ schedules, outbox });
    }
  );

  app.post(
    '/api/automation/schedules',
    ...tenantGuard,
    requirePermission('org.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const body = req.body ?? {};
      const name = String(body.name ?? '').trim();
      const reportType = String(body.reportType ?? 'inventory') as ScheduledReportConfig['reportType'];
      const frequency = String(body.frequency ?? 'weekly') as ScheduledReportConfig['frequency'];
      const recipients = Array.isArray(body.recipients)
        ? body.recipients.map((r: unknown) => String(r).trim().toLowerCase()).filter(Boolean)
        : String(body.recipients ?? '')
            .split(',')
            .map((r) => r.trim().toLowerCase())
            .filter(Boolean);

      if (!name || recipients.length === 0) {
        res.status(400).json({ error: 'Schedule name and at least one recipient email are required.' });
        return;
      }

      const schedule: ScheduledReportConfig = {
        id: `sch-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: ctx.targetOrgId,
        name,
        reportType: ['inventory', 'maintenance', 'warranty', 'tickets', 'licences', 'depreciation'].includes(reportType)
          ? reportType
          : 'inventory',
        frequency: ['daily', 'weekly', 'monthly'].includes(frequency) ? frequency : 'weekly',
        recipients,
        enabled: true,
        lastRunAt: null,
        nextRunAt: computeNextRunIso(['daily', 'weekly', 'monthly'].includes(frequency) ? frequency : 'weekly'),
        createdBy: req.authUser!.name,
        createdAt: new Date().toISOString(),
      };
      await store.mutate((s) => s.scheduledReports.unshift(schedule));
      res.status(201).json({ schedule });
    }
  );

  app.post(
    '/api/automation/schedules/:id/run',
    ...tenantGuard,
    requirePermission('org.manage'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const schedule = store.data.scheduledReports.find(
        (s) => s.id === req.params.id && s.tenantId === ctx.tenant.id
      );
      if (!schedule) {
        res.status(404).json({ error: 'Scheduled report not found.' });
        return;
      }
      const digest = await buildScheduledReportSummary(store, db, schedule);
      for (const recipient of schedule.recipients) {
        await sendTransactionalEmail(store, {
          tenantId: ctx.tenant.id,
          to: recipient,
          subject: digest.subject,
          text: digest.text,
        });
      }
      schedule.lastRunAt = new Date().toISOString();
      schedule.nextRunAt = computeNextRunIso(schedule.frequency);
      await store.persist();
      res.json({ ok: true, schedule, digest });
    }
  );

  app.delete(
    '/api/automation/schedules/:id',
    ...tenantGuard,
    requirePermission('org.manage'),
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const exists = store.data.scheduledReports.some(
        (s) => s.id === req.params.id && s.tenantId === ctx.tenant.id
      );
      if (!exists) {
        res.status(404).json({ error: 'Scheduled report not found.' });
        return;
      }
      await store.mutate((s) => {
        s.scheduledReports = s.scheduledReports.filter((x) => x.id !== req.params.id);
      });
      res.json({ ok: true });
    }
  );
}
