import type {
  FeatureKey,
  PlanLimits,
  SubscriptionPlan,
  TenantSubscription,
  WorkspaceUsage,
} from '../src/types/saas.ts';

export function createDefaultPlans(): SubscriptionPlan[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'plan-starter',
      code: 'starter',
      name: 'Starter',
      tagline: 'Essential IT asset inventory & ticket tracking for growing teams',
      monthlyPriceGhs: 149,
      annualPriceGhs: 1490,
      isPublic: true,
      limits: {
        maxAssets: 150,
        maxUsers: 10,
        maxLocations: 2,
        maxClientOrgs: 1,
        maxTicketsPerMonth: 250,
      },
      features: ['helpdesk', 'qr_barcode', 'audit_logs'],
      updatedAt: now,
    },
    {
      id: 'plan-professional',
      code: 'professional',
      name: 'Professional',
      tagline: 'Full ITAM + SLA helpdesk + software licences + multi-client MSP basics',
      monthlyPriceGhs: 349,
      annualPriceGhs: 3490,
      isPublic: true,
      limits: {
        maxAssets: 1000,
        maxUsers: 35,
        maxLocations: 10,
        maxClientOrgs: 10,
        maxTicketsPerMonth: 2000,
      },
      features: [
        'msp_mode',
        'helpdesk',
        'sla_automation',
        'software_licences',
        'knowledge_base',
        'bulk_import',
        'qr_barcode',
        'audit_logs',
      ],
      updatedAt: now,
    },
    {
      id: 'plan-business',
      code: 'business',
      name: 'Business',
      tagline: 'Complete ITSM, procurement, CAB change control & unlimited automation',
      monthlyPriceGhs: 699,
      annualPriceGhs: 6990,
      isPublic: true,
      limits: {
        maxAssets: 5000,
        maxUsers: 150,
        maxLocations: 50,
        maxClientOrgs: 50,
        maxTicketsPerMonth: 10000,
      },
      features: [
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
      ],
      updatedAt: now,
    },
    {
      id: 'plan-enterprise',
      code: 'enterprise',
      name: 'Enterprise',
      tagline: 'Dedicated isolation, custom limits, SSO/SCIM & executive SLA guarantees',
      monthlyPriceGhs: 1499,
      annualPriceGhs: 14990,
      isPublic: true,
      isCustomAnnual: true,
      limits: {
        maxAssets: null,
        maxUsers: null,
        maxLocations: null,
        maxClientOrgs: null,
        maxTicketsPerMonth: null,
      },
      features: [
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
      ],
      updatedAt: now,
    },
  ];
}

export function computeEffectiveEntitlements(
  plan: SubscriptionPlan,
  subscription: TenantSubscription
): { limits: PlanLimits; features: FeatureKey[] } {
  const overrides = subscription.customOverrides;
  const limits: PlanLimits = {
    maxAssets:
      overrides?.maxAssets !== undefined ? overrides.maxAssets : plan.limits.maxAssets,
    maxUsers:
      overrides?.maxUsers !== undefined ? overrides.maxUsers : plan.limits.maxUsers,
    maxLocations:
      overrides?.maxLocations !== undefined
        ? overrides.maxLocations
        : plan.limits.maxLocations,
    maxClientOrgs:
      overrides?.maxClientOrgs !== undefined
        ? overrides.maxClientOrgs
        : plan.limits.maxClientOrgs,
    maxTicketsPerMonth:
      overrides?.maxTicketsPerMonth !== undefined
        ? overrides.maxTicketsPerMonth
        : plan.limits.maxTicketsPerMonth,
  };

  const featureSet = new Set<FeatureKey>(plan.features);
  if (Array.isArray(overrides?.features)) {
    for (const f of overrides.features) featureSet.add(f);
  }
  return { limits, features: Array.from(featureSet) };
}

export function isSubscriptionReadOnly(subscription: TenantSubscription): {
  readOnly: boolean;
  reason?: string;
} {
  const now = Date.now();
  if (subscription.status === 'expired' || subscription.status === 'cancelled') {
    return {
      readOnly: true,
      reason: `Subscription is ${subscription.status}. Renew your plan in Billing to resume creating or editing records.`,
    };
  }
  if (subscription.status === 'grace_period' || subscription.status === 'past_due') {
    if (subscription.graceEndsAt && new Date(subscription.graceEndsAt).getTime() < now) {
      return {
        readOnly: true,
        reason:
          'Grace period has ended. Complete payment in Billing to unlock write operations.',
      };
    }
    return {
      readOnly: true,
      reason:
        'Subscription is in past-due grace period (read-only mode). Renew your subscription to resume mutations.',
    };
  }
  if (
    subscription.status === 'trialing' &&
    subscription.trialEndsAt &&
    new Date(subscription.trialEndsAt).getTime() < now
  ) {
    return {
      readOnly: true,
      reason:
        'Your 14-day free trial has ended. Choose a plan in Subscription & Billing to continue.',
    };
  }
  return { readOnly: false };
}

export function checkQuotaExceeded(
  limit: number | null,
  currentCount: number,
  resourceName: string,
  planName: string
): { ok: boolean; error?: string } {
  if (limit === null || limit === undefined) return { ok: true };
  if (currentCount >= limit) {
    return {
      ok: false,
      error: `Plan limit reached: your ${planName} plan allows up to ${limit} ${resourceName} (currently ${currentCount}). Upgrade your subscription to add more.`,
    };
  }
  return { ok: true };
}

export function checkFeatureAccess(
  features: FeatureKey[],
  required: FeatureKey,
  featureLabel: string
): { ok: boolean; error?: string } {
  if (features.includes(required)) return { ok: true };
  return {
    ok: false,
    error: `${featureLabel} is not included in your current plan. Upgrade in Subscription & Billing to unlock it.`,
  };
}

export function buildUsageSnapshot(params: {
  assetsCount: number;
  usersCount: number;
  locationsCount: number;
  clientOrgsCount: number;
  ticketsThisMonth: number;
}): WorkspaceUsage {
  return params;
}
