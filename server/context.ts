import type { NextFunction, Response } from 'express';
import type { AuthenticatedRequest } from './auth.ts';
import type { ItamsDatabase, TenantScopeFilter } from './db.ts';
import {
  buildUsageSnapshot,
  computeEffectiveEntitlements,
  isSubscriptionReadOnly,
} from './entitlements.ts';
import {
  canAccessOrganisation,
  getEffectivePermissions,
  isPlatformSuperAdmin,
} from './rbac.ts';
import { DEFAULT_ORG_ID, DEFAULT_TENANT_ID, type SaasStore } from './saasStore.ts';
import type {
  ClientOrganisation,
  FeatureKey,
  PermissionCode,
  PlanLimits,
  SubscriptionPlan,
  Tenant,
  TenantContextPayload,
  TenantRole,
  TenantSubscription,
  UserMembership,
} from '../src/types/saas.ts';

export interface ResolvedTenantContext extends TenantContextPayload {
  scopeFilter: TenantScopeFilter;
  targetOrgId: string;
  isAllOrgsView: boolean;
  isSuperAdmin: boolean;
}

export interface TenantRequest extends AuthenticatedRequest {
  tenantCtx?: ResolvedTenantContext;
}

export function createTenantContextMiddleware(
  db: ItamsDatabase,
  store: SaasStore
) {
  return async function resolveTenantContext(
    req: TenantRequest,
    res: Response,
    next: NextFunction
  ) {
    try {
      const user = req.authUser;
      if (!user) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }

      const state = store.data;
      let userMemberships = state.memberships.filter(
        (m) => m.userId === user.id && m.status === 'active'
      );

      // Ensure legacy seeded users or newly approved OAuth users have a valid membership
      if (userMemberships.length === 0) {
        const ensured = store.ensureUserMembership({
          userId: user.id,
          email: user.email,
          defaultRole: user.role === 'admin' ? 'tenant_owner' : 'it_technician',
        });
        await store.persist();
        userMemberships = [ensured];
      }

      const requestedTenantId =
        typeof req.headers['x-tenant-id'] === 'string'
          ? req.headers['x-tenant-id'].trim()
          : '';
      const requestedOrgId =
        typeof req.headers['x-org-id'] === 'string'
          ? req.headers['x-org-id'].trim()
          : '';

      let activeMembership: UserMembership | undefined;
      if (requestedTenantId) {
        activeMembership = userMemberships.find(
          (m) => m.tenantId === requestedTenantId
        );
        if (!activeMembership) {
          res.status(403).json({
            error: 'Access denied: you do not belong to the requested tenant.',
          });
          return;
        }
      } else {
        activeMembership = userMemberships[0];
      }

      const tenant = state.tenants.find((t) => t.id === activeMembership!.tenantId);
      if (!tenant) {
        res.status(404).json({ error: 'Workspace tenant record not found.' });
        return;
      }

      if (tenant.status === 'suspended' && !req.path.startsWith('/billing')) {
        res.status(403).json({
          error:
            'This workspace tenant is currently suspended. Contact Platform Support or renew billing.',
        });
        return;
      }

      const tenantOrgs = state.clientOrganisations.filter(
        (o) => o.tenantId === tenant.id
      );
      const accessibleOrgs = tenantOrgs.filter((o) =>
        canAccessOrganisation(activeMembership!, o.id)
      );

      if (accessibleOrgs.length === 0 && tenantOrgs.length > 0 && activeMembership.orgAccessMode === 'all') {
        accessibleOrgs.push(...tenantOrgs);
      }

      let targetOrg =
        accessibleOrgs.find((o) => o.isDefault) ||
        accessibleOrgs[0] ||
        tenantOrgs[0];
      let isAllOrgsView = false;
      let scopedOrgIds: string[] | null = null;

      if (requestedOrgId.toUpperCase() === 'ALL') {
        if (activeMembership.orgAccessMode !== 'all') {
          res.status(403).json({
            error:
              'Access denied: your account is restricted to specific client organisations.',
          });
          return;
        }
        isAllOrgsView = true;
        scopedOrgIds = null;
      } else if (requestedOrgId) {
        const matched = tenantOrgs.find((o) => o.id === requestedOrgId);
        if (!matched) {
          res.status(403).json({
            error: 'Access denied: organisation does not belong to your tenant.',
          });
          return;
        }
        if (!canAccessOrganisation(activeMembership, matched.id)) {
          res.status(403).json({
            error:
              'Access denied: you are not assigned to the requested client organisation.',
          });
          return;
        }
        targetOrg = matched;
        scopedOrgIds = [matched.id];
      } else {
        // Default scope: all orgs if orgAccessMode === 'all', otherwise restricted list
        scopedOrgIds =
          activeMembership.orgAccessMode === 'all'
            ? null
            : accessibleOrgs.map((o) => o.id);
        if (tenant.type === 'msp' && activeMembership.orgAccessMode === 'all') {
          isAllOrgsView = true;
        }
      }

      const fallbackOrg: ClientOrganisation = targetOrg || {
        id: DEFAULT_ORG_ID,
        tenantId: tenant.id,
        name: tenant.name,
        code: 'ORG-01',
        industry: 'Technology',
        contactName: user.name,
        contactEmail: user.email,
        contactPhone: '',
        address: '',
        status: 'active',
        isDefault: true,
        createdAt: tenant.createdAt,
        updatedAt: tenant.updatedAt,
      };

      const subscription: TenantSubscription =
        state.subscriptions.find((s) => s.tenantId === tenant.id) || {
          id: `sub-fallback-${tenant.id}`,
          tenantId: tenant.id,
          planCode: tenant.planCode,
          billingCycle: 'monthly',
          status: 'active',
          trialEndsAt: null,
          currentPeriodStart: tenant.createdAt,
          currentPeriodEnd: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          amountGhs: 149,
          updatedAt: tenant.updatedAt,
        };

      const plan: SubscriptionPlan =
        state.plans.find((p) => p.code === subscription.planCode) ||
        state.plans[0];

      const { limits, features } = computeEffectiveEntitlements(plan, subscription);
      const readOnlyCheck = isSubscriptionReadOnly(subscription);

      const tenantOnlyScope: TenantScopeFilter = { tenantId: tenant.id };
      const [assetsCount, tenantTickets] = await Promise.all([
        db.countAssets(tenantOnlyScope),
        Promise.resolve(
          state.tickets.filter((t) => t.tenantId === tenant.id)
        ),
      ]);

      const currentMonth = new Date().toISOString().slice(0, 7);
      const ticketsThisMonth = tenantTickets.filter((t) =>
        t.createdAt.startsWith(currentMonth)
      ).length;

      const tenantUsersCount = state.memberships.filter(
        (m) => m.tenantId === tenant.id && m.status !== 'suspended'
      ).length;
      const tenantLocationsCount = state.locations.filter(
        (l) => l.tenantId === tenant.id
      ).length;

      const storageUsedBytes = state.attachments
        .filter((a) => a.tenantId === tenant.id)
        .reduce((sum, a) => sum + (Number(a.sizeBytes) || 0), 0);

      const usage = buildUsageSnapshot({
        assetsCount,
        usersCount: Math.max(1, tenantUsersCount),
        locationsCount: tenantLocationsCount,
        clientOrgsCount: tenantOrgs.length,
        ticketsThisMonth,
        storageUsedBytes,
      });

      const availableTenants: Array<{ tenant: Tenant; role: TenantRole }> = [];
      for (const m of userMemberships) {
        const t = state.tenants.find((x) => x.id === m.tenantId);
        if (t) availableTenants.push({ tenant: t, role: m.role });
      }

      const permissions = getEffectivePermissions(activeMembership, user);

      req.tenantCtx = {
        tenant,
        activeOrg: fallbackOrg,
        availableOrgs: accessibleOrgs.length > 0 ? accessibleOrgs : [fallbackOrg],
        availableTenants,
        membership: activeMembership,
        permissions,
        subscription,
        plan,
        effectiveLimits: limits,
        effectiveFeatures: features,
        usage,
        isReadOnlyGraceOrExpired: readOnlyCheck.readOnly,
        scopeFilter: {
          tenantId: tenant.id,
          orgIds: scopedOrgIds,
        },
        targetOrgId: fallbackOrg.id,
        isAllOrgsView,
        isSuperAdmin: isPlatformSuperAdmin(user),
      };

      next();
    } catch (err) {
      console.error('Tenant context resolution error:', err);
      res.status(500).json({ error: 'Failed to resolve workspace tenant context.' });
    }
  };
}

