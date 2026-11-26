import { useEffect, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Building2,
  CreditCard,
  Crown,
  Database,
  Flame,
  Layers,
  Mail,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { api, ApiError } from '../lib/api.ts';
import type {
  AuditLogEntry,
  BillingCycle,
  EmailOutboxEntry,
  FeatureKey,
  PaymentTransaction,
  PlanCode,
  PlatformSettings,
  SubscriptionPlan,
  Tenant,
  TenantSubscription,
  TenantType,
} from '../types/saas.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { PlatformDatabaseTab } from './PlatformDatabaseTab.tsx';
import { PlatformFirestoreTab } from './PlatformFirestoreTab.tsx';
import { formatGhs, formatGhsExact } from './StatusText.tsx';

interface SuperAdminViewProps {
  onRefreshContext: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

type AdminTab = 'tenants' | 'plans' | 'payments' | 'database' | 'firestore' | 'settings';

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
  const [outbox, setOutbox] = useState<EmailOutboxEntry[]>([]);
  const [testEmailTo, setTestEmailTo] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  // Register Tenant Modal
  const [createTenantOpen, setCreateTenantOpen] = useState(false);
  const [newTenantType, setNewTenantType] = useState<TenantType>('company');
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCountry, setNewCountry] = useState('Ghana');
  const [newIndustry, setNewIndustry] = useState('Enterprise IT');
  const [newPrimaryOrgName, setNewPrimaryOrgName] = useState('');
  const [newPrimaryOrgCode, setNewPrimaryOrgCode] = useState('HQ-01');
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerPassword, setNewOwnerPassword] = useState('');
  const [newPlanCode, setNewPlanCode] = useState<PlanCode>('professional');
  const [newBillingCycle, setNewBillingCycle] = useState<BillingCycle>('monthly');
  const [newSubStatus, setNewSubStatus] = useState<'active' | 'trialing'>('active');
  const [newTrialDays, setNewTrialDays] = useState('14');
  const [newDeployMode, setNewDeployMode] =
    useState<Tenant['deploymentMode']>('shared_cloud');
  const [newCustomDomain, setNewCustomDomain] = useState('');
  const [newDedicatedProject, setNewDedicatedProject] = useState('');
  const [newRecordPayment, setNewRecordPayment] = useState(true);
  const [creatingTenant, setCreatingTenant] = useState(false);
  const [createTenantError, setCreateTenantError] = useState<string | null>(null);

  // Edit Plan Modal
  const [editPlan, setEditPlan] = useState<SubscriptionPlan | null>(null);
  const [pTagline, setPTagline] = useState('');
  const [pMonthly, setPMonthly] = useState('0');
  const [pAnnual, setPAnnual] = useState('0');
  const [pMaxAssets, setPMaxAssets] = useState('');
  const [pMaxUsers, setPMaxUsers] = useState('');
  const [pMaxLocations, setPMaxLocations] = useState('');
  const [pMaxClientOrgs, setPMaxClientOrgs] = useState('');
  const [pMaxTicketsPerMonth, setPMaxTicketsPerMonth] = useState('');
  const [pMaxStorageMb, setPMaxStorageMb] = useState('');
  const [pIsPublic, setPIsPublic] = useState(true);
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
      const [res, outboxRes] = await Promise.all([
        api.getPlatformOverview(),
        api.getPlatformEmailOutbox().catch(() => ({ outbox: [] as EmailOutboxEntry[] })),
      ]);
      setKpis(res.kpis);
      setTenants(res.tenants);
      setPlans(res.plans);
      setPayments(res.payments);
      setSettings(res.settings);
      setAuditLogs(res.platformAuditLogs);
      setOutbox(outboxRes.outbox);
      if (res.tenants[0] && !mTenantId) {
        setMTenantId(res.tenants[0].tenant.id);
      }
      if (res.settings?.supportEmail && !testEmailTo) {
        setTestEmailTo(res.settings.supportEmail);
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

  const openCreateTenantModal = () => {
    setCreateTenantError(null);
    setNewTenantType('company');
    setNewCompanyName('');
    setNewCountry('Ghana');
    setNewIndustry('Enterprise IT');
    setNewPrimaryOrgName('');
    setNewPrimaryOrgCode('HQ-01');
    setNewOwnerName('');
    setNewOwnerEmail('');
    setNewOwnerPassword('');
    setNewPlanCode('professional');
    setNewBillingCycle('monthly');
    setNewSubStatus('active');
    setNewTrialDays(String(settings?.trialDays || 14));
    setNewDeployMode('shared_cloud');
    setNewCustomDomain('');
    setNewDedicatedProject('');
    setNewRecordPayment(true);
    setCreateTenantOpen(true);
  };

  const handleCreateTenant = async (e: FormEvent) => {
    e.preventDefault();
    setCreateTenantError(null);
    setCreatingTenant(true);
    try {
      const res = await api.createPlatformTenant({
        companyName: newCompanyName.trim(),
        tenantType: newTenantType,
        ownerEmail: newOwnerEmail.trim(),
        ownerName: newOwnerName.trim() || undefined,
        ownerPassword: newOwnerPassword || undefined,
        country: newCountry.trim() || 'Ghana',
        industry: newIndustry.trim() || 'Enterprise IT',
        primaryClientName: newPrimaryOrgName.trim() || undefined,
        primaryClientCode: newPrimaryOrgCode.trim().toUpperCase() || undefined,
        planCode: newPlanCode,
        billingCycle: newBillingCycle,
        subscriptionStatus: newSubStatus,
        trialDays: newSubStatus === 'trialing' ? Math.max(1, Number(newTrialDays) || 14) : undefined,
        deploymentMode: newDeployMode,
        customDomain:
          newDeployMode === 'dedicated_enterprise' ? newCustomDomain.trim() : undefined,
        dedicatedProjectId:
          newDeployMode === 'dedicated_enterprise'
            ? newDedicatedProject.trim()
            : undefined,
        recordInitialPayment: newSubStatus === 'active' ? newRecordPayment : false,
      });
      onToast(
        'success',
        `Registered ${res.tenant.type === 'msp' ? 'MSP Multi-Client' : 'Company IT'} workspace "${res.tenant.name}" (${res.subscription.planCode} · ${res.subscription.status}).`
      );
      setCreateTenantOpen(false);
      await Promise.all([loadOverview(), onRefreshContext()]);
    } catch (err) {
      setCreateTenantError(
        err instanceof ApiError ? err.message : 'Failed to register tenant workspace.'
      );
    } finally {
      setCreatingTenant(false);
    }
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
    setPTagline(plan.tagline || '');
    setPMonthly(String(plan.monthlyPriceGhs));
    setPAnnual(String(plan.annualPriceGhs));
    setPMaxAssets(plan.limits.maxAssets === null ? '' : String(plan.limits.maxAssets));
    setPMaxUsers(plan.limits.maxUsers === null ? '' : String(plan.limits.maxUsers));
    setPMaxLocations(
      plan.limits.maxLocations === null ? '' : String(plan.limits.maxLocations)
    );
    setPMaxClientOrgs(
      plan.limits.maxClientOrgs === null ? '' : String(plan.limits.maxClientOrgs)
    );
    setPMaxTicketsPerMonth(
      plan.limits.maxTicketsPerMonth === null
        ? ''
        : String(plan.limits.maxTicketsPerMonth)
    );
    setPMaxStorageMb(
      plan.limits.maxStorageMb === null || plan.limits.maxStorageMb === undefined
        ? ''
        : String(plan.limits.maxStorageMb)
    );
    setPIsPublic(plan.isPublic);
    setPFeatures(plan.features);
  };

  const handleSavePlan = async (e: FormEvent) => {
    e.preventDefault();
    if (!editPlan) return;
    try {
      await api.updatePlatformPlan(editPlan.code, {
        tagline: pTagline.trim(),
        isPublic: pIsPublic,
        monthlyPriceGhs: Math.max(0, Number(pMonthly) || 0),
        annualPriceGhs: Math.max(0, Number(pAnnual) || 0),
        limits: {
          ...editPlan.limits,
          maxAssets: pMaxAssets.trim() === '' ? null : Math.max(1, Number(pMaxAssets)),
          maxUsers: pMaxUsers.trim() === '' ? null : Math.max(1, Number(pMaxUsers)),
          maxLocations:
            pMaxLocations.trim() === '' ? null : Math.max(1, Number(pMaxLocations)),
          maxClientOrgs:
            pMaxClientOrgs.trim() === '' ? null : Math.max(1, Number(pMaxClientOrgs)),
          maxTicketsPerMonth:
            pMaxTicketsPerMonth.trim() === ''
              ? null
              : Math.max(1, Number(pMaxTicketsPerMonth)),
          maxStorageMb:
            pMaxStorageMb.trim() === '' ? null : Math.max(1, Number(pMaxStorageMb)),
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

  const handleSendTestEmail = async (e: FormEvent) => {
    e.preventDefault();
    if (!testEmailTo.trim()) return;
    setSendingTestEmail(true);
    try {
      const res = await api.sendPlatformTestEmail(testEmailTo.trim());
      onToast(
        'success',
        `Test email dispatched via ${
          res.entry.status === 'sent'
            ? 'SMTP'
            : res.entry.status === 'logged_local'
              ? 'Local Outbox'
              : 'Failed (Outbox)'
        } to ${res.entry.to}.`
      );
      const outboxRes = await api.getPlatformEmailOutbox().catch(() => ({ outbox }));
      setOutbox(outboxRes.outbox);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to send test email.'
      );
    } finally {
      setSendingTestEmail(false);
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
              { id: 'database', label: 'Database Manager', icon: Database },
              { id: 'firestore', label: 'Firestore Console', icon: Flame },
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

        {tab === 'tenants' && (
          <button
            type="button"
            onClick={openCreateTenantModal}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] transition-colors"
          >
            <Plus className="h-4 w-4" />
            <span>Register Tenant</span>
          </button>
        )}

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
      ) : tab === 'database' ? (
        <PlatformDatabaseTab
          onRefreshPlatform={async () => {
            await Promise.all([loadOverview(), onRefreshContext()]);
          }}
          onToast={onToast}
        />
      ) : tab === 'firestore' ? (
        <PlatformFirestoreTab
          tenants={tenants.map((t) => ({
            id: t.tenant.id,
            name: t.tenant.name,
            type: t.tenant.type,
          }))}
          onToast={onToast}
          onAuditRecorded={loadOverview}
        />
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

          <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden flex flex-col">
            <div className="border-b border-[var(--av-border-subtle)] px-5 py-3.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-display text-sm font-semibold text-[var(--av-text)]">
                <Mail className="h-4 w-4 text-[var(--av-accent)]" />
                <span>Transactional Email Test &amp; Outbox ({outbox.length})</span>
              </div>
              <span className="text-[11px] font-mono text-[var(--av-text-subtle)]">
                {settings?.smtpConfigured ? 'SMTP Live' : 'Outbox Fallback'}
              </span>
            </div>
            <form
              onSubmit={handleSendTestEmail}
              className="border-b border-[var(--av-border-subtle)] p-4 flex items-center gap-2"
            >
              <input
                type="email"
                required
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="recipient@company.com"
                className={INPUT_CLASS}
              />
              <button
                type="submit"
                disabled={sendingTestEmail}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60 whitespace-nowrap shrink-0"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{sendingTestEmail ? 'Sending...' : 'Send Test'}</span>
              </button>
            </form>
            <div className="max-h-72 overflow-y-auto divide-y divide-[var(--av-border-subtle)] text-xs">
              {outbox.length === 0 ? (
                <div className="p-6 text-center text-[var(--av-text-subtle)]">
                  No platform emails recorded yet.
                </div>
              ) : (
                outbox.slice(0, 20).map((entry) => (
                  <div key={entry.id} className="p-3.5 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-[var(--av-text)] truncate">
                        {entry.subject}
                      </span>
                      <span
                        className={`font-mono text-[10px] font-semibold uppercase ${
                          entry.status === 'failed'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {entry.status === 'logged_local' ? 'LOCAL OUTBOX' : entry.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--av-text-subtle)] flex items-center justify-between gap-2">
                      <span className="truncate">To: {entry.to}</span>
                      <span className="font-mono shrink-0">
                        {entry.sentAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                  </div>
                ))
              )}
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
                <div>
                  <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                    Plan Tagline
                  </label>
                  <input
                    type="text"
                    value={pTagline}
                    onChange={(e) => setPTagline(e.target.value)}
                    placeholder="Short plan positioning tagline..."
                    className={INPUT_CLASS}
                  />
                </div>
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
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Max Locations (empty = Unlimited)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pMaxLocations}
                      onChange={(e) => setPMaxLocations(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Max Client Orgs (empty = Unlimited)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pMaxClientOrgs}
                      onChange={(e) => setPMaxClientOrgs(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Max Tickets / Mo (empty = Unlimited)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pMaxTicketsPerMonth}
                      onChange={(e) => setPMaxTicketsPerMonth(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--av-text-muted)] mb-1">
                      Max Storage MB (empty = Unlimited)
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={pMaxStorageMb}
                      onChange={(e) => setPMaxStorageMb(e.target.value)}
                      className={`${INPUT_CLASS} font-mono`}
                    />
                  </div>
                </div>
                <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pIsPublic}
                    onChange={(e) => setPIsPublic(e.target.checked)}
                  />
                  <span>Visible on public pricing &amp; upgrade selector</span>
                </label>
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

      {/* Register Company IT / MSP Tenant Modal */}
      <AnimatePresence>
        {createTenantOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Register new Company IT or MSP tenant"
          >
            <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--av-border-subtle)] px-6 py-4">
                <div>
                  <h3 className="font-display text-base font-semibold text-[var(--av-text)]">
                    Register Tenant Workspace
                  </h3>
                  <p className="text-xs text-[var(--av-text-subtle)] mt-0.5">
                    Provision a Company IT or MSP Multi-Client workspace with assigned plan and subscription.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateTenantOpen(false)}
                  className="rounded-lg p-1.5 text-[var(--av-text-subtle)] hover:bg-[var(--av-surface-hover)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <form onSubmit={handleCreateTenant} className="flex-1 overflow-y-auto p-6 space-y-5">
                {createTenantError && (
                  <div className="rounded-lg border border-rose-300/60 dark:border-rose-500/30 bg-rose-50/80 dark:bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                    {createTenantError}
                  </div>
                )}

                {/* Workspace Model */}
                <div>
                  <label className="block text-xs font-semibold text-[var(--av-text)] mb-2">
                    1. Workspace Type
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewTenantType('company')}
                      className={`text-left rounded-xl border p-3.5 transition-all ${
                        newTenantType === 'company'
                          ? 'border-[var(--av-accent)] bg-[var(--av-accent-soft)]/50 ring-2 ring-[var(--av-accent-soft)]'
                          : 'border-[var(--av-border)] bg-[var(--av-surface-muted)]/40 hover:border-[var(--av-text-subtle)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-[var(--av-text)]">
                        <Building2 className="h-4 w-4 text-[var(--av-accent)]" />
                        <span>Company IT</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--av-text-subtle)]">
                        Internal corporate IT team managing company hardware, employees, tickets, and sites.
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setNewTenantType('msp');
                        if (newPlanCode === 'starter') setNewPlanCode('business');
                      }}
                      className={`text-left rounded-xl border p-3.5 transition-all ${
                        newTenantType === 'msp'
                          ? 'border-[var(--av-accent)] bg-[var(--av-accent-soft)]/50 ring-2 ring-[var(--av-accent-soft)]'
                          : 'border-[var(--av-border)] bg-[var(--av-surface-muted)]/40 hover:border-[var(--av-text-subtle)]'
                      }`}
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-[var(--av-text)]">
                        <Layers className="h-4 w-4 text-teal-500" />
                        <span>MSP Multi-Client</span>
                      </div>
                      <p className="mt-1 text-[11px] leading-relaxed text-[var(--av-text-subtle)]">
                        Managed service provider overseeing isolated client organisations from one console.
                      </p>
                    </button>
                  </div>
                </div>

                {/* Organisation Details */}
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--av-text)]">
                    2. Organisation &amp; Primary Client Setup
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        {newTenantType === 'msp' ? 'MSP Provider Name *' : 'Company Name *'}
                      </label>
                      <input
                        type="text"
                        required
                        value={newCompanyName}
                        onChange={(e) => setNewCompanyName(e.target.value)}
                        placeholder={
                          newTenantType === 'msp'
                            ? 'e.g. Apex Managed IT Ltd'
                            : 'e.g. Volta Logistics Group'
                        }
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Industry
                      </label>
                      <input
                        type="text"
                        value={newIndustry}
                        onChange={(e) => setNewIndustry(e.target.value)}
                        placeholder="Enterprise IT"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Country
                      </label>
                      <input
                        type="text"
                        value={newCountry}
                        onChange={(e) => setNewCountry(e.target.value)}
                        placeholder="Ghana"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        {newTenantType === 'msp'
                          ? 'Initial Client Org (Optional)'
                          : 'Primary HQ Name (Optional)'}
                      </label>
                      <input
                        type="text"
                        value={newPrimaryOrgName}
                        onChange={(e) => setNewPrimaryOrgName(e.target.value)}
                        placeholder={
                          newTenantType === 'msp'
                            ? 'Defaults to Primary Client'
                            : 'Defaults to Company Name'
                        }
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Primary Org Code
                      </label>
                      <input
                        type="text"
                        value={newPrimaryOrgCode}
                        onChange={(e) => setNewPrimaryOrgCode(e.target.value.toUpperCase())}
                        placeholder="HQ-01"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                  </div>
                </div>

                {/* Workspace Owner */}
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <label className="block text-xs font-semibold text-[var(--av-text)]">
                      3. Workspace Owner / Primary Admin
                    </label>
                    <span className="text-[11px] text-[var(--av-text-subtle)]">
                      Existing emails link automatically without changing passwords
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Owner Email *
                      </label>
                      <input
                        type="email"
                        required
                        value={newOwnerEmail}
                        onChange={(e) => setNewOwnerEmail(e.target.value)}
                        placeholder="admin@company.com"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Full Name (New User)
                      </label>
                      <input
                        type="text"
                        value={newOwnerName}
                        onChange={(e) => setNewOwnerName(e.target.value)}
                        placeholder="Kwame Mensah"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Initial Password (min 8 chars)
                      </label>
                      <input
                        type="password"
                        value={newOwnerPassword}
                        onChange={(e) => setNewOwnerPassword(e.target.value)}
                        placeholder="Required if new email"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                </div>

                {/* Plan & Subscription */}
                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[var(--av-text)]">
                    4. Plan, Subscription &amp; Topology
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Assigned Plan
                      </label>
                      <select
                        value={newPlanCode}
                        onChange={(e) => {
                          const code = e.target.value as PlanCode;
                          setNewPlanCode(code);
                          if (code === 'enterprise') setNewDeployMode('dedicated_enterprise');
                        }}
                        className={INPUT_CLASS}
                      >
                        {plans.map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.name} ({formatGhs(p.monthlyPriceGhs)}/mo ·{' '}
                            {formatGhs(p.annualPriceGhs)}/yr)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Subscription Status
                      </label>
                      <select
                        value={newSubStatus}
                        onChange={(e) =>
                          setNewSubStatus(e.target.value as 'active' | 'trialing')
                        }
                        className={INPUT_CLASS}
                      >
                        <option value="active">Active (Provisioned / Paid)</option>
                        <option value="trialing">Trialing (Evaluation Period)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Billing Cycle
                      </label>
                      <select
                        value={newBillingCycle}
                        onChange={(e) =>
                          setNewBillingCycle(e.target.value as BillingCycle)
                        }
                        className={INPUT_CLASS}
                      >
                        <option value="monthly">Monthly</option>
                        <option value="annual">Annual</option>
                      </select>
                    </div>

                    {newSubStatus === 'trialing' ? (
                      <div>
                        <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                          Trial Length (Days)
                        </label>
                        <input
                          type="number"
                          min="1"
                          value={newTrialDays}
                          onChange={(e) => setNewTrialDays(e.target.value)}
                          className={`${INPUT_CLASS} font-mono`}
                        />
                      </div>
                    ) : (
                      <div className="flex items-end pb-2">
                        <label className="inline-flex items-center gap-2 text-xs text-[var(--av-text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newRecordPayment}
                            onChange={(e) => setNewRecordPayment(e.target.checked)}
                          />
                          <span>Record paid invoice in ledger</span>
                        </label>
                      </div>
                    )}

                    <div>
                      <label className="block text-[11px] text-[var(--av-text-subtle)] mb-1">
                        Deployment Topology
                      </label>
                      <select
                        value={newDeployMode}
                        onChange={(e) =>
                          setNewDeployMode(e.target.value as Tenant['deploymentMode'])
                        }
                        className={INPUT_CLASS}
                      >
                        <option value="shared_cloud">Shared Cloud</option>
                        <option value="dedicated_enterprise">Dedicated Enterprise</option>
                      </select>
                    </div>
                  </div>

                  {newDeployMode === 'dedicated_enterprise' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-[var(--av-border-subtle)] bg-[var(--av-surface-muted)]/50 p-3">
                      <input
                        type="text"
                        value={newCustomDomain}
                        onChange={(e) => setNewCustomDomain(e.target.value)}
                        placeholder="Custom Domain (e.g. itam.client.com)"
                        className={INPUT_CLASS}
                      />
                      <input
                        type="text"
                        value={newDedicatedProject}
                        onChange={(e) => setNewDedicatedProject(e.target.value)}
                        placeholder="Dedicated Cluster / Project ID"
                        className={`${INPUT_CLASS} font-mono`}
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-[var(--av-border-subtle)]">
                  <button
                    type="button"
                    onClick={() => setCreateTenantOpen(false)}
                    className="rounded-lg border border-[var(--av-border)] px-4 py-2 text-xs font-medium text-[var(--av-text-muted)] hover:bg-[var(--av-surface-hover)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={creatingTenant}
                    className="rounded-lg bg-[var(--av-accent)] px-4 py-2 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                  >
                    {creatingTenant ? 'Registering...' : 'Register Tenant & Subscription'}
                  </button>
                </div>
              </form>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
