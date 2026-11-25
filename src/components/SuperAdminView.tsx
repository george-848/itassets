import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Building2,
  CreditCard,
  Crown,
  Pencil,
  Plus,
  RotateCcw,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type {
  AuditLogEntry,
  BillingCycle,
  FeatureKey,
  PaymentTransaction,
  PlanCode,
  PlatformSettings,
  SubscriptionPlan,
  Tenant,
  TenantSubscription,
} from '../types/saas.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { formatGhs, formatGhsExact } from './StatusText.tsx';

interface SuperAdminViewProps {
  onRefreshContext: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

type AdminTab = 'tenants' | 'plans' | 'payments' | 'settings';

const INPUT_CLASS =
  'w-full rounded-lg border border-[var(--av-border)] bg-[var(--av-surface-muted)] px-3 py-2 text-sm text-[var(--av-text)] placeholder:text-[var(--av-text-subtle)] focus:bg-[var(--av-surface)] focus:border-[var(--av-accent)] focus:outline-none focus:ring-3 focus:ring-[var(--av-accent-soft)]';

const ALL_FEATURES: FeatureKey[] = [
  'msp_mode',
  'helpdesk',
  'itsm_suite',
  'sla_automation',
  'software_licences',
  'procurement',
  'knowledge_base',
  'bulk_import',
  'qr_barcode',
  'audit_logs',
  'custom_fields',
  'api_webhooks',
  'sso_scim',
  'dedicated_deployment',
];

export function SuperAdminView({ onRefreshContext, onToast }: SuperAdminViewProps) {
  const [tab, setTab] = useState<AdminTab>('tenants');
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<{
    totalTenants: number;
    companyTenants: number;
    mspTenants: number;
    activeSubscriptions: number;
    trialTenants: number;
    totalUsers: number;
    totalAssets: number;
    mrrGhs: number;
    arrGhs: number;
    totalRevenueGhs: number;
  } | null>(null);
  const [tenants, setTenants] = useState<
    Array<{
      tenant: Tenant;
      subscription: TenantSubscription | null;
      orgCount: number;
      userCount: number;
      assetCount: number;
    }>
  >([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  // Edit Tenant Modal
  const [editTenant, setEditTenant] = useState<{
    tenant: Tenant;
    subscription: TenantSubscription | null;
  } | null>(null);
  const [tStatus, setTStatus] = useState<Tenant['status']>('active');
  const [tPlan, setTPlan] = useState<PlanCode>('professional');
  const [tSubStatus, setTSubStatus] = useState<TenantSubscription['status']>('active');
  const [tDeployMode, setTDeployMode] = useState<Tenant['deploymentMode']>('shared_cloud');
  const [tCustomDomain, setTCustomDomain] = useState('');
  const [tDedicatedProject, setTDedicatedProject] = useState('');
  const [deleteTenantTarget, setDeleteTenantTarget] = useState<Tenant | null>(null);
  const [deletingTenant, setDeletingTenant] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resettingDb, setResettingDb] = useState(false);

  // Edit Plan Modal
  const [editPlan, setEditPlan] = useState<SubscriptionPlan | null>(null);
  const [pMonthly, setPMonthly] = useState('0');
  const [pAnnual, setPAnnual] = useState('0');
  const [pMaxAssets, setPMaxAssets] = useState('');
  const [pMaxUsers, setPMaxUsers] = useState('');
  const [pFeatures, setPFeatures] = useState<FeatureKey[]>([]);

  // Manual Payment & Refund
  const [manualOpen, setManualOpen] = useState(false);
  const [mTenantId, setMTenantId] = useState('');
  const [mPlan, setMPlan] = useState<PlanCode>('business');
  const [mCycle, setMCycle] = useState<BillingCycle>('monthly');
  const [mAmount, setMAmount] = useState('699');

  const [refundTarget, setRefundTarget] = useState<PaymentTransaction | null>(null);
  const [refundReason, setRefundReason] = useState('');

  const loadOverview = async () => {
    setLoading(true);
    try {
      const res = await api.getPlatformOverview();
      setKpis(res.kpis);
      setTenants(res.tenants);
      setPlans(res.plans);
      setPayments(res.payments);
      setSettings(res.settings);
      setAuditLogs(res.platformAuditLogs);
      if (res.tenants[0] && !mTenantId) {
        setMTenantId(res.tenants[0].tenant.id);
      }
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load Super Admin overview.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOverview();
  }, []);

  const openTenantEditor = (row: {
    tenant: Tenant;
    subscription: TenantSubscription | null;
  }) => {
    setEditTenant(row);
    setTStatus(row.tenant.status);
    setTPlan(row.tenant.planCode);
    setTSubStatus(row.subscription?.status || 'active');
    setTDeployMode(row.tenant.deploymentMode);
    setTCustomDomain(row.tenant.dedicatedConfig?.customDomain || '');
    setTDedicatedProject(row.tenant.dedicatedConfig?.dedicatedProjectId || '');
  };

  const handleSaveTenant = async (e: FormEvent) => {
    e.preventDefault();
    if (!editTenant) return;
    try {
      await api.updatePlatformTenant(editTenant.tenant.id, {
        status: tStatus,
        planCode: tPlan,
        subscriptionStatus: tSubStatus,
        deploymentMode: tDeployMode,
        dedicatedConfig:
          tDeployMode === 'dedicated_enterprise'
            ? {
                customDomain: tCustomDomain.trim() || undefined,
                dedicatedProjectId: tDedicatedProject.trim() || undefined,
                isolationTier: 'dedicated_cluster',
              }
            : undefined,
      });
      onToast('success', `Updated tenant ${editTenant.tenant.name}.`);
      setEditTenant(null);
      await Promise.all([loadOverview(), onRefreshContext()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to update tenant.'
      );
    }
  };

  const handleConfirmDeleteTenant = async () => {
    if (!deleteTenantTarget) return;
    setDeletingTenant(true);
    try {
      await api.deletePlatformTenant(deleteTenantTarget.id);
      onToast(
        'success',
        `Tenant workspace "${deleteTenantTarget.name}" permanently deleted.`
      );
      setDeleteTenantTarget(null);
      await Promise.all([loadOverview(), onRefreshContext()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to delete tenant.'
      );
    } finally {
      setDeletingTenant(false);
    }
  };

  const handleResetDatabase = async (e: FormEvent) => {
    e.preventDefault();
    if (resetConfirmText.trim() !== 'RESET_ALL_DATA') return;
    setResettingDb(true);
    try {
      const res = await api.resetPlatformDatabase('RESET_ALL_DATA');
      onToast('success', res.message);
      setResetConfirmText('');
      await Promise.all([loadOverview(), onRefreshContext()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to reset database.'
      );
    } finally {
      setResettingDb(false);
    }
  };

  const openPlanEditor = (plan: SubscriptionPlan) => {
    setEditPlan(plan);
    setPMonthly(String(plan.monthlyPriceGhs));
    setPAnnual(String(plan.annualPriceGhs));
    setPMaxAssets(plan.limits.maxAssets === null ? '' : String(plan.limits.maxAssets));
    setPMaxUsers(plan.limits.maxUsers === null ? '' : String(plan.limits.maxUsers));
    setPFeatures(plan.features);
  };

  const handleSavePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!editPlan) return;
    try {
      await api.updatePlatformPlan(editPlan.code, {
        monthlyPriceGhs: Math.max(0, Number(pMonthly) || 0),
        annualPriceGhs: Math.max(0, Number(pAnnual) || 0),
        limits: {
          ...editPlan.limits,
          maxAssets: pMaxAssets.trim() === '' ? null : Math.max(1, Number(pMaxAssets)),
          maxUsers: pMaxUsers.trim() === '' ? null : Math.max(1, Number(pMaxUsers)),
        },
        features: pFeatures,
      });
      onToast('success', `Updated ${editPlan.name} plan.`);
      setEditPlan(null);
      await Promise.all([loadOverview(), onRefreshContext()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to update plan.'
      );
    }
  };

  const handleManualPayment = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.recordManualPayment({
        tenantId: mTenantId,
        planCode: mPlan,
        billingCycle: mCycle,
        amountGhs: Math.max(0, Number(mAmount) || 0),
      });
      onToast('success', 'Manual payment recorded & tenant activated.');
      setManualOpen(false);
      await loadOverview();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to record manual payment.'
      );
    }
  };

  const handleRefund = async (e: FormEvent) => {
    e.preventDefault();
    if (!refundTarget) return;
    try {
      await api.refundPayment(refundTarget.id, refundReason.trim() || 'Admin refund');
      onToast('success', `Payment ${refundTarget.reference} refunded.`);
      setRefundTarget(null);
      setRefundReason('');
      await loadOverview();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Refund failed.'
      );
    }
  };

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    try {
      await api.updatePlatformSettings({
        platformName: settings.platformName,
        supportEmail: settings.supportEmail,
        trialDays: settings.trialDays,
        gracePeriodDays: settings.gracePeriodDays,
        maintenanceMode: settings.maintenanceMode,
      });
      onToast('success', 'Platform settings updated.');
      await loadOverview();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to update settings.'
      );
    }
  };

  return (
    <div className="space-y-5">
      {/* Platform KPI Strip */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
            <div className="text-xs text-[var(--av-text-subtle)]">Platform MRR / ARR</div>
            <div className="mt-1 font-display text-xl font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
              {formatGhs(kpis.mrrGhs)}{' '}
              <span className="text-xs font-normal text-[var(--av-text-subtle)]">
                ({formatGhs(kpis.arrGhs)}/yr)
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
            <div className="text-xs text-[var(--av-text-subtle)]">Workspaces (Company / MSP)</div>
            <div className="mt-1 font-display text-xl font-bold text-[var(--av-text)] tabular-nums">
              {kpis.totalTenants}{' '}
              <span className="text-xs font-normal text-[var(--av-text-subtle)]">
                ({kpis.companyTenants} Co · {kpis.mspTenants} MSP)
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
            <div className="text-xs text-[var(--av-text-subtle)]">Active / Trial Tenants</div>
            <div className="mt-1 font-display text-xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
              {kpis.activeSubscriptions} / {kpis.trialTenants}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
            <div className="text-xs text-[var(--av-text-subtle)]">Total Platform Assets &amp; Users</div>
            <div className="mt-1 font-display text-xl font-bold text-[var(--av-text)] tabular-nums">
              {kpis.totalAssets} assets · {kpis.totalUsers} users
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-4 shadow-[var(--av-card-shadow)]">
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              { id: 'tenants', label: `Tenants (${tenants.length})`, icon: Building2 },
              { id: 'plans', label: `GH₵ Plans (${plans.length})`, icon: Crown },
              { id: 'payments', label: `Payments & Refunds (${payments.length})`, icon: CreditCard },
              { id: 'settings', label: 'Platform Settings & Audit', icon: Settings },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                  tab === item.id
                    ? 'bg-[var(--av-accent)] text-white'
                    : 'bg-[var(--av-surface-muted)] text-[var(--av-text-muted)] hover:text-[var(--av-text)]'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {tab === 'payments' && (
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
          >
            <Plus className="h-4 w-4" />
            <span>Record Manual Payment</span>
          </button>
        )}
      </div>

      {loading ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-10 text-center text-xs text-[var(--av-text-subtle)]">
          Loading Super Admin control plane...
        </div>
      ) : tab === 'tenants' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                  <th className="py-3 px-4">Tenant &amp; Mode</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Plan &amp; Sub</th>
                  <th className="py-3 px-4">Usage (Orgs / Users / Assets)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Governance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                {tenants.map((row) => (
                  <tr key={row.tenant.id} className="hover:bg-[var(--av-surface-hover)]">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--av-text)]">{row.tenant.name}</div>
                      <div className="text-[11px] font-mono text-[var(--av-text-subtle)]">
                        {row.tenant.slug} · {row.tenant.deploymentMode}
                      </div>
                    </td>
                    <td className="py-3 px-4 uppercase font-mono text-[var(--av-text-muted)]">
                      {row.tenant.type}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-[var(--av-accent)] capitalize">
                        {row.tenant.planCode}
                      </div>
                      <div className="text-[11px] text-[var(--av-text-subtle)]">
                        {row.subscription?.status || '—'}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-[var(--av-text-muted)]">
                      {row.orgCount} orgs · {row.userCount} users · {row.assetCount} assets
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-semibold ${
                          row.tenant.status === 'active'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : row.tenant.status === 'suspended'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {row.tenant.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openTenantEditor(row)}
                          className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] px-3 py-1.5 text-xs font-semibold text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>Manage</span>
                        </button>
                        {row.tenant.id !== 'ten-default-01' && (
                          <button
                            type="button"
                            onClick={() => setDeleteTenantTarget(row.tenant)}
                            title="Delete registered tenant workspace"
                            className="p-1.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-500/15 transition-colors"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : tab === 'plans' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="font-display text-base font-bold text-[var(--av-text)]">
                    {p.name} ({p.code})
                  </h4>
                  <p className="text-xs text-[var(--av-text-subtle)]">{p.tagline}</p>
                </div>
                <button
                  type="button"
                  onClick={() => openPlanEditor(p)}
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] px-3 py-1.5 text-xs font-semibold"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </button>
              </div>
              <div className="flex gap-6 text-xs font-mono tabular-nums">
                <span>Monthly: {formatGhsExact(p.monthlyPriceGhs)}</span>
                <span>Annual: {formatGhsExact(p.annualPriceGhs)}</span>
              </div>
              <div className="text-xs text-[var(--av-text-muted)]">
                Limits: Assets={p.limits.maxAssets ?? '∞'} · Users={p.limits.maxUsers ?? '∞'} ·
                Orgs={p.limits.maxClientOrgs ?? '∞'} · Features={p.features.length}
              </div>
            </div>
          ))}
        </div>
      ) : tab === 'payments' ? (
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--av-border)] bg-[var(--av-surface-muted)] text-xs font-semibold text-[var(--av-text-muted)]">
                  <th className="py-3 px-4">Reference</th>
                  <th className="py-3 px-4">Tenant ID</th>
                  <th className="py-3 px-4">Plan / Provider</th>
                  <th className="py-3 px-4 text-right">Amount (GH₵)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--av-border-subtle)] text-xs">
                {payments.map((pay) => (
                  <tr key={pay.id} className="hover:bg-[var(--av-surface-hover)]">
                    <td className="py-3 px-4 font-mono font-semibold text-[var(--av-accent)]">
                      {pay.reference}
                    </td>
                    <td className="py-3 px-4 font-mono text-[var(--av-text-muted)]">
                      {pay.tenantId}
                    </td>
                    <td className="py-3 px-4 text-[var(--av-text-muted)]">
                      {pay.planCode} ({pay.billingCycle}) · {pay.provider}
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums">
                      {formatGhsExact(pay.amountGhs)}
                    </td>
                    <td className="py-3 px-4 font-semibold">{pay.status}</td>
                    <td className="py-3 px-4 text-right">
                      {pay.status === 'success' && (
                        <button
                          type="button"
                          onClick={() => setRefundTarget(pay)}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-300/60 px-2.5 py-1 text-xs font-semibold text-rose-600 dark:text-rose-400"
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Refund</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {settings && (
            <form
              onSubmit={handleSaveSettings}
              className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-4"
            >
              <h4 className="font-display text-sm font-bold text-[var(--av-text)]">
                Global Platform Settings
              </h4>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                    Platform Name
                  </label>
                  <input
                    type="text"
                    value={settings.platformName}
                    onChange={(e) =>
                      setSettings({ ...settings, platformName: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                    Support Email
                  </label>
                  <input
                    type="email"
                    value={settings.supportEmail}
                    onChange={(e) =>
                      setSettings({ ...settings, supportEmail: e.target.value })
                    }
                    className={INPUT_CLASS}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Default Trial Days
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={settings.trialDays}
                      onChange={(e) =>
                        setSettings({ ...settings, trialDays: Number(e.target.value) })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Grace Period Days
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={settings.gracePeriodDays}
                      onChange={(e) =>
                        setSettings({ ...settings, gracePeriodDays: Number(e.target.value) })
                      }
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-4 text-xs text-[var(--av-text-muted)] pt-1">
                  <span>
                    Paystack Key: <strong>{settings.paystackConfigured ? 'Configured' : 'Simulation'}</strong>
                  </span>
                  <span>
                    SMTP: <strong>{settings.smtpConfigured ? 'Configured' : 'Local Console'}</strong>
                  </span>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)]">
                  <input
                    type="checkbox"
                    checked={settings.maintenanceMode}
                    onChange={(e) =>
                      setSettings({ ...settings, maintenanceMode: e.target.checked })
                    }
                  />
                  <span>Platform Maintenance Mode</span>
                </label>
              </div>
              <button
                type="submit"
                className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
              >
                Save Platform Settings
              </button>
            </form>
          )}

          {settings && (
            <form
              onSubmit={handleResetDatabase}
              className="rounded-xl border border-rose-300/60 dark:border-rose-500/30 bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3"
            >
              <h4 className="font-display text-sm font-bold text-rose-700 dark:text-rose-400">
                Clean Start · Reset Platform Database
              </h4>
              <p className="text-xs leading-relaxed text-[var(--av-text-muted)]">
                Permanently clear all registered tenants, client organisations, sites,
                assets, employees, assignments, maintenance logs, tickets, payments, and
                non-bootstrap users, restoring the clean starter workspace.
              </p>
              <input
                type="text"
                value={resetConfirmText}
                onChange={(e) => setResetConfirmText(e.target.value)}
                placeholder='Type "RESET_ALL_DATA" to confirm'
                className={`${INPUT_CLASS} font-mono`}
              />
              <button
                type="submit"
                disabled={resettingDb || resetConfirmText.trim() !== 'RESET_ALL_DATA'}
                className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {resettingDb ? 'Clearing Database...' : 'Clear All Data & Reset'}
              </button>
            </form>
          )}

          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
            <div className="border-b border-[var(--av-border-subtle)] px-5 py-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
              Platform Governance Audit ({auditLogs.length})
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-[var(--av-border-subtle)] text-xs">
              {auditLogs.map((l) => (
                <div key={l.id} className="p-3.5 space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-[var(--av-accent)]">
                      {l.action}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--av-text-subtle)]">
                      {l.createdAt.slice(0, 16).replace('T', ' ')}
                    </span>
                  </div>
                  <div className="text-[var(--av-text)]">{l.summary}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Tenant Modal */}
      <AnimatePresence>
        {editTenant && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Manage Tenant · {editTenant.tenant.name}
                </h3>
                <button type="button" onClick={() => setEditTenant(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleSaveTenant} className="p-6 space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Tenant Status
                    </label>
                    <select
                      value={tStatus}
                      onChange={(e) => setTStatus(e.target.value as Tenant['status'])}
                      className={INPUT_CLASS}
                    >
                      <option value="active">Active</option>
                      <option value="trial">Trial</option>
                      <option value="grace">Grace</option>
                      <option value="suspended">Suspended</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Assigned Plan
                    </label>
                    <select
                      value={tPlan}
                      onChange={(e) => setTPlan(e.target.value as PlanCode)}
                      className={INPUT_CLASS}
                    >
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Subscription Status
                    </label>
                    <select
                      value={tSubStatus}
                      onChange={(e) =>
                        setTSubStatus(e.target.value as TenantSubscription['status'])
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="active">Active</option>
                      <option value="trialing">Trialing</option>
                      <option value="grace_period">Grace Period</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Deployment Topology
                    </label>
                    <select
                      value={tDeployMode}
                      onChange={(e) =>
                        setTDeployMode(e.target.value as Tenant['deploymentMode'])
                      }
                      className={INPUT_CLASS}
                    >
                      <option value="shared_cloud">Shared Cloud</option>
                      <option value="dedicated_enterprise">Dedicated Enterprise</option>
                    </select>
                  </div>
                </div>
                {tDeployMode === 'dedicated_enterprise' && (
                  <div className="space-y-2.5 rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/50 p-3">
                    <input
                      type="text"
                      value={tCustomDomain}
                      onChange={(e) => setTCustomDomain(e.target.value)}
                      placeholder="Custom Domain (e.g. itam.enterprise.com)"
                      className={INPUT_CLASS}
                    />
                    <input
                      type="text"
                      value={tDedicatedProject}
                      onChange={(e) => setTDedicatedProject(e.target.value)}
                      placeholder="Dedicated GCP Project / Cluster ID"
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setEditTenant(null)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Changes
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Plan Modal */}
      <AnimatePresence>
        {editPlan && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Edit Plan · {editPlan.name}
                </h3>
                <button type="button" onClick={() => setEditPlan(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleSavePlan} className="overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Monthly (GH₵)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={pMonthly}
                      onChange={(e) => setPMonthly(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Annual (GH₵)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={pAnnual}
                      onChange={(e) => setPAnnual(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Max Assets (empty = Unlimited)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pMaxAssets}
                      onChange={(e) => setPMaxAssets(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Max Users (empty = Unlimited)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pMaxUsers}
                      onChange={(e) => setPMaxUsers(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                </div>
                <div>
                  <div className="text-xs font-medium text-[var(--av-text-muted)] mb-2">
                    Enabled SaaS Features
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {ALL_FEATURES.map((feat) => (
                      <label key={feat} className="inline-flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pFeatures.includes(feat)}
                          onChange={(e) => {
                            setPFeatures((prev) =>
                              e.target.checked
                                ? [...prev, feat]
                                : prev.filter((x) => x !== feat)
                            );
                          }}
                        />
                        <span className="font-mono text-[11px]">{feat}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-[var(--av-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setEditPlan(null)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Save Plan
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Record Manual Payment Modal */}
      <AnimatePresence>
        {manualOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Record Manual Payment (GH₵)
                </h3>
                <button type="button" onClick={() => setManualOpen(false)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleManualPayment} className="p-6 space-y-3.5">
                <select
                  value={mTenantId}
                  onChange={(e) => setMTenantId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  {tenants.map((t) => (
                    <option key={t.tenant.id} value={t.tenant.id}>
                      {t.tenant.name}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-3">
                  <select
                    value={mPlan}
                    onChange={(e) => setMPlan(e.target.value as PlanCode)}
                    className={INPUT_CLASS}
                  >
                    {plans.map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mCycle}
                    onChange={(e) => setMCycle(e.target.value as BillingCycle)}
                    className={INPUT_CLASS}
                  >
                    <option value="monthly">Monthly</option>
                    <option value="annual">Annual</option>
                  </select>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={mAmount}
                  onChange={(e) => setMAmount(e.target.value)}
                  placeholder="Amount received (GH₵)"
                  className={`${INPUT_CLASS} font-mono`}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setManualOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white"
                  >
                    Record &amp; Activate
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Refund Modal */}
      <AnimatePresence>
        {refundTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                  Refund {refundTarget.reference}
                </h3>
                <button type="button" onClick={() => setRefundTarget(null)}>
                  <X className="h-4 w-4 text-[var(--av-text-subtle)]" />
                </button>
              </div>
              <form onSubmit={handleRefund} className="p-6 space-y-3.5">
                <p className="text-xs text-[var(--av-text-muted)]">
                  Mark payment of <strong>{formatGhsExact(refundTarget.amountGhs)}</strong> as
                  refunded and update the associated invoice.
                </p>
                <input
                  type="text"
                  required
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="Refund reason..."
                  className={INPUT_CLASS}
                />
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setRefundTarget(null)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Confirm Refund
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={Boolean(deleteTenantTarget)}
        title="Delete Tenant Workspace"
        description={`Permanently delete "${deleteTenantTarget?.name}" (${deleteTenantTarget?.type}) and all of its client organisations, sites, assets, employees, tickets, and exclusive user accounts? This cannot be undone.`}
        confirmLabel="Delete Tenant"
        loading={deletingTenant}
        onConfirm={handleConfirmDeleteTenant}
        onCancel={() => setDeleteTenantTarget(null)}
      />
    </div>
  );
}