export function requirePermission(permission: PermissionCode) {
  return (req: TenantRequest, res: Response, next: NextFunction) => {
    const ctx = req.tenantCtx;
    if (!ctx) {
      res.status(401).json({ error: 'Workspace context required.' });
      return;
    }
    if (ctx.isSuperAdmin || ctx.permissions.includes(permission)) {
      next();
      return;
    }
    res.status(403).json({
      error: `Permission denied: "${permission}" privilege is required for this action.`,
    });
  };
}

export function requireWritableSubscription(
  req: TenantRequest,
  res: Response,
  next: NextFunction
) {
  const ctx = req.tenantCtx;
  if (!ctx) {
    res.status(401).json({ error: 'Workspace context required.' });
    return;
  }
  if (ctx.isReadOnlyGraceOrExpired) {
    const check = isSubscriptionReadOnly(ctx.subscription);
    res.status(402).json({
      error:
        check.reason ||
        'Subscription is inactive or past due. Renew your plan in Billing to make changes.',
      code: 'SUBSCRIPTION_READ_ONLY',
    });
    return;
  }
  next();
}

export function requireFeature(feature: FeatureKey, label: string) {
  return (req: TenantRequest, res: Response, next: NextFunction) => {
    const ctx = req.tenantCtx;
    if (!ctx) {
      res.status(401).json({ error: 'Workspace context required.' });
      return;
    }
    if (ctx.effectiveFeatures.includes(feature)) {
      next();
      return;
    }
    res.status(403).json({
      error: `${label} requires an upgraded plan. Visit Subscription & Billing to unlock.`,
      code: 'FEATURE_LOCKED',
      feature,
    });
  };
}

export function requirePlatformSuperAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.authUser) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  if (!isPlatformSuperAdmin(req.authUser)) {
    res.status(403).json({
      error: 'Forbidden: Platform Super Admin privileges are required.',
    });
    return;
  }
  next();
}

export function canAccessRecordOrg(
  ctx: ResolvedTenantContext,
  recordTenantId?: string,
  recordOrgId?: string
): boolean {
  const tId = recordTenantId || DEFAULT_TENANT_ID;
  if (tId !== ctx.tenant.id) return false;
  const oId = recordOrgId || DEFAULT_ORG_ID;
  if (ctx.scopeFilter.orgIds && !ctx.scopeFilter.orgIds.includes(oId)) {
    return false;
  }
  return canAccessOrganisation(ctx.membership, oId);
}
