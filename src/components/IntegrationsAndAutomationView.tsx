import { useEffect, useState, type FormEvent } from 'react';
import {
  CalendarClock,
  Check,
  Copy,
  Globe,
  KeyRound,
  Mail,
  Play,
  Plus,
  Send,
  SlidersHorizontal,
  Trash2,
  Webhook,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type {
  CurrencyCode,
  CustomFieldDef,
  EmailOutboxEntry,
  ScheduledReportConfig,
  TenantApiKey,
  WebhookDelivery,
  WebhookEndpoint,
} from '../types/saas.ts';
import { EmptyState } from './ui/EmptyState.tsx';

interface IntegrationsAndAutomationViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onRefreshContext: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
  onPlanBlocked?: (err: ApiError) => void;
}

type HubTab = 'workspace' | 'custom_fields' | 'api_webhooks' | 'automation';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

function isBlockedErr(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    (err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'FEATURE_LOCKED' ||
      err.code === 'SUBSCRIPTION_READ_ONLY')
  );
}

export function IntegrationsAndAutomationView({
  tenantCtx,
  onRefreshContext,
  onToast,
  onPlanBlocked,
}: IntegrationsAndAutomationViewProps) {
  const [tab, setTab] = useState<HubTab>('workspace');
  const features = tenantCtx?.effectiveFeatures ?? [];
  const hasCustomFields = features.includes('custom_fields');
  const hasApiWebhooks = features.includes('api_webhooks');
  const isReadOnly = Boolean(tenantCtx?.isReadOnlyGraceOrExpired);

  // Workspace Settings
  const [wsName, setWsName] = useState(tenantCtx?.tenant.name || '');
  const [wsCountry, setWsCountry] = useState(tenantCtx?.tenant.country || 'Ghana');
  const [wsEmail, setWsEmail] = useState(tenantCtx?.tenant.supportEmail || '');
  const [wsCurrency, setWsCurrency] = useState<CurrencyCode>(
    tenantCtx?.tenant.currency || 'USD'
  );
  const [savingWs, setSavingWs] = useState(false);

  // Custom Fields
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([]);
  const [cfEntity, setCfEntity] = useState<CustomFieldDef['entityType']>('asset');
  const [cfLabel, setCfLabel] = useState('');
  const [cfType, setCfType] = useState<CustomFieldDef['fieldType']>('text');
  const [cfOptions, setCfOptions] = useState('');
  const [cfRequired, setCfRequired] = useState(false);

  // API Keys & Webhooks
  const [apiKeys, setApiKeys] = useState<TenantApiKey[]>([]);
  const [keyName, setKeyName] = useState('');
  const [newPlaintextKey, setNewPlaintextKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>([
    'asset.created',
    'asset.assigned',
    'ticket.created',
    'ticket.sla_breached',
  ]);
  const [newWhSecret, setNewWhSecret] = useState<string | null>(null);

  // Automation & Scheduled Reports
  const [schedules, setSchedules] = useState<ScheduledReportConfig[]>([]);
  const [outbox, setOutbox] = useState<EmailOutboxEntry[]>([]);
  const [schName, setSchName] = useState('');
  const [schReport, setSchReport] =
    useState<ScheduledReportConfig['reportType']>('inventory');
  const [schFreq, setSchFreq] =
    useState<ScheduledReportConfig['frequency']>('weekly');
  const [schRecipients, setSchRecipients] = useState(
    tenantCtx?.tenant.supportEmail || ''
  );
  const [runningSweep, setRunningSweep] = useState(false);

  useEffect(() => {
    if (tenantCtx) {
      setWsName(tenantCtx.tenant.name);
      setWsCountry(tenantCtx.tenant.country);
      setWsEmail(tenantCtx.tenant.supportEmail);
      setWsCurrency(tenantCtx.tenant.currency || 'USD');
      if (!schRecipients) setSchRecipients(tenantCtx.tenant.supportEmail);
    }
  }, [tenantCtx?.tenant.id]);

  const loadTabData = async () => {
    try {
      const [cfRes, keysRes, whRes, schRes] = await Promise.all([
        hasCustomFields
          ? api.getCustomFields().catch(() => ({ fields: [] }))
          : Promise.resolve({ fields: [] }),
        hasApiWebhooks
          ? api.getApiKeys().catch(() => ({ apiKeys: [] }))
          : Promise.resolve({ apiKeys: [] }),
        hasApiWebhooks
          ? api.getWebhooks().catch(() => ({ webhooks: [], deliveries: [] }))
          : Promise.resolve({ webhooks: [], deliveries: [] }),
        api.getScheduledReports().catch(() => ({ schedules: [], outbox: [] })),
      ]);
      setCustomFields(cfRes.fields);
      setApiKeys(keysRes.apiKeys);
      setWebhooks(whRes.webhooks);
      setDeliveries(whRes.deliveries);
      setSchedules(schRes.schedules);
      setOutbox(schRes.outbox);
    } catch {
      // Non-blocking
    }
  };

  useEffect(() => {
    if (tab === 'custom_fields' && !hasCustomFields) setTab('workspace');
    if (tab === 'api_webhooks' && !hasApiWebhooks) setTab('workspace');
  }, [tab, hasCustomFields, hasApiWebhooks]);

  useEffect(() => {
    void loadTabData();
  }, [tenantCtx?.tenant.id, hasCustomFields, hasApiWebhooks]);

  const handleSaveWorkspace = async (e: FormEvent) => {
    e.preventDefault();
    setSavingWs(true);
    try {
      await api.updateWorkspaceSettings({
        name: wsName.trim(),
        country: wsCountry.trim(),
        supportEmail: wsEmail.trim(),
        currency: wsCurrency,
      });
      onToast(
        'success',
        `Workspace settings saved (Operational currency: ${wsCurrency}).`
      );
      await onRefreshContext();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to save settings.'
      );
    } finally {
      setSavingWs(false);
    }
  };

  const handleCreateCustomField = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createCustomField({
        entityType: cfEntity,
        label: cfLabel.trim(),
        fieldType: cfType,
        options:
          cfType === 'select'
            ? cfOptions.split(',').map((x) => x.trim()).filter(Boolean)
            : undefined,
        required: cfRequired,
      });
      setCfLabel('');
      setCfOptions('');
      setCfRequired(false);
      onToast('success', 'Custom field added.');
      await loadTabData();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create custom field.'
      );
    }
  };

  const handleDeleteCustomField = async (id: string) => {
    try {
      await api.deleteCustomField(id);
      onToast('success', 'Custom field deleted.');
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete custom field.'
      );
    }
  };

  const handleCreateApiKey = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createApiKey(keyName.trim(), [
        'assets:read',
        'tickets:read',
      ]);
      setNewPlaintextKey(res.plaintextKey);
      setKeyName('');
      onToast('success', 'API key generated. Copy the plaintext key now.');
      await loadTabData();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create API key.'
      );
    }
  };

  const handleRevokeKey = async (id: string) => {
    try {
      await api.revokeApiKey(id);
      onToast('success', 'API key revoked.');
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to revoke key.'
      );
    }
  };

  const handleCreateWebhook = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.createWebhook({
        name: whName.trim(),
        url: whUrl.trim(),
        events: whEvents,
      });
      setNewWhSecret(res.signingSecret);
      setWhName('');
      setWhUrl('');
      onToast('success', 'Webhook endpoint registered.');
      await loadTabData();
    } catch (err) {
      if (isBlockedErr(err) && onPlanBlocked) {
        onPlanBlocked(err);
        return;
      }
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to register webhook.'
      );
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      const res = await api.testWebhook(id);
      onToast(
        res.delivery?.ok ? 'success' : 'error',
        res.delivery?.ok
          ? `Webhook responded HTTP ${res.delivery.statusCode}.`
          : `Webhook test failed: ${res.delivery?.responseSnippet || 'No response'}`
      );
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to test webhook.'
      );
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await api.deleteWebhook(id);
      onToast('success', 'Webhook deleted.');
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete webhook.'
      );
    }
  };

  const handleCreateSchedule = async (e: FormEvent) => {
    e.preventDefault();
    const recipients = schRecipients
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      await api.createScheduledReport({
        name: schName.trim(),
        reportType: schReport,
        frequency: schFreq,
        recipients,
      });
      setSchName('');
      onToast('success', 'Scheduled report digest created.');
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to create schedule.'
      );
    }
  };

  const handleRunScheduleNow = async (id: string) => {
    try {
      await api.runScheduledReport(id);
      onToast('success', 'Scheduled digest generated and dispatched.');
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to run scheduled report.'
      );
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    try {
      await api.deleteScheduledReport(id);
      onToast('success', 'Schedule removed.');
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete schedule.'
      );
    }
  };

  const handleRunSweep = async () => {
    setRunningSweep(true);
    try {
      const res = await api.runComplianceSweep(true);
      onToast(
        'success',
        `Sweep completed: ${res.escalatedCount} SLA escalations, ${res.reportsDispatched} digests sent.`
      );
      await loadTabData();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to run compliance sweep.'
      );
    } finally {
      setRunningSweep(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-1 w-fit">
        {(
          [
            { id: 'workspace', label: 'Workspace & Currency', icon: Globe, visible: true },
            { id: 'custom_fields', label: 'Custom Fields', icon: SlidersHorizontal, visible: hasCustomFields },
            { id: 'api_webhooks', label: 'API & Webhooks', icon: Webhook, visible: hasApiWebhooks },
            { id: 'automation', label: 'Scheduled Reports & Email', icon: CalendarClock, visible: true },
          ] as const
        )
          .filter((item) => item.visible)
          .map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[var(--av-accent)] text-white'
                    : 'text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
      </div>

      {/* Tab 1: Workspace & Multi-Currency */}
      {tab === 'workspace' && (
        <form
          onSubmit={handleSaveWorkspace}
          className="max-w-2xl rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-6 shadow-[var(--av-card-shadow)] space-y-5"
        >
          <div>
            <h3 className="font-display text-base font-bold text-[var(--av-text)]">
              Workspace Profile &amp; Operational Currency
            </h3>
            <p className="text-xs text-[var(--av-text-subtle)] mt-1">
              Configure the display currency used across asset valuations, maintenance logs, procurement POs, and financial reports.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--av-text-muted)] mb-1">
                Workspace Name
              </label>
              <input
                type="text"
                required
                value={wsName}
                onChange={(e) => setWsName(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--av-text-muted)] mb-1">
                Operational Currency
              </label>
              <select
                value={wsCurrency}
                onChange={(e) => setWsCurrency(e.target.value as CurrencyCode)}
                className={INPUT_CLASS}
              >
                <option value="USD">USD ($) — US Dollar</option>
                <option value="GHS">GHS (GH₵) — Ghana Cedi</option>
                <option value="EUR">EUR (€) — Euro</option>
                <option value="GBP">GBP (£) — British Pound</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--av-text-muted)] mb-1">
                Country / Region
              </label>
              <input
                type="text"
                value={wsCountry}
                onChange={(e) => setWsCountry(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[var(--av-text-muted)] mb-1">
                IT Operations Support Email
              </label>
              <input
                type="email"
                value={wsEmail}
                onChange={(e) => setWsEmail(e.target.value)}
                className={INPUT_CLASS}
              />
            </div>
          </div>

          {!isReadOnly && (
            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={savingWs}
                className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
              >
                {savingWs ? 'Saving...' : 'Save Workspace Settings'}
              </button>
            </div>
          )}
        </form>
      )}

      {/* Tab 2: Custom Fields Builder */}
      {tab === 'custom_fields' && hasCustomFields && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {!isReadOnly && (
            <form
              onSubmit={handleCreateCustomField}
              className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4 h-fit"
            >
            <div>
              <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                Add Custom Field
              </h3>
              <p className="text-[11px] text-[var(--av-text-subtle)] mt-0.5">
                {hasCustomFields
                  ? 'Fields appear dynamically in entity creation and detail views.'
                  : 'Requires Business or Enterprise plan.'}
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--av-text-muted)] mb-1">
                Target Entity
              </label>
              <select
                value={cfEntity}
                onChange={(e) =>
                  setCfEntity(e.target.value as CustomFieldDef['entityType'])
                }
                className={INPUT_CLASS}
              >
                <option value="asset">IT Asset</option>
                <option value="ticket">Helpdesk Ticket</option>
                <option value="employee">Employee</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--av-text-muted)] mb-1">
                Field Label *
              </label>
              <input
                type="text"
                required
                value={cfLabel}
                onChange={(e) => setCfLabel(e.target.value)}
                placeholder="e.g. BitLocker Key Ref / Lease ID"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[var(--av-text-muted)] mb-1">
                Input Type
              </label>
              <select
                value={cfType}
                onChange={(e) =>
                  setCfType(e.target.value as CustomFieldDef['fieldType'])
                }
                className={INPUT_CLASS}
              >
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown Select</option>
              </select>
            </div>
            {cfType === 'select' && (
              <div>
                <label className="block text-[11px] font-medium text-[var(--av-text-muted)] mb-1">
                  Options (comma-separated)
                </label>
                <input
                  type="text"
                  required
                  value={cfOptions}
                  onChange={(e) => setCfOptions(e.target.value)}
                  placeholder="Tier 1, Tier 2, Executive"
                  className={INPUT_CLASS}
                />
              </div>
            )}
            <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)]">
              <input
                type="checkbox"
                checked={cfRequired}
                onChange={(e) => setCfRequired(e.target.checked)}
              />
              <span>Required on forms</span>
            </label>
            {!isReadOnly && (
              <button
                type="submit"
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Create Field</span>
              </button>
            )}
          </form>
          )}

          <div className={`${isReadOnly ? 'lg:col-span-3' : 'lg:col-span-2'} rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden`}>
            <div className="border-b border-[var(--av-border-subtle)] px-5 py-3.5 flex items-center justify-between">
              <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                Active Custom Fields ({customFields.length})
              </h3>
            </div>
            {customFields.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={SlidersHorizontal}
                  title="No custom fields defined"
                  description="Add custom metadata fields for Assets, Tickets, or Employees to tailor AssetVault to your governance policies."
                />
              </div>
            ) : (
              <div className="divide-y divide-[var(--av-border-subtle)]">
                {customFields.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between px-5 py-3 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-[var(--av-text)]">
                        {f.label}
                        {f.required ? ' *' : ''}
                      </div>
                      <div className="text-[11px] text-[var(--av-text-subtle)] font-mono">
                        {f.entityType} · {f.fieldKey} · {f.fieldType}
                        {f.options?.length ? ` (${f.options.join(', ')})` : ''}
                      </div>
                    </div>
                    {!isReadOnly && (
                      <button
                        type="button"
                        onClick={() => handleDeleteCustomField(f.id)}
                        className="rounded p-1.5 text-[var(--av-text-subtle)] hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: API Keys & Outbound Webhooks */}
      {tab === 'api_webhooks' && hasApiWebhooks && (
        <div className="space-y-6">

          {newPlaintextKey && (
            <div className="rounded-xl border border-emerald-300/60 dark:border-emerald-500/40 bg-emerald-50/60 dark:bg-emerald-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                  New API Key Generated — Copy now (shown once)
                </div>
                <code className="block text-xs font-mono text-[var(--av-text)] break-all">
                  {newPlaintextKey}
                </code>
                <div className="text-[11px] text-[var(--av-text-subtle)]">
                  Use header <code className="font-mono">X-API-Key</code> on{' '}
                  <code className="font-mono">GET /api/v1/assets</code> or{' '}
                  <code className="font-mono">GET /api/v1/tickets</code>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(newPlaintextKey);
                  setCopiedKey(true);
                  setTimeout(() => setCopiedKey(false), 1800);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/50 bg-[var(--av-surface)] px-3 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 shrink-0"
              >
                {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                <span>{copiedKey ? 'Copied' : 'Copy Key'}</span>
              </button>
            </div>
          )}

          {newWhSecret && (
            <div className="rounded-xl border border-blue-300/60 dark:border-blue-500/40 bg-blue-50/60 dark:bg-blue-500/10 p-4">
              <div className="text-xs font-bold text-blue-700 dark:text-blue-300">
                Webhook HMAC Signing Secret (X-AssetVault-Signature)
              </div>
              <code className="mt-1 block text-xs font-mono text-[var(--av-text)] break-all">
                {newWhSecret}
              </code>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* API Keys */}
            <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-[var(--av-accent)]" />
                <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                  REST API Keys
                </h3>
              </div>
              {!isReadOnly && (
                <form onSubmit={handleCreateApiKey} className="flex gap-2">
                  <input
                    type="text"
                    required
                    value={keyName}
                    onChange={(e) => setKeyName(e.target.value)}
                    placeholder="Key label (e.g. PowerBI Sync)"
                    className={INPUT_CLASS}
                  />
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] whitespace-nowrap"
                  >
                    Generate Key
                  </button>
                </form>
              )}
              <div className="divide-y divide-[var(--av-border-subtle)]">
                {apiKeys.length === 0 ? (
                  <p className="text-xs text-[var(--av-text-subtle)] py-2">
                    No API keys created yet.
                  </p>
                ) : (
                  apiKeys.map((k) => (
                    <div
                      key={k.id}
                      className="flex items-center justify-between py-2.5 text-xs"
                    >
                      <div>
                        <div className="font-semibold text-[var(--av-text)]">
                          {k.name}
                          {k.revokedAt ? ' (Revoked)' : ''}
                        </div>
                        <div className="text-[11px] font-mono text-[var(--av-text-subtle)]">
                          {k.keyPrefix}•••••••• · {k.scopes.join(', ')}
                        </div>
                      </div>
                      {!k.revokedAt && !isReadOnly && (
                        <button
                          type="button"
                          onClick={() => handleRevokeKey(k.id)}
                          className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Outbound Webhooks */}
            <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-[var(--av-accent)]" />
                <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                  Outbound Webhooks
                </h3>
              </div>
              {!isReadOnly && (
                <form onSubmit={handleCreateWebhook} className="space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      required
                      value={whName}
                      onChange={(e) => setWhName(e.target.value)}
                      placeholder="Endpoint name"
                      className={INPUT_CLASS}
                    />
                    <input
                      type="url"
                      required
                      value={whUrl}
                      onChange={(e) => setWhUrl(e.target.value)}
                      placeholder="https://hooks.example.com/it"
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--av-text-muted)]">
                    {[
                      'asset.created',
                      'asset.assigned',
                      'ticket.created',
                      'ticket.sla_breached',
                      'po.received',
                    ].map((evt) => (
                      <label key={evt} className="inline-flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={whEvents.includes(evt)}
                          onChange={(e) =>
                            setWhEvents((prev) =>
                              e.target.checked
                                ? [...prev, evt]
                                : prev.filter((x) => x !== evt)
                            )
                          }
                        />
                        <span className="font-mono">{evt}</span>
                      </label>
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                  >
                    Register Webhook
                  </button>
                </form>
              )}

              <div className="divide-y divide-[var(--av-border-subtle)]">
                {webhooks.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between gap-2 py-2.5 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-[var(--av-text)]">{w.name}</div>
                      <div className="truncate font-mono text-[11px] text-[var(--av-text-subtle)]">
                        {w.url}
                      </div>
                    </div>
                    {!isReadOnly && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleTestWebhook(w.id)}
                          className="inline-flex items-center gap-1 rounded border border-[var(--av-border)] px-2 py-1 text-[11px] font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]"
                        >
                          <Send className="h-3 w-3" />
                          <span>Ping</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteWebhook(w.id)}
                          className="rounded p-1 text-[var(--av-text-subtle)] hover:text-red-500"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {deliveries.length > 0 && (
            <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] overflow-hidden">
              <div className="border-b border-[var(--av-border-subtle)] px-5 py-3 text-xs font-bold text-[var(--av-text)]">
                Recent Webhook Deliveries
              </div>
              <div className="divide-y divide-[var(--av-border-subtle)] text-xs">
                {deliveries.slice(0, 10).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between px-5 py-2.5"
                  >
                    <div className="font-mono text-[var(--av-text)]">
                      {d.event} ·{' '}
                      <span
                        className={
                          d.ok
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }
                      >
                        {d.statusCode ? `HTTP ${d.statusCode}` : 'Error'}
                      </span>{' '}
                      — <span className="text-[var(--av-text-subtle)]">{d.responseSnippet}</span>
                    </div>
                    <span className="text-[11px] text-[var(--av-text-subtle)] tabular-nums">
                      {d.deliveredAt.slice(0, 19).replace('T', ' ')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Scheduled Reports & Email Outbox */}
      {tab === 'automation' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4">
            <div>
              <div className="text-xs font-bold text-[var(--av-text)]">
                Automated Background Scheduler
              </div>
              <p className="text-[11px] text-[var(--av-text-subtle)]">
                Runs SLA breach escalations, licence/contract expiry updates, and scheduled email digests every 15 minutes or on demand.
              </p>
            </div>
            {!isReadOnly && (
              <button
                type="button"
                disabled={runningSweep}
                onClick={handleRunSweep}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" />
                <span>{runningSweep ? 'Running Sweep...' : 'Run Sweep & Digests Now'}</span>
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {!isReadOnly && (
              <form
                onSubmit={handleCreateSchedule}
                className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3.5 h-fit"
              >
                <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
                  Schedule Report Digest
                </h3>
                <div>
                  <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                    Digest Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={schName}
                    onChange={(e) => setSchName(e.target.value)}
                    placeholder="Weekly Executive Asset Summary"
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Report Type
                    </label>
                    <select
                      value={schReport}
                      onChange={(e) =>
                        setSchReport(
                          e.target.value as ScheduledReportConfig['reportType']
                        )
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="inventory">Inventory</option>
                      <option value="depreciation">Depreciation</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="warranty">Warranty Risk</option>
                      <option value="tickets">Helpdesk SLA</option>
                      <option value="licences">Software Licences</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                      Cadence
                    </label>
                    <select
                      value={schFreq}
                      onChange={(e) =>
                        setSchFreq(
                          e.target.value as ScheduledReportConfig['frequency']
                        )
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                    Recipient Emails (comma-separated) *
                  </label>
                  <input
                    type="text"
                    required
                    value={schRecipients}
                    onChange={(e) => setSchRecipients(e.target.value)}
                    placeholder="cio@company.com, finance@company.com"
                    className={INPUT_CLASS}
                  />
                </div>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)]"
                >
                  Save Schedule
                </button>
              </form>
            )}

            <div className={`${isReadOnly ? 'lg:col-span-3' : 'lg:col-span-2'} space-y-4`}>
              <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] overflow-hidden">
                <div className="border-b border-[var(--av-border-subtle)] px-5 py-3 text-xs font-bold text-[var(--av-text)]">
                  Configured Report Schedules ({schedules.length})
                </div>
                {schedules.length === 0 ? (
                  <div className="p-5 text-xs text-[var(--av-text-subtle)]">
                    No recurring report schedules configured yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--av-border-subtle)]">
                    {schedules.map((s) => (
                      <div
                        key={s.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-[var(--av-text)]">
                            {s.name}
                          </div>
                          <div className="text-[11px] text-[var(--av-text-subtle)]">
                            {s.reportType} · {s.frequency} · To: {s.recipients.join(', ')} · Next:{' '}
                            {s.nextRunAt.slice(0, 10)}
                          </div>
                        </div>
                        {!isReadOnly && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleRunScheduleNow(s.id)}
                              className="inline-flex items-center gap-1 rounded border border-[var(--av-border)] px-2.5 py-1 text-[11px] font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]"
                            >
                              <Send className="h-3 w-3" />
                              <span>Send Now</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteSchedule(s.id)}
                              className="rounded p-1 text-[var(--av-text-subtle)] hover:text-red-500"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] overflow-hidden">
                <div className="border-b border-[var(--av-border-subtle)] px-5 py-3 flex items-center gap-2 text-xs font-bold text-[var(--av-text)]">
                  <Mail className="h-3.5 w-3.5 text-[var(--av-accent)]" />
                  <span>Transactional Email Outbox ({outbox.length})</span>
                </div>
                {outbox.length === 0 ? (
                  <div className="p-5 text-xs text-[var(--av-text-subtle)]">
                    No outbound emails logged in this workspace yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--av-border-subtle)] text-xs max-h-72 overflow-y-auto">
                    {outbox.map((m) => (
                      <div key={m.id} className="px-5 py-2.5 space-y-0.5">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-[var(--av-text)]">
                            {m.subject}
                          </span>
                          <span
                            className={`text-[10px] font-semibold uppercase ${
                              m.status === 'sent'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : m.status === 'failed'
                                  ? 'text-red-600 dark:text-red-400'
                                  : 'text-blue-600 dark:text-blue-400'
                            }`}
                          >
                            {m.status === 'logged_local' ? 'Local Outbox' : m.status}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--av-text-subtle)]">
                          To: {m.to} · {m.sentAt.slice(0, 19).replace('T', ' ')}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
