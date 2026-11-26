import { useEffect, useState } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  CheckCircle2,
  CreditCard,
  Download,
  Receipt,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { api, ApiError, type ExtendedTenantContext } from '../lib/api.ts';
import type {
  BillingCycle,
  InvoiceRecord,
  PaymentTransaction,
  PlanCode,
  SubscriptionPlan,
  TenantSubscription,
} from '../types/saas.ts';
import { formatGhs, formatGhsExact } from './StatusText.tsx';

interface SubscriptionBillingViewProps {
  tenantCtx: ExtendedTenantContext | null;
  onRefreshContext: () => Promise<void>;
  onToast: (type: 'success' | 'error', message: string) => void;
}

function UsageBar({
  label,
  used,
  max,
  usedText,
  maxText,
}: {
  label: string;
  used: number;
  max: number | null;
  usedText?: string;
  maxText?: string;
}) {
  const pct = max === null ? 15 : Math.min(100, Math.round((used / Math.max(1, max)) * 100));
  const nearLimit = max !== null && used >= max;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-[var(--av-text-muted)]">{label}</span>
        <span className="font-mono font-semibold text-[var(--av-text)] tabular-nums">
          {usedText ?? used} / {max === null ? 'Unlimited' : (maxText ?? max)}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-[var(--av-surface-muted)] overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            nearLimit ? 'bg-amber-500' : 'bg-[var(--av-accent)]'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatStorageBytesLabel(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function formatStorageMaxMbLabel(maxMb: number | null | undefined): string {
  if (maxMb === null || maxMb === undefined) return 'Unlimited';
  if (maxMb >= 1024) {
    const gb = maxMb / 1024;
    return Number.isInteger(gb) ? `${gb} GB` : `${gb.toFixed(1)} GB`;
  }
  return `${maxMb} MB`;
}

export function SubscriptionBillingView({
  tenantCtx,
  onRefreshContext,
  onToast,
}: SubscriptionBillingViewProps) {
  const [loading, setLoading] = useState(true);
  const [subscription, setSubscription] = useState<TenantSubscription | null>(null);
  const [currentPlan, setCurrentPlan] = useState<SubscriptionPlan | null>(null);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [payments, setPayments] = useState<PaymentTransaction[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [paystackConfigured, setPaystackConfigured] = useState(false);

  const [cycle, setCycle] = useState<BillingCycle>('monthly');
  const [checkoutBusy, setCheckoutBusy] = useState<PlanCode | null>(null);
  const [simPending, setSimPending] = useState<{
    reference: string;
    planCode: PlanCode;
    billingCycle: BillingCycle;
    amountGhs: number;
  } | null>(null);
  const [verifyingSim, setVerifyingSim] = useState(false);

  const canManageBilling =
    tenantCtx?.permissions.includes('billing.manage') ?? false;

  const loadBilling = async () => {
    setLoading(true);
    try {
      const res = await api.getBilling();
      setSubscription(res.subscription);
      setCurrentPlan(res.plan);
      setPlans(res.plans);
      setPayments(res.payments);
      setInvoices(res.invoices);
      setPaystackConfigured(res.paystackConfigured);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to load billing profile.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBilling();
  }, [tenantCtx?.tenant.id]);

  const handleStartPaystack = async (planCode: PlanCode) => {
    setCheckoutBusy(planCode);
    try {
      const res = await api.initPaystack(planCode, cycle);
      if (res.mode === 'live' && res.authorizationUrl) {
        window.location.assign(res.authorizationUrl);
        return;
      }
      setSimPending({
        reference: res.reference,
        planCode,
        billingCycle: cycle,
        amountGhs: res.payment.amountGhs,
      });
      onToast(
        'success',
        `Paystack test checkout initialized (${res.reference}). Complete verification below.`
      );
      await loadBilling();
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to initialize Paystack checkout.'
      );
    } finally {
      setCheckoutBusy(null);
    }
  };

  const handleCompleteSimulatedPayment = async () => {
    if (!simPending) return;
    setVerifyingSim(true);
    try {
      await api.verifyPaystack(simPending.reference);
      onToast('success', 'Subscription activated and GH₵ invoice issued.');
      setSimPending(null);
      await Promise.all([loadBilling(), onRefreshContext()]);
    } catch (err) {
      onToast(
        'error',
        err instanceof ApiError ? err.message : 'Failed to verify payment.'
      );
    } finally {
      setVerifyingSim(false);
    }
  };

  const handleDownloadReceiptPdf = (inv: InvoiceRecord) => {
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    // Brand Header
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, pageW, 92, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('AssetVault IT', 44, 42);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text('SaaS Subscription Tax Invoice & Receipt', 44, 62);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(inv.invoiceNumber, pageW - 44, 42, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`STATUS: ${inv.status.toUpperCase()}`, pageW - 44, 62, {
      align: 'right',
    });

    // Billed To / Metadata
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('BILLED TO', 44, 126);
    doc.setFont('helvetica', 'normal');
    doc.text(tenantCtx?.tenant.name || 'AssetVault Tenant', 44, 144);
    doc.text(
      `${tenantCtx?.tenant.country || 'Ghana'} · ${tenantCtx?.tenant.supportEmail || ''}`,
      44,
      160
    );

    doc.setFont('helvetica', 'bold');
    doc.text('INVOICE DETAILS', pageW - 220, 126);
    doc.setFont('helvetica', 'normal');
    doc.text(`Issued Date: ${inv.issuedAt.slice(0, 10)}`, pageW - 220, 144);
    doc.text(`Due Date: ${inv.dueAt.slice(0, 10)}`, pageW - 220, 160);
    doc.text(`Payment Ref: ${inv.paymentId}`, pageW - 220, 176);

    autoTable(doc, {
      startY: 204,
      head: [['Description', 'Billing Cycle', 'Qty', 'Amount (GHS)']],
      body: [
        [
          `AssetVault IT — ${inv.planName} Workspace Subscription`,
          inv.billingCycle.charAt(0).toUpperCase() + inv.billingCycle.slice(1),
          '1',
          `GHS ${inv.amountGhs.toFixed(2)}`,
        ],
      ],
      theme: 'grid',
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontSize: 10 },
      styles: { fontSize: 10, cellPadding: 8 },
    });

    const finalY =
      ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
        ?.finalY ?? 280) + 28;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`Total Paid: GHS ${inv.amountGhs.toFixed(2)}`, pageW - 44, finalY, {
      align: 'right',
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(
      'Generated electronically by AssetVault IT Billing Ledger. Retain for accounting and tax compliance.',
      44,
      finalY + 34
    );

    doc.save(`${inv.invoiceNumber}_Invoice.pdf`);
    onToast('success', `Downloaded ${inv.invoiceNumber} PDF invoice.`);
  };

  const usage = tenantCtx?.usage;
  const limits = tenantCtx?.effectiveLimits;

  return (
    <div className="space-y-6">
      {/* Current Subscription & Usage Quotas */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--av-text-subtle)]">
              Active Subscription
            </span>
            <span
              className={`text-xs font-semibold ${
                subscription?.status === 'active'
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : subscription?.status === 'trialing'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-amber-600 dark:text-amber-400'
              }`}
            >
              {subscription?.status?.replace('_', ' ').toUpperCase() || 'ACTIVE'}
            </span>
          </div>
          <div className="font-display text-2xl font-bold text-[var(--av-text)]">
            {currentPlan?.name || 'Professional'}
          </div>
          <p className="text-xs text-[var(--av-text-muted)]">
            {currentPlan?.tagline || 'Multi-department ITAM & Helpdesk'}
          </p>
          <div className="border-t border-[var(--av-border-subtle)] pt-3 space-y-1 text-xs text-[var(--av-text-subtle)] tabular-nums">
            <div>
              Billing Gateway:{' '}
              <strong className="text-[var(--av-text)]">
                {paystackConfigured ? 'Paystack Live (GH₵)' : 'Paystack Test Simulation (GH₵)'}
              </strong>
            </div>
            <div>
              Period End:{' '}
              <strong className="text-[var(--av-text)]">
                {subscription?.currentPeriodEnd.slice(0, 10) || '—'}
              </strong>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] p-5 shadow-[var(--av-card-shadow)] space-y-3.5">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-sm font-bold text-[var(--av-text)]">
              Workspace Plan Utilization
            </h3>
            <span className="text-xs text-[var(--av-text-subtle)]">
              Real-time server-enforced quotas
            </span>
          </div>
          {usage && limits && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <UsageBar label="Managed Assets" used={usage.assetsCount} max={limits.maxAssets} />
              <UsageBar label="Active Team Users" used={usage.usersCount} max={limits.maxUsers} />
              <UsageBar label="Locations" used={usage.locationsCount} max={limits.maxLocations} />
              <UsageBar
                label="Client Organisations"
                used={usage.clientOrgsCount}
                max={limits.maxClientOrgs}
              />
              <UsageBar
                label="Tickets This Month"
                used={usage.ticketsThisMonth}
                max={limits.maxTicketsPerMonth}
              />
              <UsageBar
                label="Attachment Storage"
                used={usage.storageUsedBytes ?? 0}
                max={
                  limits.maxStorageMb === null || limits.maxStorageMb === undefined
                    ? null
                    : limits.maxStorageMb * 1024 * 1024
                }
                usedText={formatStorageBytesLabel(usage.storageUsedBytes ?? 0)}
                maxText={formatStorageMaxMbLabel(limits.maxStorageMb)}
              />
            </div>
          )}
        </div>
      </div>

      {/* Paystack Sandbox Simulation Banner */}
      {simPending && (
        <div className="rounded-xl border border-blue-300/70 dark:border-blue-500/40 bg-blue-50/70 dark:bg-blue-500/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-bold text-blue-900 dark:text-blue-200">
              <Sparkles className="h-4 w-4 text-[#3B66F6]" />
              <span>Paystack Sandbox Checkout Pending ({simPending.reference})</span>
            </div>
            <p className="text-xs text-blue-800 dark:text-blue-300">
              `PAYSTACK_SECRET_KEY` is unset, so checkout runs in safe test simulation mode for{' '}
              <strong>{formatGhsExact(simPending.amountGhs)}</strong> ({simPending.planCode} ·{' '}
              {simPending.billingCycle}).
            </p>
          </div>
          <button
            type="button"
            disabled={verifyingSim}
            onClick={handleCompleteSimulatedPayment}
            className="inline-flex items-center gap-2 rounded-lg bg-[#3B66F6] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#2F54EB] disabled:opacity-60 shrink-0"
          >
            <CheckCircle2 className="h-4 w-4" />
            <span>
              {verifyingSim ? 'Verifying...' : 'Complete Simulated Paystack Payment'}
            </span>
          </button>
        </div>
      )}

      {/* Plans Matrix */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-base font-bold text-[var(--av-text)]">
              GH₵ Subscription Plans
            </h3>
            <p className="text-xs text-[var(--av-text-subtle)]">
              Instant Paystack Ghana Cedi billing · Upgrade or renew anytime
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-[var(--av-border)] bg-[var(--av-surface)] p-1">
            <button
              type="button"
              onClick={() => setCycle('monthly')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                cycle === 'monthly'
                  ? 'bg-[var(--av-accent)] text-white'
                  : 'text-[var(--av-text-muted)]'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setCycle('annual')}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                cycle === 'annual'
                  ? 'bg-[var(--av-accent)] text-white'
                  : 'text-[var(--av-text-muted)]'
              }`}
            >
              Annual (2 Months Free)
            </button>
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-xs text-[var(--av-text-subtle)]">
            Loading GH₵ pricing plans...
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {plans.map((p) => {
              const isCurrent = subscription?.planCode === p.code && subscription?.status === 'active';
              const price = cycle === 'annual' ? p.annualPriceGhs : p.monthlyPriceGhs;
              return (
                <div
                  key={p.id}
                  className={`rounded-xl border p-5 flex flex-col justify-between gap-4 shadow-[var(--av-card-shadow)] ${
                    p.code === 'professional'
                      ? 'border-[var(--av-accent)] bg-[var(--av-surface)]'
                      : 'border-[var(--av-border)] bg-[var(--av-surface)]'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-display text-base font-bold text-[var(--av-text)]">
                        {p.name}
                      </span>
                      {isCurrent && (
                        <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--av-text-subtle)] min-h-[32px]">
                      {p.tagline}
                    </p>
                    <div className="font-display text-2xl font-bold text-[var(--av-text)] tabular-nums">
                      {p.isCustomAnnual && cycle === 'annual' ? (
                        <span className="text-lg">Custom Annual</span>
                      ) : (
                        <>
                          {formatGhs(price)}
                          <span className="text-xs font-normal text-[var(--av-text-subtle)]">
                            /{cycle === 'annual' ? 'yr' : 'mo'}
                          </span>
                        </>
                      )}
                    </div>
                    <ul className="space-y-1.5 text-xs text-[var(--av-text-muted)] border-t border-[var(--av-border-subtle)] pt-3">
                      <li>• Assets: {p.limits.maxAssets ?? 'Unlimited'}</li>
                      <li>• Users: {p.limits.maxUsers ?? 'Unlimited'}</li>
                      <li>• Client Orgs: {p.limits.maxClientOrgs ?? 'Unlimited'}</li>
                      <li>• Modules: {p.features.length} enterprise features</li>
                    </ul>
                  </div>

                  {canManageBilling ? (
                    <button
                      type="button"
                      disabled={checkoutBusy !== null}
                      onClick={() => handleStartPaystack(p.code)}
                      className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--av-accent)] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[var(--av-accent-hover)] disabled:opacity-60"
                    >
                      <CreditCard className="h-3.5 w-3.5" />
                      <span>
                        {checkoutBusy === p.code
                          ? 'Connecting Paystack...'
                          : isCurrent
                            ? `Renew ${p.name}`
                            : `Pay with Paystack (${formatGhs(price)})`}
                      </span>
                    </button>
                  ) : (
                    <div className="text-center text-[11px] text-[var(--av-text-subtle)]">
                      Billing Admin required
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invoices & Payments History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--av-border-subtle)] px-5 py-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
            <Receipt className="h-4 w-4 text-emerald-500" />
            <span>Invoices ({invoices.length})</span>
          </div>
          {invoices.length === 0 ? (
            <div className="p-6 text-xs text-[var(--av-text-subtle)]">
              No invoices issued yet.
            </div>
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)] text-xs">
              {invoices.map((inv) => (
                <div key={inv.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono font-bold text-[var(--av-text)]">
                      {inv.invoiceNumber}
                    </div>
                    <div className="text-[var(--av-text-subtle)]">
                      {inv.planName} ({inv.billingCycle}) · {inv.issuedAt.slice(0, 10)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-[var(--av-text)] tabular-nums">
                      {formatGhsExact(inv.amountGhs)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownloadReceiptPdf(inv)}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--av-border)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--av-text-muted)] hover:text-[var(--av-text)]"
                    >
                      <Download className="h-3 w-3" />
                      <span>PDF</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[var(--av-border)] bg-[var(--av-surface)] shadow-[var(--av-card-shadow)] overflow-hidden">
          <div className="flex items-center gap-2 border-b border-[var(--av-border-subtle)] px-5 py-3.5 font-display text-sm font-semibold text-[var(--av-text)]">
            <ShieldCheck className="h-4 w-4 text-[#3B66F6]" />
            <span>Payment Transactions ({payments.length})</span>
          </div>
          {payments.length === 0 ? (
            <div className="p-6 text-xs text-[var(--av-text-subtle)]">
              No payment transactions recorded yet.
            </div>
          ) : (
            <div className="divide-y divide-[var(--av-border-subtle)] text-xs">
              {payments.map((pay) => (
                <div key={pay.id} className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-mono font-semibold text-[var(--av-accent)]">
                      {pay.reference}
                    </div>
                    <div className="text-[var(--av-text-subtle)]">
                      {pay.provider} · {pay.planCode} ({pay.billingCycle}) ·{' '}
                      {pay.createdAt.slice(0, 10)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-semibold text-[var(--av-text)] tabular-nums">
                      {formatGhsExact(pay.amountGhs)}
                    </div>
                    <div
                      className={`text-[11px] font-semibold ${
                        pay.status === 'success'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : pay.status === 'refunded'
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-amber-600 dark:text-amber-400'
                      }`}
                    >
                      {pay.status.toUpperCase()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
