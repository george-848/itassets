import crypto from 'node:crypto';
import express from 'express';
import {
  createAuthMiddleware,
  hashPassword,
  signOAuthState,
  signSessionToken,
  verifyOAuthState,
  verifyPassword,
  type AuthenticatedRequest,
} from './auth.ts';
import {
  canAccessRecordOrg,
  createTenantContextMiddleware,
  requireFeature,
  requirePermission,
  requireWritableSubscription,
  type TenantRequest,
} from './context.ts';
import { createDatabase, type ItamsDatabase } from './db.ts';
import { checkQuotaExceeded } from './entitlements.ts';
import { registerSaasRoutes } from './routesSaas.ts';
import { DEFAULT_ORG_ID, DEFAULT_TENANT_ID, SaasStore } from './saasStore.ts';
import {
  ASSET_CATEGORIES,
  ASSET_STATUSES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_TYPES,
  type Asset,
  type AssetCategory,
  type AssetStatus,
  type Employee,
  type MaintenanceLog,
  type MaintenanceStatus,
  type MaintenanceType,
  type User,
  type UserRole,
} from '../src/types/itams.ts';
import type {
  ClientOrganisation,
  PlanCode,
  Tenant,
  TenantRole,
  TenantSubscription,
  TenantType,
  UserMembership,
} from '../src/types/saas.ts';

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isIsoDate(val: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(val);
}

function enrichAssetWithSaasMeta(asset: Asset, store: SaasStore): Asset {
  const meta = store.data.assetMeta[asset.id];
  const org = store.data.clientOrganisations.find(
    (o) => o.id === (asset.org_id || DEFAULT_ORG_ID)
  );
  return {
    ...asset,
    org_name: org?.name || 'Main Corporate HQ',
    barcode_value: meta?.barcode_value || asset.asset_tag,
    qr_payload:
      meta?.qr_payload ||
      JSON.stringify({
        id: asset.id,
        tag: asset.asset_tag,
        serial: asset.serial_number,
        tenant: asset.tenant_id || DEFAULT_TENANT_ID,
      }),
    ...meta,
  };
}

let sharedDbPromise: Promise<ItamsDatabase> | null = null;

export function getSharedDatabase(): Promise<ItamsDatabase> {
  if (!sharedDbPromise) {
    sharedDbPromise = createDatabase().catch((err) => {
      sharedDbPromise = null;
      throw err;
    });
  }
  return sharedDbPromise;
}

export function createApiApp(
  db: ItamsDatabase,
  providedStore?: SaasStore
): express.Express {
  const app = express();
  const store = providedStore ?? new SaasStore();

  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: string }).rawBody =
          buf.toString('utf8');
      },
    })
  );

  // Ensure SaasStore is initialized even if createApiApp(db) was called without explicit store
  app.use(async (_req, _res, next) => {
    try {
      await store.init();
      next();
    } catch (err) {
      next(err);
    }
  });

  const requireAuth = createAuthMiddleware((id) => db.findUserById(id));
  const resolveTenantContext = createTenantContextMiddleware(db, store);
  const tenantGuard = [requireAuth, resolveTenantContext];

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, engine: db.engine });
  });

  // -------------------------------------------------------------------------
  // Auth Routes
  // -------------------------------------------------------------------------
  app.post('/api/auth/login', async (req, res) => {
    try {
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const password = String(req.body?.password ?? '');
      if (!email || !password) {
        res.status(400).json({ error: 'Email and password are required.' });
        return;
      }

      const user = await db.findUserByEmail(email);
      if (!user || !verifyPassword(password, user.password_hash)) {
        res.status(401).json({ error: 'Invalid email address or password.' });
        return;
      }
      if (user.status === 'pending') {
        res.status(403).json({
          error:
            'Verification required: your account is awaiting administrator approval in User Management.',
        });
        return;
      }
      if (user.status !== 'active') {
        res.status(403).json({
          error: 'Your account has been deactivated. Contact an administrator.',
        });
        return;
      }

      const now = new Date().toISOString();
      await db.updateUserLastLogin(user.id, now);
      const token = signSessionToken({ id: user.id, email: user.email, role: user.role });

      res.cookie('av_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      const { password_hash: _ignored, ...safeUser } = user;
      res.json({
        token,
        user: { ...safeUser, last_login: now },
        engine: db.engine,
      });
    } catch (err) {
      console.error('Login error:', err);
      res.status(500).json({ error: 'Authentication service error.' });
    }
  });

  async function verifyAndAuthenticateOAuthUser(params: {
    email: string;
    displayName: string;
    provider: 'Google' | 'GitHub';
  }): Promise<
    | { ok: true; token: string; user: ReturnType<typeof Object.assign> }
    | { ok: false; status: number; error: string }
  > {
    const now = new Date().toISOString();
    const existingUser = await db.findUserByEmail(params.email);

    if (!existingUser) {
      const createdUser = await db.createUser({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        name: params.displayName,
        email: params.email,
        password_hash: hashPassword(crypto.randomBytes(24).toString('hex')),
        role: 'staff',
        department: 'IT Infrastructure',
        status: 'pending',
        created_at: now,
        last_login: null,
        email_verified: true,
        mfa_enabled: false,
        is_super_admin: false,
      });
      await store.mutate(() => {
        store.ensureUserMembership({
          userId: createdUser.id,
          email: createdUser.email,
          defaultRole: 'it_technician',
        });
      });
      return {
        ok: false,
        status: 403,
        error: `Verification required: your ${params.provider} account (${params.email}) has been submitted for administrator approval. Ask an admin to verify your access in User Management, then sign in again.`,
      };
    }

    if (existingUser.status === 'pending') {
      return {
        ok: false,
        status: 403,
        error: `Verification required: your account (${params.email}) is still awaiting administrator approval in User Management.`,
      };
    }

    if (existingUser.status !== 'active') {
      return {
        ok: false,
        status: 403,
        error: 'Your account has been deactivated. Contact an administrator.',
      };
    }

    await db.updateUserLastLogin(existingUser.id, now);
    const { password_hash: _ignored, ...rest } = existingUser;
    const safeUser = { ...rest, last_login: now };
    const token = signSessionToken({
      id: safeUser.id,
      email: safeUser.email,
      role: safeUser.role,
    });
    return { ok: true, token, user: safeUser };
  }

  app.post('/api/auth/google', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const headerToken =
        typeof req.headers['x-google-access-token'] === 'string'
          ? req.headers['x-google-access-token'].trim()
          : '';
      const bodyToken =
        typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
      const bearerToken =
        authHeader && authHeader.startsWith('Bearer ')
          ? authHeader.slice(7).trim()
          : '';
      const googleToken = bodyToken || headerToken || bearerToken;
      if (!googleToken) {
        res.status(401).json({ error: 'Google access token is required.' });
        return;
      }

      const [tokeninfoRes, userinfoRes] = await Promise.all([
        fetch(
          `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(googleToken)}`
        ),
        fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${googleToken}` },
        }),
      ]);

      if (!tokeninfoRes.ok || !userinfoRes.ok) {
        res.status(401).json({ error: 'Invalid or expired Google credentials.' });
        return;
      }

      const tokeninfo = (await tokeninfoRes.json()) as {
        email?: unknown;
        email_verified?: unknown;
        expires_in?: unknown;
      };
      const profile = (await userinfoRes.json()) as {
        email?: unknown;
        email_verified?: unknown;
        name?: unknown;
      };

      const expiresIn = Number(tokeninfo.expires_in ?? 0);
      if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
        res.status(401).json({ error: 'Google authentication token has expired.' });
        return;
      }

      const email =
        typeof profile.email === 'string' ? profile.email.trim().toLowerCase() : '';
      const tokenEmail =
        typeof tokeninfo.email === 'string' ? tokeninfo.email.trim().toLowerCase() : '';
      const tokenEmailVerified =
        tokeninfo.email_verified === true || tokeninfo.email_verified === 'true';

      if (
        !email ||
        profile.email_verified !== true ||
        !tokenEmailVerified ||
        (tokenEmail && tokenEmail !== email)
      ) {
        res.status(401).json({ error: 'A verified Google email address is required.' });
        return;
      }

      const displayName =
        typeof profile.name === 'string' && profile.name.trim()
          ? profile.name.trim()
          : email.split('@')[0] || 'IT Staff Member';

      const authResult = await verifyAndAuthenticateOAuthUser({
        email,
        displayName,
        provider: 'Google',
      });

      if (!authResult.ok) {
        res.status(authResult.status).json({ error: authResult.error });
        return;
      }

      res.cookie('av_session', authResult.token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      res.json({
        token: authResult.token,
        user: authResult.user,
        engine: db.engine,
      });
    } catch (err) {
      console.error('Google login error:', err);
      res.status(500).json({ error: 'Google authentication service error.' });
    }
  });

  function resolveGitHubRedirectUri(req: express.Request): string {
    const appUrl = (process.env.APP_URL || '')
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\/$/, '');
    if (appUrl && /^https?:\/\/[^/]+$/i.test(appUrl)) {
      return `${appUrl}/api/auth/github/callback`;
    }

    const bodyOrigin =
      typeof req.body?.origin === 'string' ? req.body.origin.trim().replace(/\/$/, '') : '';
    const queryOrigin =
      typeof req.query.origin === 'string' ? req.query.origin.trim().replace(/\/$/, '') : '';
    const originHint = bodyOrigin || queryOrigin;
    if (originHint && /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/i.test(originHint)) {
      return `${originHint}/api/auth/github/callback`;
    }

    const vercelUrl = (process.env.VERCEL_URL || '').trim().replace(/\/$/, '');
    if (vercelUrl) {
      return `https://${vercelUrl}/api/auth/github/callback`;
    }

    const protoHeader = req.headers['x-forwarded-proto'];
    const proto =
      typeof protoHeader === 'string'
        ? protoHeader.split(',')[0].trim()
        : req.protocol || 'http';
    const hostHeader = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
    const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
    return `${proto}://${host}/api/auth/github/callback`;
  }

  function renderGitHubPopupResult(
    payload:
      | { type: 'GITHUB_OAUTH_SUCCESS'; token: string; user: unknown }
      | { type: 'GITHUB_OAUTH_ERROR'; error: string }
  ): string {
    const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>AssetVault IT — GitHub Sign-In</title>
    <style>
      body { font-family: system-ui, -apple-system, sans-serif; background: #F8FAFC; color: #0F172A; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
      .card { background: #fff; border: 1px solid #E2E8F0; border-radius: 12px; padding: 24px; max-width: 380px; text-align: center; }
      p { font-size: 14px; color: #475569; margin: 8px 0 0; }
    </style>
  </head>
  <body>
    <div class="card">
      <strong>${payload.type === 'GITHUB_OAUTH_SUCCESS' ? 'Authentication Complete' : 'Authentication Failed'}</strong>
      <p>${payload.type === 'GITHUB_OAUTH_SUCCESS' ? 'Returning to AssetVault IT. You can close this window.' : 'Returning to sign-in screen...'}</p>
    </div>
    <script>
      (function () {
        var data = ${serialized};
        if (window.opener) {
          window.opener.postMessage(data, '*');
          window.close();
        } else {
          window.location.href = '/';
        }
      })();
    </script>
  </body>
</html>`;
  }

  const handleGitHubAuthUrl = (req: express.Request, res: express.Response) => {
    const clientId = (process.env.GITHUB_CLIENT_ID || '')
      .trim()
      .replace(/^["']|["']$/g, '');
    const clientSecret = (process.env.GITHUB_CLIENT_SECRET || '')
      .trim()
      .replace(/^["']|["']$/g, '');

    if (!clientId || !clientSecret) {
      res.status(503).json({
        error:
          'GitHub Sign-In is not configured yet. Add GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET to your environment variables.',
      });
      return;
    }

    const redirectUri = resolveGitHubRedirectUri(req);
    const state = signOAuthState({
      nonce: crypto.randomUUID(),
      redirectUri,
      exp: Date.now() + 1000 * 60 * 10,
    });

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
    });

    res.json({
      url: `https://github.com/login/oauth/authorize?${params.toString()}`,
      redirectUri,
    });
  };

  app.get('/api/auth/github/url', handleGitHubAuthUrl);
  app.post('/api/auth/github/url', handleGitHubAuthUrl);

  app.get(['/api/auth/github/callback', '/api/auth/github/callback/'], async (req, res) => {
    try {
      const oauthError = typeof req.query.error === 'string' ? req.query.error : '';
      if (oauthError) {
        const desc =
          typeof req.query.error_description === 'string' && req.query.error_description
            ? req.query.error_description
            : 'GitHub sign-in was cancelled or denied.';
        res.status(400).send(renderGitHubPopupResult({ type: 'GITHUB_OAUTH_ERROR', error: desc }));
        return;
      }

      const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
      const rawState = typeof req.query.state === 'string' ? req.query.state.trim() : '';
      if (!code || !rawState) {
        res.status(400).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error: 'Missing GitHub authorization code or state.',
          })
        );
        return;
      }

      const statePayload = verifyOAuthState(rawState);
      if (!statePayload) {
        res.status(400).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error: 'GitHub sign-in session expired or failed state verification. Please try again.',
          })
        );
        return;
      }

      const clientId = (process.env.GITHUB_CLIENT_ID || '')
        .trim()
        .replace(/^["']|["']$/g, '');
      const clientSecret = (process.env.GITHUB_CLIENT_SECRET || '')
        .trim()
        .replace(/^["']|["']$/g, '');

      if (!clientId || !clientSecret) {
        res.status(503).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error: 'GitHub OAuth credentials are not configured on the server.',
          })
        );
        return;
      }

      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: statePayload.redirectUri,
        }),
      });

      const tokenData = (await tokenRes.json()) as {
        access_token?: string;
        error?: string;
        error_description?: string;
      };

      if (!tokenRes.ok || !tokenData.access_token) {
        res.status(401).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error:
              tokenData.error_description ||
              'Failed to exchange GitHub authorization code.',
          })
        );
        return;
      }

      const ghHeaders = {
        Authorization: `Bearer ${tokenData.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'AssetVault-IT',
      };

      const [ghUserRes, ghEmailsRes] = await Promise.all([
        fetch('https://api.github.com/user', { headers: ghHeaders }),
        fetch('https://api.github.com/user/emails', { headers: ghHeaders }),
      ]);

      if (!ghUserRes.ok || !ghEmailsRes.ok) {
        res.status(401).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error: 'Unable to verify GitHub profile and email status.',
          })
        );
        return;
      }

      const ghUser = (await ghUserRes.json()) as {
        login?: string;
        name?: string | null;
      };

      const emails = (await ghEmailsRes.json()) as Array<{
        email?: string;
        primary?: boolean;
        verified?: boolean;
      }>;
      const primaryVerified = Array.isArray(emails)
        ? emails.find((e) => e.primary && e.verified === true && e.email)
        : undefined;
      const anyVerified = Array.isArray(emails)
        ? emails.find((e) => e.verified === true && e.email)
        : undefined;
      const verifiedEmail = (primaryVerified?.email || anyVerified?.email || '')
        .trim()
        .toLowerCase();

      if (!verifiedEmail) {
        res.status(401).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error: 'A verified email address on your GitHub account is required to sign in.',
          })
        );
        return;
      }

      const displayName =
        (typeof ghUser.name === 'string' && ghUser.name.trim()) ||
        (typeof ghUser.login === 'string' && ghUser.login.trim()) ||
        verifiedEmail.split('@')[0] ||
        'IT Staff Member';

      const authResult = await verifyAndAuthenticateOAuthUser({
        email: verifiedEmail,
        displayName,
        provider: 'GitHub',
      });

      if (!authResult.ok) {
        res.status(authResult.status).send(
          renderGitHubPopupResult({
            type: 'GITHUB_OAUTH_ERROR',
            error: authResult.error,
          })
        );
        return;
      }

      const isHttps = statePayload.redirectUri.startsWith('https://');
      res.cookie('av_session', authResult.token, {
        httpOnly: true,
        sameSite: isHttps ? 'none' : 'lax',
        secure: isHttps,
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      res.send(
        renderGitHubPopupResult({
          type: 'GITHUB_OAUTH_SUCCESS',
          token: authResult.token,
          user: authResult.user,
        })
      );
    } catch (err) {
      console.error('GitHub OAuth callback error:', err);
      res.status(500).send(
        renderGitHubPopupResult({
          type: 'GITHUB_OAUTH_ERROR',
          error: 'GitHub authentication failed due to a server error.',
        })
      );
    }
  });

  app.post('/api/auth/register', async (req, res) => {
    try {
      const body = req.body ?? {};
      const name = String(body.name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const password = String(body.password ?? '');
      const companyName = String(body.companyName ?? '').trim();
      const tenantType: TenantType = body.tenantType === 'msp' ? 'msp' : 'company';
      const requestedPlan = String(body.planCode ?? 'professional') as PlanCode;
      const validPlans: PlanCode[] = ['starter', 'professional', 'business', 'enterprise'];
      const planCode: PlanCode = validPlans.includes(requestedPlan)
        ? requestedPlan
        : 'professional';

      if (!name || !email || !password || !companyName) {
        res.status(400).json({
          error: 'Full name, work email, password, and organisation name are required.',
        });
        return;
      }
      if (!isValidEmail(email)) {
        res.status(400).json({ error: 'Please enter a valid work email address.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' });
        return;
      }

      const existing = await db.findUserByEmail(email);
      if (existing) {
        res.status(409).json({
          error: `An account with email "${email}" already exists.`,
        });
        return;
      }

      const now = new Date().toISOString();
      const trialDays = store.data.platformSettings.trialDays || 14;
      const trialEndsAt = new Date(
        Date.now() + trialDays * 24 * 60 * 60 * 1000
      ).toISOString();

      const newUser = await db.createUser({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        name,
        email,
        password_hash: hashPassword(password),
        role: 'admin',
        department: 'IT Infrastructure',
        status: 'active',
        created_at: now,
        last_login: now,
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
        status: 'trial',
        ownerUserId: newUser.id,
        planCode,
        deploymentMode: planCode === 'enterprise' ? 'dedicated_enterprise' : 'shared_cloud',
        supportEmail: email,
        country: String(body.country ?? 'Ghana').trim() || 'Ghana',
        createdAt: now,
        updatedAt: now,
      };

      const defaultOrg: ClientOrganisation = {
        id: `org-${crypto.randomUUID().slice(0, 8)}`,
        tenantId,
        name: tenantType === 'msp' ? `${companyName} (Primary Client)` : companyName,
        code: 'HQ-01',
        industry: String(body.industry ?? 'Enterprise IT').trim(),
        contactName: name,
        contactEmail: email,
        contactPhone: String(body.phone ?? '').trim(),
        address: String(body.address ?? '').trim(),
        status: 'active',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      };

      const ownerRole: TenantRole =
        tenantType === 'msp' ? 'msp_admin' : 'tenant_owner';
      const membership: UserMembership = {
        id: `${newUser.id}_${tenantId}`,
        userId: newUser.id,
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
      const subscription: TenantSubscription = {
        id: `sub-${crypto.randomUUID().slice(0, 8)}`,
        tenantId,
        planCode,
        billingCycle: 'monthly',
        status: 'trialing',
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
        graceEndsAt: null,
        cancelAtPeriodEnd: false,
        amountGhs: plan.monthlyPriceGhs,
        updatedAt: now,
      };

      await store.mutate((s) => {
        store.seedTenantDefaults({
          tenant,
          defaultOrg,
          ownerMembership: membership,
          subscription,
        });
        void s;
      });

      const token = signSessionToken({
        id: newUser.id,
        email: newUser.email,
        role: newUser.role,
      });

      res.cookie('av_session', token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000 * 60 * 60 * 24 * 7,
      });

      res.status(201).json({
        token,
        user: newUser,
        tenant,
        engine: db.engine,
      });
    } catch (err) {
      console.error('Register error:', err);
      res.status(500).json({ error: 'Workspace registration failed.' });
    }
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      res.status(400).json({ error: 'Valid work email is required.' });
      return;
    }
    const user = await db.findUserByEmail(email);
    if (!user) {
      res.json({
        ok: true,
        message: 'If an account matches that email, reset instructions are ready.',
      });
      return;
    }
    const resetToken = crypto.randomBytes(16).toString('hex');
    await store.mutate((s) => {
      s.passwordResetTokens.push({
        token: resetToken,
        userId: user.id,
        email: user.email,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      });
    });
    res.json({
      ok: true,
      message: store.data.platformSettings.smtpConfigured
        ? 'Password reset email dispatched.'
        : 'SMTP is in test mode. Use the generated reset token below to complete reset.',
      testResetToken: store.data.platformSettings.smtpConfigured
        ? undefined
        : resetToken,
    });
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const newPassword = String(req.body?.newPassword ?? '');
    if (!token || newPassword.length < 8) {
      res.status(400).json({
        error: 'Reset token and new password (min 8 chars) are required.',
      });
      return;
    }
    const entry = store.data.passwordResetTokens.find((t) => t.token === token);
    if (!entry || new Date(entry.expiresAt).getTime() < Date.now()) {
      res.status(400).json({ error: 'Reset token is invalid or expired.' });
      return;
    }
    await db.updateUser(entry.userId, { password_hash: hashPassword(newPassword) });
    await store.mutate((s) => {
      s.passwordResetTokens = s.passwordResetTokens.filter((t) => t.token !== token);
    });
    res.json({ ok: true });
  });

  app.post('/api/auth/logout', (_req, res) => {
    res.clearCookie('av_session', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.authUser, engine: db.engine });
  });

  // Register multi-tenant SaaS, Helpdesk, ITSM, Billing, & Super Admin routes
  registerSaasRoutes({
    app,
    db,
    store,
    requireAuth: requireAuth as unknown as (
      req: express.Request,
      res: express.Response,
      next: () => void
    ) => void,
    resolveTenantContext: resolveTenantContext as unknown as (
      req: express.Request,
      res: express.Response,
      next: () => void
    ) => void,
  });

  // -------------------------------------------------------------------------
  // Dashboard Route (Tenant & Client-Org Scoped)
  // -------------------------------------------------------------------------
  app.get(
    '/api/dashboard',
    ...tenantGuard,
    requirePermission('dashboard.read'),
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const summary = await db.getDashboardSummary(
          req.authUser!.id,
          ctx.scopeFilter
        );

        const scopedTickets = store.data.tickets.filter(
          (t) =>
            t.tenantId === ctx.tenant.id &&
            (!ctx.scopeFilter.orgIds || ctx.scopeFilter.orgIds.includes(t.orgId))
        );
        const scopedLicences = store.data.softwareLicences.filter(
          (l) =>
            l.tenantId === ctx.tenant.id &&
            (!ctx.scopeFilter.orgIds || ctx.scopeFilter.orgIds.includes(l.orgId))
        );
        const scopedContracts = store.data.contracts.filter(
          (c) =>
            c.tenantId === ctx.tenant.id &&
            (!ctx.scopeFilter.orgIds || ctx.scopeFilter.orgIds.includes(c.orgId))
        );

        summary.counts.openTickets = scopedTickets.filter(
          (t) => t.status !== 'Resolved' && t.status !== 'Closed'
        ).length;
        summary.counts.slaBreachedTickets = scopedTickets.filter(
          (t) => t.slaBreached && t.status !== 'Resolved' && t.status !== 'Closed'
        ).length;
        summary.counts.activeLicences = scopedLicences.filter(
          (l) => l.status !== 'Expired'
        ).length;
        summary.counts.activeContracts = scopedContracts.filter(
          (c) => c.status !== 'Expired'
        ).length;
        summary.financials.annualLicenceSpend = scopedLicences.reduce(
          (sum, l) => sum + Number(l.costPerYearGhs || 0),
          0
        );

        res.json(summary);
      } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'Failed to load dashboard metrics.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Assets Routes (Tenant + Org Scoped, Quota & Permission Enforced)
  // -------------------------------------------------------------------------
  app.get(
    '/api/assets',
    ...tenantGuard,
    requirePermission('assets.read'),
    async (req: TenantRequest, res) => {
      try {
        const assets = await db.listAssets(req.tenantCtx!.scopeFilter);
        res.json({
          assets: assets.map((a) => enrichAssetWithSaasMeta(a, store)),
        });
      } catch (err) {
        console.error('List assets error:', err);
        res.status(500).json({ error: 'Failed to load assets.' });
      }
    }
  );

  app.get(
    '/api/assets/:id',
    ...tenantGuard,
    requirePermission('assets.read'),
    async (req: TenantRequest, res) => {
      try {
        const id = String(req.params.id);
        const asset = await db.getAssetById(id);
        if (
          !asset ||
          !canAccessRecordOrg(req.tenantCtx!, asset.tenant_id, asset.org_id)
        ) {
          res.status(404).json({ error: 'Asset not found.' });
          return;
        }
        const [assignments, maintenanceLogs] = await Promise.all([
          db.listAssignmentsByAsset(id),
          db.listMaintenanceByAsset(id),
        ]);
        const tickets = store.data.tickets.filter((t) => t.assetId === id);
        const transfers = store.data.assetTransfers.filter((t) => t.assetId === id);
        res.json({
          asset: enrichAssetWithSaasMeta(asset, store),
          assignments,
          maintenanceLogs,
          tickets,
          transfers,
        });
      } catch (err) {
        console.error('Get asset detail error:', err);
        res.status(500).json({ error: 'Failed to load asset details.' });
      }
    }
  );

  app.post(
    '/api/assets',
    ...tenantGuard,
    requirePermission('assets.create'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const quota = checkQuotaExceeded(
          ctx.effectiveLimits.maxAssets,
          ctx.usage.assetsCount,
          'assets',
          ctx.plan.name
        );
        if (!quota.ok) {
          res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
          return;
        }

        const body = req.body ?? {};
        const asset_tag = String(body.asset_tag ?? '').trim().toUpperCase();
        const name = String(body.name ?? '').trim();
        const category = String(body.category ?? '') as AssetCategory;
        const brand = String(body.brand ?? '').trim();
        const model = String(body.model ?? '').trim();
        const serial_number = String(body.serial_number ?? '').trim().toUpperCase();
        const purchase_date = String(body.purchase_date ?? '').trim();
        const cost = Number(body.cost);
        const warranty_expiry = String(body.warranty_expiry ?? '').trim();
        const status = (String(body.status ?? 'Available') as AssetStatus) || 'Available';
        const location = String(body.location ?? '').trim() || 'IT Vault';
        const notes = String(body.notes ?? '').trim();

        const requestedOrgId = body.org_id ? String(body.org_id).trim() : ctx.targetOrgId;
        if (!canAccessRecordOrg(ctx, ctx.tenant.id, requestedOrgId)) {
          res.status(403).json({ error: 'Access denied to target organisation.' });
          return;
        }

        if (!asset_tag || !name || !brand || !model || !serial_number) {
          res.status(400).json({
            error: 'Asset tag, name, brand, model, and serial number are required.',
          });
          return;
        }
        if (!ASSET_CATEGORIES.includes(category)) {
          res.status(400).json({ error: 'Invalid asset category selected.' });
          return;
        }
        if (!ASSET_STATUSES.includes(status)) {
          res.status(400).json({ error: 'Invalid asset status selected.' });
          return;
        }
        if (status === 'Assigned') {
          res.status(400).json({
            error:
              'Create assets as Available first, then use Asset Assignment to issue to an employee.',
          });
          return;
        }
        if (!isIsoDate(purchase_date) || !isIsoDate(warranty_expiry)) {
          res.status(400).json({
            error: 'Purchase date and warranty expiry must be valid YYYY-MM-DD dates.',
          });
          return;
        }
        if (!Number.isFinite(cost) || cost < 0) {
          res.status(400).json({ error: 'Asset cost must be a valid non-negative number.' });
          return;
        }

        const existingAssets = await db.listAssets({ tenantId: ctx.tenant.id });
        if (existingAssets.some((a) => a.asset_tag.toUpperCase() === asset_tag)) {
          res.status(409).json({ error: `Asset tag "${asset_tag}" is already registered.` });
          return;
        }
        if (existingAssets.some((a) => a.serial_number.toUpperCase() === serial_number)) {
          res.status(409).json({
            error: `Serial number "${serial_number}" is already registered.`,
          });
          return;
        }

        const now = new Date().toISOString();
        const assetId = `ast-${crypto.randomUUID().slice(0, 8)}`;
        const newAsset: Asset = {
          id: assetId,
          asset_tag,
          name,
          category,
          brand,
          model,
          serial_number,
          purchase_date,
          cost,
          warranty_expiry,
          status,
          assigned_employee_id: null,
          assigned_date: null,
          location,
          notes,
          created_at: now,
          updated_at: now,
          tenant_id: ctx.tenant.id,
          org_id: requestedOrgId,
        };

        const created = await db.createAsset(newAsset);
        await store.mutate((s) => {
          s.assetMeta[assetId] = {
            location_id: body.location_id ? String(body.location_id) : undefined,
            department_id: body.department_id ? String(body.department_id) : undefined,
            vendor_id: body.vendor_id ? String(body.vendor_id) : null,
            barcode_value: asset_tag,
            qr_payload: JSON.stringify({
              id: assetId,
              tag: asset_tag,
              serial: serial_number,
              tenant: ctx.tenant.id,
            }),
            specs: body.specs && typeof body.specs === 'object' ? body.specs : undefined,
            depreciation_method: body.depreciation_method || 'straight_line',
            useful_life_years: Number(body.useful_life_years ?? 4),
            salvage_value: Number(body.salvage_value ?? 0),
            disposal_status: 'none',
          };
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: requestedOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ASSET_CREATED',
          entityType: 'asset',
          entityId: assetId,
          summary: `Registered asset ${asset_tag} (${name})`,
        });
        res.status(201).json({ asset: enrichAssetWithSaasMeta(created, store) });
      } catch (err) {
        console.error('Create asset error:', err);
        res.status(500).json({ error: 'Failed to create asset.' });
      }
    }
  );

  app.post(
    '/api/assets/import',
    ...tenantGuard,
    requirePermission('assets.import'),
    requireWritableSubscription,
    requireFeature('bulk_import', 'Bulk CSV/Excel Asset Import'),
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const rows = Array.isArray(req.body?.assets) ? req.body.assets : [];
        if (rows.length === 0) {
          res.status(400).json({ error: 'No asset rows provided for import.' });
          return;
        }
        const quota = checkQuotaExceeded(
          ctx.effectiveLimits.maxAssets,
          ctx.usage.assetsCount + rows.length - 1,
          'assets',
          ctx.plan.name
        );
        if (!quota.ok) {
          res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
          return;
        }

        const existingAssets = await db.listAssets({ tenantId: ctx.tenant.id });
        const tags = new Set(existingAssets.map((a) => a.asset_tag.toUpperCase()));
        const serials = new Set(existingAssets.map((a) => a.serial_number.toUpperCase()));

        const created: Asset[] = [];
        const skipped: Array<{ row: number; reason: string }> = [];
        const now = new Date().toISOString();

        for (let idx = 0; idx < rows.length; idx += 1) {
          const r = rows[idx] || {};
          const tag = String(r.asset_tag ?? '').trim().toUpperCase();
          const name = String(r.name ?? '').trim();
          const serial = String(r.serial_number ?? '').trim().toUpperCase();
          const category = (ASSET_CATEGORIES.includes(r.category)
            ? r.category
            : 'Laptops') as AssetCategory;
          if (!tag || !name || !serial) {
            skipped.push({ row: idx + 1, reason: 'Missing tag, name, or serial number' });
            continue;
          }
          if (tags.has(tag) || serials.has(serial)) {
            skipped.push({ row: idx + 1, reason: `Duplicate tag (${tag}) or serial` });
            continue;
          }
          tags.add(tag);
          serials.add(serial);
          const assetId = `ast-${crypto.randomUUID().slice(0, 8)}`;
          const item = await db.createAsset({
            id: assetId,
            asset_tag: tag,
            name,
            category,
            brand: String(r.brand ?? 'Generic').trim(),
            model: String(r.model ?? 'Standard').trim(),
            serial_number: serial,
            purchase_date: isIsoDate(String(r.purchase_date ?? ''))
              ? String(r.purchase_date)
              : now.slice(0, 10),
            cost: Number.isFinite(Number(r.cost)) ? Math.max(0, Number(r.cost)) : 0,
            warranty_expiry: isIsoDate(String(r.warranty_expiry ?? ''))
              ? String(r.warranty_expiry)
              : new Date(Date.now() + 365 * 3 * 86400_000).toISOString().slice(0, 10),
            status: 'Available',
            assigned_employee_id: null,
            assigned_date: null,
            location: String(r.location ?? 'Main HQ').trim(),
            notes: String(r.notes ?? 'Imported via CSV/Excel').trim(),
            created_at: now,
            updated_at: now,
            tenant_id: ctx.tenant.id,
            org_id: ctx.targetOrgId,
          });
          created.push(enrichAssetWithSaasMeta(item, store));
        }

        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ASSETS_BULK_IMPORTED',
          entityType: 'asset',
          entityId: 'bulk',
          summary: `Imported ${created.length} assets (${skipped.length} skipped)`,
        });

        res.status(201).json({ importedCount: created.length, skipped, assets: created });
      } catch (err) {
        console.error('Bulk import error:', err);
        res.status(500).json({ error: 'Bulk asset import failed.' });
      }
    }
  );

  app.put(
    '/api/assets/:id',
    ...tenantGuard,
    requirePermission('assets.update'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const current = await db.getAssetById(id);
        if (!current || !canAccessRecordOrg(ctx, current.tenant_id, current.org_id)) {
          res.status(404).json({ error: 'Asset not found.' });
          return;
        }

        const body = req.body ?? {};
        const asset_tag = String(body.asset_tag ?? current.asset_tag).trim().toUpperCase();
        const name = String(body.name ?? current.name).trim();
        const category = String(body.category ?? current.category) as AssetCategory;
        const brand = String(body.brand ?? current.brand).trim();
        const model = String(body.model ?? current.model).trim();
        const serial_number = String(body.serial_number ?? current.serial_number)
          .trim()
          .toUpperCase();
        const purchase_date = String(body.purchase_date ?? current.purchase_date).trim();
        const cost = body.cost !== undefined ? Number(body.cost) : current.cost;
        const warranty_expiry = String(
          body.warranty_expiry ?? current.warranty_expiry
        ).trim();
        const status = String(body.status ?? current.status) as AssetStatus;
        const location = String(body.location ?? current.location).trim();
        const notes = String(body.notes ?? current.notes).trim();

        if (!asset_tag || !name || !brand || !model || !serial_number) {
          res.status(400).json({
            error: 'Asset tag, name, brand, model, and serial number are required.',
          });
          return;
        }
        if (!ASSET_CATEGORIES.includes(category)) {
          res.status(400).json({ error: 'Invalid asset category selected.' });
          return;
        }
        if (!ASSET_STATUSES.includes(status)) {
          res.status(400).json({ error: 'Invalid asset status selected.' });
          return;
        }
        if (!isIsoDate(purchase_date) || !isIsoDate(warranty_expiry)) {
          res.status(400).json({
            error: 'Purchase date and warranty expiry must be valid YYYY-MM-DD dates.',
          });
          return;
        }
        if (!Number.isFinite(cost) || cost < 0) {
          res.status(400).json({ error: 'Asset cost must be a valid non-negative number.' });
          return;
        }

        if (current.status === 'Assigned' && status === 'Available') {
          res.status(400).json({
            error:
              'Use the Asset Return workflow to return an assigned asset back to Available.',
          });
          return;
        }
        if (
          current.status !== 'Assigned' &&
          status === 'Assigned' &&
          !current.assigned_employee_id
        ) {
          res.status(400).json({
            error: 'Use the Asset Assignment workflow to assign an asset to an employee.',
          });
          return;
        }

        const existingAssets = await db.listAssets({ tenantId: ctx.tenant.id });
        if (
          existingAssets.some(
            (a) => a.id !== id && a.asset_tag.toUpperCase() === asset_tag
          )
        ) {
          res.status(409).json({
            error: `Asset tag "${asset_tag}" is already used by another asset.`,
          });
          return;
        }
        if (
          existingAssets.some(
            (a) => a.id !== id && a.serial_number.toUpperCase() === serial_number
          )
        ) {
          res.status(409).json({
            error: `Serial number "${serial_number}" is already used by another asset.`,
          });
          return;
        }

        const updated = await db.updateAsset(id, {
          asset_tag,
          name,
          category,
          brand,
          model,
          serial_number,
          purchase_date,
          cost,
          warranty_expiry,
          status,
          location,
          notes,
          updated_at: new Date().toISOString(),
        });

        await store.mutate((s) => {
          const prev = s.assetMeta[id] || {};
          s.assetMeta[id] = {
            ...prev,
            specs: body.specs !== undefined ? body.specs : prev.specs,
            depreciation_method:
              body.depreciation_method ?? prev.depreciation_method ?? 'straight_line',
            useful_life_years:
              body.useful_life_years !== undefined
                ? Number(body.useful_life_years)
                : prev.useful_life_years ?? 4,
            salvage_value:
              body.salvage_value !== undefined
                ? Number(body.salvage_value)
                : prev.salvage_value ?? 0,
            barcode_value: asset_tag,
          };
        });

        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: current.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ASSET_UPDATED',
          entityType: 'asset',
          entityId: id,
          summary: `Updated asset ${asset_tag} (${name})`,
        });

        res.json({
          asset: updated ? enrichAssetWithSaasMeta(updated, store) : null,
        });
      } catch (err) {
        console.error('Update asset error:', err);
        res.status(500).json({ error: 'Failed to update asset.' });
      }
    }
  );

  app.post(
    '/api/assets/:id/transfer',
    ...tenantGuard,
    requirePermission('assets.transfer'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const asset = await db.getAssetById(id);
      if (!asset || !canAccessRecordOrg(ctx, asset.tenant_id, asset.org_id)) {
        res.status(404).json({ error: 'Asset not found.' });
        return;
      }
      const toLocation = String(req.body?.toLocation ?? '').trim();
      const toOrgId = String(req.body?.toOrgId || asset.org_id || ctx.targetOrgId);
      const toDepartment = String(req.body?.toDepartment ?? '').trim();
      const reason = String(req.body?.reason ?? '').trim();
      if (!toLocation || !reason) {
        res.status(400).json({ error: 'Target location and transfer reason are required.' });
        return;
      }
      if (!canAccessRecordOrg(ctx, ctx.tenant.id, toOrgId)) {
        res.status(403).json({ error: 'Access denied to destination organisation.' });
        return;
      }

      const transfer = {
        id: `trf-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        orgId: toOrgId,
        assetId: asset.id,
        assetTag: asset.asset_tag,
        assetName: asset.name,
        fromLocation: asset.location,
        toLocation,
        fromOrgId: asset.org_id || ctx.targetOrgId,
        toOrgId,
        fromDepartment: asset.assigned_employee_department || 'Pool',
        toDepartment: toDepartment || 'Pool',
        reason,
        transferredBy: req.authUser!.name,
        transferredAt: new Date().toISOString(),
      };
      await db.updateAsset(asset.id, {
        location: toLocation,
        org_id: toOrgId,
        updated_at: new Date().toISOString(),
      });
      await store.mutate((s) => {
        s.assetTransfers.unshift(transfer);
      });
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: toOrgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'ASSET_TRANSFERRED',
        entityType: 'asset',
        entityId: asset.id,
        summary: `Transferred ${asset.asset_tag} from ${asset.location} to ${toLocation}`,
      });
      res.status(201).json({ transfer });
    }
  );

  app.post(
    '/api/assets/:id/dispose',
    ...tenantGuard,
    requirePermission('assets.dispose'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const id = String(req.params.id);
      const asset = await db.getAssetById(id);
      if (!asset || !canAccessRecordOrg(ctx, asset.tenant_id, asset.org_id)) {
        res.status(404).json({ error: 'Asset not found.' });
        return;
      }
      if (asset.status === 'Assigned') {
        res.status(400).json({ error: 'Return assigned asset before decommissioning.' });
        return;
      }
      const reason = String(req.body?.reason ?? '').trim() || 'End of lifecycle';
      const now = new Date().toISOString();
      await db.updateAsset(asset.id, {
        status: 'Retired',
        updated_at: now,
      });
      await store.mutate((s) => {
        const prev = s.assetMeta[asset.id] || {};
        s.assetMeta[asset.id] = {
          ...prev,
          disposal_status: 'disposed',
          disposal_reason: reason,
          disposal_date: now.slice(0, 10),
          disposal_approved_by: req.authUser!.name,
        };
      });
      await store.appendAuditLog({
        tenantId: ctx.tenant.id,
        orgId: asset.org_id || ctx.targetOrgId,
        actorUserId: req.authUser!.id,
        actorEmail: req.authUser!.email,
        actorRole: ctx.membership.role,
        action: 'ASSET_DISPOSED',
        entityType: 'asset',
        entityId: asset.id,
        summary: `Decommissioned & disposed ${asset.asset_tag}: ${reason}`,
      });
      const updated = await db.getAssetById(asset.id);
      res.json({ asset: updated ? enrichAssetWithSaasMeta(updated, store) : null });
    }
  );

  app.delete(
    '/api/assets/:id',
    ...tenantGuard,
    requirePermission('assets.delete'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const asset = await db.getAssetById(id);
        if (!asset || !canAccessRecordOrg(ctx, asset.tenant_id, asset.org_id)) {
          res.status(404).json({ error: 'Asset not found.' });
          return;
        }
        if (asset.status === 'Assigned') {
          res.status(400).json({
            error: 'Cannot delete an assigned asset. Return it from the employee first.',
          });
          return;
        }
        await db.deleteAsset(id);
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: asset.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ASSET_DELETED',
          entityType: 'asset',
          entityId: id,
          summary: `Deleted asset ${asset.asset_tag}`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete asset error:', err);
        res.status(500).json({ error: 'Failed to delete asset.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Employees Routes (Tenant + Org Scoped & RBAC Enforced)
  // -------------------------------------------------------------------------
  app.get(
    '/api/employees',
    ...tenantGuard,
    requirePermission('employees.read'),
    async (req: TenantRequest, res) => {
      try {
        const employees = await db.listEmployees(req.tenantCtx!.scopeFilter);
        res.json({ employees });
      } catch (err) {
        console.error('List employees error:', err);
        res.status(500).json({ error: 'Failed to load employees.' });
      }
    }
  );

  app.get(
    '/api/employees/:id',
    ...tenantGuard,
    requirePermission('employees.read'),
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const employee = await db.getEmployeeById(id);
        if (
          !employee ||
          !canAccessRecordOrg(ctx, employee.tenant_id, employee.org_id)
        ) {
          res.status(404).json({ error: 'Employee not found.' });
          return;
        }
        const [assets, assignments] = await Promise.all([
          db.listAssets(ctx.scopeFilter),
          db.listAssignmentsByEmployee(id),
        ]);
        const assignedAssets = assets.filter(
          (a) => a.assigned_employee_id === id && a.status === 'Assigned'
        );
        const scopedAssignments = assignments.filter((a) =>
          canAccessRecordOrg(ctx, a.tenant_id, a.org_id)
        );
        res.json({ employee, assignedAssets, assignments: scopedAssignments });
      } catch (err) {
        console.error('Get employee detail error:', err);
        res.status(500).json({ error: 'Failed to load employee details.' });
      }
    }
  );

  app.post(
    '/api/employees',
    ...tenantGuard,
    requirePermission('employees.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const body = req.body ?? {};
        const employee_code = String(body.employee_code ?? '').trim().toUpperCase();
        const full_name = String(body.full_name ?? '').trim();
        const email = String(body.email ?? '').trim().toLowerCase();
        const department = String(body.department ?? '').trim();
        const job_title = String(body.job_title ?? '').trim();
        const phone = String(body.phone ?? '').trim();
        const location = String(body.location ?? '').trim();
        const status = body.status === 'inactive' ? 'inactive' : 'active';
        const requestedOrgId = body.org_id
          ? String(body.org_id).trim()
          : ctx.targetOrgId;

        if (!canAccessRecordOrg(ctx, ctx.tenant.id, requestedOrgId)) {
          res.status(403).json({ error: 'Access denied to target organisation.' });
          return;
        }

        if (!employee_code || !full_name || !email || !department || !job_title) {
          res.status(400).json({
            error:
              'Employee code, full name, email, department, and job title are required.',
          });
          return;
        }
        if (!isValidEmail(email)) {
          res.status(400).json({ error: 'Please enter a valid work email address.' });
          return;
        }

        const existing = await db.listEmployees({ tenantId: ctx.tenant.id });
        if (existing.some((e) => e.employee_code.toUpperCase() === employee_code)) {
          res.status(409).json({
            error: `Employee code "${employee_code}" is already registered.`,
          });
          return;
        }
        if (existing.some((e) => e.email.toLowerCase() === email)) {
          res.status(409).json({
            error: `Email "${email}" is already assigned to an employee.`,
          });
          return;
        }

        const employee: Employee = {
          id: `emp-${crypto.randomUUID().slice(0, 8)}`,
          employee_code,
          full_name,
          email,
          department,
          job_title,
          phone,
          location: location || 'Main HQ',
          status,
          created_at: new Date().toISOString(),
          tenant_id: ctx.tenant.id,
          org_id: requestedOrgId,
        };
        const created = await db.createEmployee(employee);
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: requestedOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'EMPLOYEE_CREATED',
          entityType: 'employee',
          entityId: created.id,
          summary: `Registered employee ${employee_code} (${full_name})`,
        });
        res.status(201).json({ employee: created });
      } catch (err) {
        console.error('Create employee error:', err);
        res.status(500).json({ error: 'Failed to register employee.' });
      }
    }
  );

  app.put(
    '/api/employees/:id',
    ...tenantGuard,
    requirePermission('employees.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const current = await db.getEmployeeById(id);
        if (
          !current ||
          !canAccessRecordOrg(ctx, current.tenant_id, current.org_id)
        ) {
          res.status(404).json({ error: 'Employee not found.' });
          return;
        }

        const body = req.body ?? {};
        const employee_code = String(body.employee_code ?? current.employee_code)
          .trim()
          .toUpperCase();
        const full_name = String(body.full_name ?? current.full_name).trim();
        const email = String(body.email ?? current.email).trim().toLowerCase();
        const department = String(body.department ?? current.department).trim();
        const job_title = String(body.job_title ?? current.job_title).trim();
        const phone = String(body.phone ?? current.phone).trim();
        const location = String(body.location ?? current.location).trim();
        const status =
          body.status === 'inactive' || body.status === 'active'
            ? body.status
            : current.status;

        if (!employee_code || !full_name || !email || !department || !job_title) {
          res.status(400).json({
            error:
              'Employee code, full name, email, department, and job title are required.',
          });
          return;
        }
        if (!isValidEmail(email)) {
          res.status(400).json({ error: 'Please enter a valid work email address.' });
          return;
        }

        const existing = await db.listEmployees({ tenantId: ctx.tenant.id });
        if (
          existing.some(
            (e) => e.id !== id && e.employee_code.toUpperCase() === employee_code
          )
        ) {
          res.status(409).json({
            error: `Employee code "${employee_code}" is already used by another employee.`,
          });
          return;
        }
        if (
          existing.some((e) => e.id !== id && e.email.toLowerCase() === email)
        ) {
          res.status(409).json({
            error: `Email "${email}" is already used by another employee.`,
          });
          return;
        }

        const updated = await db.updateEmployee(id, {
          employee_code,
          full_name,
          email,
          department,
          job_title,
          phone,
          location,
          status,
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: current.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'EMPLOYEE_UPDATED',
          entityType: 'employee',
          entityId: id,
          summary: `Updated employee ${employee_code} (${full_name})`,
        });
        res.json({ employee: updated });
      } catch (err) {
        console.error('Update employee error:', err);
        res.status(500).json({ error: 'Failed to update employee.' });
      }
    }
  );

  app.delete(
    '/api/employees/:id',
    ...tenantGuard,
    requirePermission('employees.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const current = await db.getEmployeeById(id);
        if (
          !current ||
          !canAccessRecordOrg(ctx, current.tenant_id, current.org_id)
        ) {
          res.status(404).json({ error: 'Employee not found.' });
          return;
        }
        if ((current.assigned_count ?? 0) > 0) {
          res.status(400).json({
            error:
              'Cannot delete an employee with active assigned assets. Return all assets first.',
          });
          return;
        }
        await db.deleteEmployee(id);
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: current.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'EMPLOYEE_DELETED',
          entityType: 'employee',
          entityId: id,
          summary: `Deleted employee ${current.employee_code} (${current.full_name})`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete employee error:', err);
        res.status(500).json({ error: 'Failed to delete employee.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Asset Assignments Routes (Tenant + Org Scoped)
  // -------------------------------------------------------------------------
  app.get(
    '/api/assignments',
    ...tenantGuard,
    requirePermission('assignments.read'),
    async (req: TenantRequest, res) => {
      try {
        const assignments = await db.listAssignments(req.tenantCtx!.scopeFilter);
        res.json({ assignments });
      } catch (err) {
        console.error('List assignments error:', err);
        res.status(500).json({ error: 'Failed to load asset assignments.' });
      }
    }
  );

  app.post(
    '/api/assignments/assign',
    ...tenantGuard,
    requirePermission('assignments.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const assetId = String(req.body?.asset_id ?? '').trim();
        const employeeId = String(req.body?.employee_id ?? '').trim();
        const assignedDate = String(
          req.body?.assigned_date ?? new Date().toISOString().slice(0, 10)
        ).trim();
        const conditionOut =
          String(req.body?.condition_out ?? 'Good').trim() || 'Good';
        const notes = String(req.body?.notes ?? '').trim();

        if (!assetId || !employeeId) {
          res.status(400).json({ error: 'Both asset and employee are required.' });
          return;
        }
        if (!isIsoDate(assignedDate)) {
          res.status(400).json({
            error: 'Assignment date must be a valid YYYY-MM-DD date.',
          });
          return;
        }

        const [asset, employee] = await Promise.all([
          db.getAssetById(assetId),
          db.getEmployeeById(employeeId),
        ]);
        if (
          !asset ||
          !canAccessRecordOrg(ctx, asset.tenant_id, asset.org_id)
        ) {
          res.status(404).json({ error: 'Selected asset not found.' });
          return;
        }
        if (asset.status !== 'Available') {
          res.status(400).json({
            error: `Asset "${asset.asset_tag}" is currently ${asset.status} and cannot be assigned.`,
          });
          return;
        }
        if (
          !employee ||
          !canAccessRecordOrg(ctx, employee.tenant_id, employee.org_id)
        ) {
          res.status(404).json({ error: 'Selected employee not found.' });
          return;
        }
        if (employee.status !== 'active') {
          res.status(400).json({
            error: `Employee "${employee.full_name}" is inactive and cannot receive assets.`,
          });
          return;
        }

        const assignment = await db.assignAsset({
          assetId,
          employeeId,
          assignedByUserId: req.authUser!.id,
          assignedDate,
          conditionOut,
          notes,
          tenantId: ctx.tenant.id,
          orgId: asset.org_id || ctx.targetOrgId,
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: asset.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ASSET_ASSIGNED',
          entityType: 'assignment',
          entityId: assignment.id,
          summary: `Issued ${asset.asset_tag} to ${employee.full_name} (${assignment.handover_number})`,
        });
        res.status(201).json({ assignment });
      } catch (err) {
        console.error('Assign asset error:', err);
        res.status(500).json({ error: 'Failed to assign asset.' });
      }
    }
  );

  app.post(
    '/api/assignments/:id/return',
    ...tenantGuard,
    requirePermission('assignments.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const current = await db.getAssignmentById(id);
        if (
          !current ||
          !canAccessRecordOrg(ctx, current.tenant_id, current.org_id)
        ) {
          res.status(404).json({ error: 'Assignment record not found.' });
          return;
        }
        if (current.status === 'Returned') {
          res.status(400).json({ error: 'This asset has already been returned.' });
          return;
        }

        const returnedDate = String(
          req.body?.returned_date ?? new Date().toISOString().slice(0, 10)
        ).trim();
        const conditionIn =
          String(req.body?.condition_in ?? 'Good').trim() || 'Good';
        const returnStatus = String(req.body?.return_status ?? 'Available');
        const notes = String(req.body?.notes ?? '').trim();

        if (!isIsoDate(returnedDate)) {
          res
            .status(400)
            .json({ error: 'Return date must be a valid YYYY-MM-DD date.' });
          return;
        }
        if (
          returnStatus !== 'Available' &&
          returnStatus !== 'Under Maintenance' &&
          returnStatus !== 'Damaged'
        ) {
          res.status(400).json({ error: 'Invalid post-return asset status.' });
          return;
        }

        const updated = await db.returnAsset({
          assignmentId: id,
          returnedDate,
          conditionIn,
          returnStatus,
          notes,
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: current.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'ASSET_RETURNED',
          entityType: 'assignment',
          entityId: id,
          summary: `Returned ${current.asset_tag || current.asset_id} from ${
            current.employee_name || current.employee_id
          } as ${returnStatus}`,
        });
        res.json({ assignment: updated });
      } catch (err) {
        console.error('Return asset error:', err);
        res.status(500).json({ error: 'Failed to return asset.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Maintenance Routes (Tenant + Org Scoped)
  // -------------------------------------------------------------------------
  app.get(
    '/api/maintenance',
    ...tenantGuard,
    requirePermission('maintenance.read'),
    async (req: TenantRequest, res) => {
      try {
        const logs = await db.listMaintenanceLogs(req.tenantCtx!.scopeFilter);
        const enriched = logs.map((m) => ({
          ...m,
          ...(store.data.maintenanceMeta[m.id] || {}),
        }));
        res.json({ maintenanceLogs: enriched });
      } catch (err) {
        console.error('List maintenance error:', err);
        res.status(500).json({ error: 'Failed to load maintenance logs.' });
      }
    }
  );

  app.post(
    '/api/maintenance',
    ...tenantGuard,
    requirePermission('maintenance.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const body = req.body ?? {};
        const asset_id = String(body.asset_id ?? '').trim();
        const issue_description = String(body.issue_description ?? '').trim();
        const maintenance_type = String(body.maintenance_type ?? '') as MaintenanceType;
        const vendor_or_technician = String(body.vendor_or_technician ?? '').trim();
        const service_date = String(body.service_date ?? '').trim();
        const next_service_date = body.next_service_date
          ? String(body.next_service_date).trim()
          : null;
        const cost = Number(body.cost ?? 0);
        const status = String(body.status ?? 'In Progress') as MaintenanceStatus;
        const notes = String(body.notes ?? '').trim();
        const setAssetUnderMaintenance = body.set_asset_under_maintenance !== false;
        const ticket_id = body.ticket_id ? String(body.ticket_id).trim() : null;
        const downtime_minutes =
          body.downtime_minutes !== undefined ? Number(body.downtime_minutes) : undefined;

        if (!asset_id || !issue_description || !vendor_or_technician) {
          res.status(400).json({
            error: 'Asset, issue description, and technician/vendor are required.',
          });
          return;
        }
        if (!MAINTENANCE_TYPES.includes(maintenance_type)) {
          res.status(400).json({ error: 'Invalid maintenance type.' });
          return;
        }
        if (!MAINTENANCE_STATUSES.includes(status)) {
          res.status(400).json({ error: 'Invalid maintenance status.' });
          return;
        }
        if (!isIsoDate(service_date)) {
          res.status(400).json({ error: 'Service date must be a valid YYYY-MM-DD date.' });
          return;
        }
        if (next_service_date && !isIsoDate(next_service_date)) {
          res.status(400).json({
            error: 'Next service date must be a valid YYYY-MM-DD date.',
          });
          return;
        }
        if (!Number.isFinite(cost) || cost < 0) {
          res
            .status(400)
            .json({ error: 'Maintenance cost must be a valid non-negative number.' });
          return;
        }

        const asset = await db.getAssetById(asset_id);
        if (!asset || !canAccessRecordOrg(ctx, asset.tenant_id, asset.org_id)) {
          res.status(404).json({ error: 'Selected asset not found.' });
          return;
        }

        const logId = `mnt-${crypto.randomUUID().slice(0, 8)}`;
        const log: MaintenanceLog = {
          id: logId,
          asset_id,
          issue_description,
          maintenance_type,
          vendor_or_technician,
          service_date,
          next_service_date,
          cost,
          status,
          recorded_by_user_id: req.authUser!.id,
          notes,
          created_at: new Date().toISOString(),
          tenant_id: ctx.tenant.id,
          org_id: asset.org_id || ctx.targetOrgId,
        };

        const created = await db.createMaintenanceLog(log, setAssetUnderMaintenance);
        if (ticket_id || downtime_minutes !== undefined) {
          await store.mutate((s) => {
            s.maintenanceMeta[logId] = {
              ticket_id,
              downtime_minutes,
            };
          });
        }
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: asset.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'MAINTENANCE_LOGGED',
          entityType: 'maintenance',
          entityId: logId,
          summary: `Logged ${maintenance_type} for ${asset.asset_tag}: ${issue_description}`,
        });
        res.status(201).json({
          maintenanceLog: {
            ...created,
            ...(store.data.maintenanceMeta[logId] || {}),
          },
        });
      } catch (err) {
        console.error('Create maintenance error:', err);
        res.status(500).json({ error: 'Failed to create maintenance record.' });
      }
    }
  );

  app.put(
    '/api/maintenance/:id',
    ...tenantGuard,
    requirePermission('maintenance.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const current = await db.getMaintenanceById(id);
        if (
          !current ||
          !canAccessRecordOrg(ctx, current.tenant_id, current.org_id)
        ) {
          res.status(404).json({ error: 'Maintenance record not found.' });
          return;
        }

        const body = req.body ?? {};
        const issue_description = String(
          body.issue_description ?? current.issue_description
        ).trim();
        const maintenance_type = String(
          body.maintenance_type ?? current.maintenance_type
        ) as MaintenanceType;
        const vendor_or_technician = String(
          body.vendor_or_technician ?? current.vendor_or_technician
        ).trim();
        const service_date = String(body.service_date ?? current.service_date).trim();
        const next_service_date =
          body.next_service_date === ''
            ? null
            : body.next_service_date !== undefined
              ? String(body.next_service_date).trim()
              : current.next_service_date;
        const cost = body.cost !== undefined ? Number(body.cost) : current.cost;
        const status = String(body.status ?? current.status) as MaintenanceStatus;
        const notes = String(body.notes ?? current.notes).trim();

        if (!issue_description || !vendor_or_technician) {
          res.status(400).json({
            error: 'Issue description and vendor/technician are required.',
          });
          return;
        }
        if (!MAINTENANCE_TYPES.includes(maintenance_type)) {
          res.status(400).json({ error: 'Invalid maintenance type.' });
          return;
        }
        if (!MAINTENANCE_STATUSES.includes(status)) {
          res.status(400).json({ error: 'Invalid maintenance status.' });
          return;
        }
        if (!isIsoDate(service_date)) {
          res.status(400).json({ error: 'Service date must be a valid YYYY-MM-DD date.' });
          return;
        }
        if (next_service_date && !isIsoDate(next_service_date)) {
          res.status(400).json({
            error: 'Next service date must be a valid YYYY-MM-DD date.',
          });
          return;
        }
        if (!Number.isFinite(cost) || cost < 0) {
          res.status(400).json({ error: 'Cost must be a non-negative number.' });
          return;
        }

        const updated = await db.updateMaintenanceLog(id, {
          issue_description,
          maintenance_type,
          vendor_or_technician,
          service_date,
          next_service_date,
          cost,
          status,
          notes,
        });
        if (body.ticket_id !== undefined || body.downtime_minutes !== undefined) {
          await store.mutate((s) => {
            const prev = s.maintenanceMeta[id] || {};
            s.maintenanceMeta[id] = {
              ticket_id:
                body.ticket_id !== undefined
                  ? body.ticket_id
                    ? String(body.ticket_id)
                    : null
                  : prev.ticket_id,
              downtime_minutes:
                body.downtime_minutes !== undefined
                  ? Number(body.downtime_minutes)
                  : prev.downtime_minutes,
            };
          });
        }
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: current.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'MAINTENANCE_UPDATED',
          entityType: 'maintenance',
          entityId: id,
          summary: `Updated maintenance record ${id} (${status})`,
        });
        res.json({
          maintenanceLog: updated
            ? { ...updated, ...(store.data.maintenanceMeta[id] || {}) }
            : null,
        });
      } catch (err) {
        console.error('Update maintenance error:', err);
        res.status(500).json({ error: 'Failed to update maintenance record.' });
      }
    }
  );

  app.delete(
    '/api/maintenance/:id',
    ...tenantGuard,
    requirePermission('maintenance.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const current = await db.getMaintenanceById(id);
        if (
          !current ||
          !canAccessRecordOrg(ctx, current.tenant_id, current.org_id)
        ) {
          res.status(404).json({ error: 'Maintenance record not found.' });
          return;
        }
        await db.deleteMaintenanceLog(id);
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: current.org_id || ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'MAINTENANCE_DELETED',
          entityType: 'maintenance',
          entityId: id,
          summary: `Deleted maintenance record ${id}`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete maintenance error:', err);
        res.status(500).json({ error: 'Failed to delete maintenance record.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Notifications Routes (Tenant + Org Scoped + SLA / Licence / Billing Alerts)
  // -------------------------------------------------------------------------
  async function listScopedNotifications(req: TenantRequest) {
    const ctx = req.tenantCtx!;
    const base = await db.listNotifications(req.authUser!.id, ctx.scopeFilter);
    const ackedMap = new Map(
      base.filter((n) => n.acknowledged).map((n) => [n.id, n.acknowledged_at])
    );
    const ackPrefix = `ack:${req.authUser!.id}:`;
    for (const h of store.data.alertJobHistory) {
      if (h.key.startsWith(ackPrefix)) {
        ackedMap.set(h.key.slice(ackPrefix.length), h.triggeredAt);
      }
    }

    const extra: typeof base = [];
    const todayMs = Date.now();
    const dayMs = 86400_000;

    for (const t of store.data.tickets) {
      if (!canAccessRecordOrg(ctx, t.tenantId, t.orgId)) continue;
      if (t.status === 'Resolved' || t.status === 'Closed') continue;
      if (t.slaBreached) {
        const key = `sla:${t.id}`;
        extra.push({
          id: key,
          type: 'sla_breach',
          severity: 'critical',
          title: `SLA Breached: ${t.ticketNumber}`,
          description: `${t.subject} (${t.priority}) has breached its resolution SLA target.`,
          entity_type: 'ticket',
          entity_id: t.id,
          asset_id: t.assetId || '',
          asset_tag: t.ticketNumber,
          asset_name: t.subject,
          due_date: (t.resolutionDueAt || t.createdAt).slice(0, 10),
          acknowledged: ackedMap.has(key),
          acknowledged_at: ackedMap.get(key) ?? null,
        });
      }
    }

    for (const lic of store.data.softwareLicences) {
      if (!canAccessRecordOrg(ctx, lic.tenantId, lic.orgId)) continue;
      if (!lic.expiryDate) continue;
      const diffDays = Math.ceil(
        (new Date(`${lic.expiryDate}T00:00:00`).getTime() - todayMs) / dayMs
      );
      if (diffDays <= 30) {
        const key = `licence:${lic.id}:${lic.expiryDate}`;
        extra.push({
          id: key,
          type: 'licence_expiry',
          severity: diffDays < 0 || diffDays <= 7 ? 'critical' : 'warning',
          title:
            diffDays < 0
              ? `Licence Expired: ${lic.softwareName}`
              : `Licence Expiring in ${diffDays}d: ${lic.softwareName}`,
          description: `${lic.vendor} (${lic.assignedSeats}/${lic.totalSeats} seats) renewal date ${lic.expiryDate}.`,
          entity_type: 'licence',
          entity_id: lic.id,
          asset_id: '',
          asset_tag: lic.licenceType,
          asset_name: lic.softwareName,
          due_date: lic.expiryDate,
          acknowledged: ackedMap.has(key),
          acknowledged_at: ackedMap.get(key) ?? null,
        });
      }
    }

    if (ctx.isReadOnlyGraceOrExpired || ctx.subscription.status === 'grace_period') {
      const key = `sub:${ctx.subscription.id}:${ctx.subscription.status}`;
      extra.push({
        id: key,
        type: 'subscription_alert',
        severity: 'critical',
        title: `Subscription ${ctx.subscription.status.replace('_', ' ')}`,
        description:
          'Renew your GH₵ workspace subscription in Subscription & Billing to maintain uninterrupted write access.',
        entity_type: 'subscription',
        entity_id: ctx.subscription.id,
        asset_id: '',
        asset_tag: ctx.plan.name,
        asset_name: ctx.tenant.name,
        due_date: ctx.subscription.currentPeriodEnd.slice(0, 10),
        acknowledged: ackedMap.has(key),
        acknowledged_at: ackedMap.get(key) ?? null,
      });
    }

    return [...extra, ...base];
  }

  app.get('/api/notifications', ...tenantGuard, async (req: TenantRequest, res) => {
    try {
      const notifications = await listScopedNotifications(req);
      res.json({ notifications });
    } catch (err) {
      console.error('Notifications error:', err);
      res.status(500).json({ error: 'Failed to load system alerts.' });
    }
  });

  app.post(
    '/api/notifications/acknowledge',
    ...tenantGuard,
    async (req: TenantRequest, res) => {
      try {
        const alertKeys = Array.isArray(req.body?.alertKeys)
          ? req.body.alertKeys.map((k: unknown) => String(k))
          : [];
        if (alertKeys.length === 0) {
          res.status(400).json({ error: 'No alert keys specified.' });
          return;
        }
        await db.acknowledgeNotifications(req.authUser!.id, alertKeys);
        const now = new Date().toISOString();
        const ackPrefix = `ack:${req.authUser!.id}:`;
        await store.mutate((s) => {
          for (const k of alertKeys) {
            const entryKey = `${ackPrefix}${k}`;
            if (!s.alertJobHistory.some((h) => h.key === entryKey)) {
              s.alertJobHistory.push({ key: entryKey, triggeredAt: now });
            }
          }
        });
        const notifications = await listScopedNotifications(req);
        res.json({ notifications });
      } catch (err) {
        console.error('Acknowledge notification error:', err);
        res.status(500).json({ error: 'Failed to acknowledge notifications.' });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Tenant User Management & Invitations Routes (RBAC + Quota Enforced)
  // -------------------------------------------------------------------------
  const VALID_TENANT_ROLES: TenantRole[] = [
    'tenant_owner',
    'tenant_admin',
    'it_manager',
    'it_technician',
    'asset_manager',
    'dept_manager',
    'employee',
    'auditor',
    'msp_admin',
    'msp_manager',
    'msp_technician',
    'msp_viewer',
  ];

  function isAdminTenantRole(role: TenantRole): boolean {
    return role === 'tenant_owner' || role === 'tenant_admin' || role === 'msp_admin';
  }

  app.get(
    '/api/users',
    ...tenantGuard,
    requirePermission('users.read'),
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const memberships = store.data.memberships.filter(
          (m) => m.tenantId === ctx.tenant.id
        );
        const membershipMap = new Map(memberships.map((m) => [m.userId, m]));
        const allUsers = await db.listUsers();
        const tenantUsers = allUsers
          .filter((u) => membershipMap.has(u.id))
          .map((u) => {
            const m = membershipMap.get(u.id)!;
            return {
              ...u,
              tenant_role: m.role,
              org_access_mode: m.orgAccessMode,
              allowed_org_ids: m.allowedOrgIds,
              membership_status: m.status,
            };
          });
        res.json({ users: tenantUsers });
      } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ error: 'Failed to load user accounts.' });
      }
    }
  );

  app.post(
    '/api/users',
    ...tenantGuard,
    requirePermission('users.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const quota = checkQuotaExceeded(
          ctx.effectiveLimits.maxUsers,
          ctx.usage.usersCount,
          'users',
          ctx.plan.name
        );
        if (!quota.ok) {
          res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
          return;
        }

        const body = req.body ?? {};
        const name = String(body.name ?? '').trim();
        const email = String(body.email ?? '').trim().toLowerCase();
        const password = String(body.password ?? '');
        const legacyRole: UserRole = body.role === 'admin' ? 'admin' : 'staff';
        const requestedTenantRole = String(
          body.tenant_role ??
            (legacyRole === 'admin' ? 'tenant_admin' : 'it_technician')
        ) as TenantRole;
        const tenantRole: TenantRole = VALID_TENANT_ROLES.includes(
          requestedTenantRole
        )
          ? requestedTenantRole
          : 'it_technician';
        const effectiveLegacyRole: UserRole = isAdminTenantRole(tenantRole)
          ? 'admin'
          : legacyRole;
        const department = String(body.department ?? 'IT Infrastructure').trim();
        const status =
          body.status === 'inactive' || body.status === 'pending'
            ? body.status
            : 'active';
        const orgAccessMode: 'all' | 'selected' =
          body.org_access_mode === 'selected' ? 'selected' : 'all';
        const allowedOrgIds: string[] = Array.isArray(body.allowed_org_ids)
          ? body.allowed_org_ids.map((x: unknown) => String(x))
          : [];

        if (!name || !email || !password) {
          res
            .status(400)
            .json({ error: 'Name, email, and initial password are required.' });
          return;
        }
        if (!isValidEmail(email)) {
          res.status(400).json({ error: 'Please provide a valid email address.' });
          return;
        }
        if (password.length < 8) {
          res
            .status(400)
            .json({ error: 'Password must be at least 8 characters long.' });
          return;
        }

        const existing = await db.findUserByEmail(email);
        if (existing) {
          res
            .status(409)
            .json({ error: `User with email "${email}" already exists.` });
          return;
        }

        const now = new Date().toISOString();
        const user = await db.createUser({
          id: `usr-${crypto.randomUUID().slice(0, 8)}`,
          name,
          email,
          password_hash: hashPassword(password),
          role: effectiveLegacyRole,
          department,
          status,
          created_at: now,
          last_login: null,
          email_verified: true,
          mfa_enabled: Boolean(body.mfa_enabled),
          is_super_admin: false,
        });

        await store.mutate((s) => {
          s.memberships.push({
            id: `${user.id}_${ctx.tenant.id}`,
            userId: user.id,
            tenantId: ctx.tenant.id,
            role: tenantRole,
            status: status === 'inactive' ? 'suspended' : 'active',
            orgAccessMode,
            allowedOrgIds: orgAccessMode === 'selected' ? allowedOrgIds : [],
            createdAt: now,
            updatedAt: now,
          });
        });

        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'USER_CREATED',
          entityType: 'user',
          entityId: user.id,
          summary: `Added user ${email} (${tenantRole})`,
        });

        res.status(201).json({
          user: {
            ...user,
            tenant_role: tenantRole,
            org_access_mode: orgAccessMode,
            allowed_org_ids: allowedOrgIds,
          },
        });
      } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: 'Failed to create user account.' });
      }
    }
  );

  app.put(
    '/api/users/:id',
    ...tenantGuard,
    requirePermission('users.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const targetMembership = store.data.memberships.find(
          (m) => m.userId === id && m.tenantId === ctx.tenant.id
        );
        const current = await db.findUserById(id);
        if (!current || !targetMembership) {
          res.status(404).json({ error: 'User not found in this workspace.' });
          return;
        }

        const body = req.body ?? {};
        const name = String(body.name ?? current.name).trim();
        const email = String(body.email ?? current.email).trim().toLowerCase();
        const requestedTenantRole = body.tenant_role
          ? (String(body.tenant_role) as TenantRole)
          : targetMembership.role;
        const tenantRole: TenantRole = VALID_TENANT_ROLES.includes(
          requestedTenantRole
        )
          ? requestedTenantRole
          : targetMembership.role;
        const role: UserRole =
          body.role === 'admin' || body.role === 'staff'
            ? body.role
            : isAdminTenantRole(tenantRole)
              ? 'admin'
              : 'staff';
        const department = String(body.department ?? current.department).trim();
        const status =
          body.status === 'inactive' ||
          body.status === 'pending' ||
          body.status === 'active'
            ? body.status
            : current.status;
        const password = body.password ? String(body.password) : '';
        const orgAccessMode: 'all' | 'selected' =
          body.org_access_mode === 'selected'
            ? 'selected'
            : body.org_access_mode === 'all'
              ? 'all'
              : targetMembership.orgAccessMode;
        const allowedOrgIds: string[] = Array.isArray(body.allowed_org_ids)
          ? body.allowed_org_ids.map((x: unknown) => String(x))
          : targetMembership.allowedOrgIds;

        if (!name || !email) {
          res.status(400).json({ error: 'Name and email are required.' });
          return;
        }
        if (!isValidEmail(email)) {
          res.status(400).json({ error: 'Please provide a valid email address.' });
          return;
        }
        if (password && password.length < 8) {
          res
            .status(400)
            .json({ error: 'New password must be at least 8 characters.' });
          return;
        }

        const allUsers = await db.listUsers();
        if (allUsers.some((u) => u.id !== id && u.email.toLowerCase() === email)) {
          res
            .status(409)
            .json({ error: `Email "${email}" is already used by another user.` });
          return;
        }

        const tenantMemberIds = new Set(
          store.data.memberships
            .filter(
              (m) =>
                m.tenantId === ctx.tenant.id &&
                m.userId !== id &&
                m.status === 'active' &&
                isAdminTenantRole(m.role)
            )
            .map((m) => m.userId)
        );
        const remainingTenantAdmins = allUsers.filter(
          (u) => tenantMemberIds.has(u.id) && u.status === 'active'
        );
        if (
          remainingTenantAdmins.length === 0 &&
          (!isAdminTenantRole(tenantRole) || status !== 'active')
        ) {
          res.status(400).json({
            error:
              'At least one active administrator account must remain in this workspace.',
          });
          return;
        }

        const patch: Parameters<typeof db.updateUser>[1] = {
          name,
          email,
          role,
          department,
          status,
        };
        if (body.mfa_enabled !== undefined) {
          patch.mfa_enabled = Boolean(body.mfa_enabled);
        }
        if (password) {
          patch.password_hash = hashPassword(password);
        }

        const updated = await db.updateUser(id, patch);
        await store.mutate((s) => {
          const m = s.memberships.find(
            (x) => x.userId === id && x.tenantId === ctx.tenant.id
          );
          if (m) {
            m.role = tenantRole;
            m.status = status === 'inactive' ? 'suspended' : 'active';
            m.orgAccessMode = orgAccessMode;
            m.allowedOrgIds = orgAccessMode === 'selected' ? allowedOrgIds : [];
            m.updatedAt = new Date().toISOString();
          }
        });

        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'USER_UPDATED',
          entityType: 'user',
          entityId: id,
          summary: `Updated user ${email} (${tenantRole}, access=${orgAccessMode})`,
        });

        res.json({
          user: updated
            ? {
                ...updated,
                tenant_role: tenantRole,
                org_access_mode: orgAccessMode,
                allowed_org_ids: orgAccessMode === 'selected' ? allowedOrgIds : [],
              }
            : null,
        });
      } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: 'Failed to update user.' });
      }
    }
  );

  app.delete(
    '/api/users/:id',
    ...tenantGuard,
    requirePermission('users.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        if (id === req.authUser!.id) {
          res.status(400).json({
            error: 'You cannot delete your own active session account.',
          });
          return;
        }
        const membership = store.data.memberships.find(
          (m) => m.userId === id && m.tenantId === ctx.tenant.id
        );
        const allUsers = await db.listUsers();
        const target = allUsers.find((u) => u.id === id);
        if (!target || !membership) {
          res.status(404).json({ error: 'User not found in this workspace.' });
          return;
        }
        const remainingAdmins = store.data.memberships.filter(
          (m) =>
            m.tenantId === ctx.tenant.id &&
            m.userId !== id &&
            m.status === 'active' &&
            isAdminTenantRole(m.role)
        );
        if (remainingAdmins.length === 0) {
          res
            .status(400)
            .json({ error: 'Cannot delete the last active workspace administrator.' });
          return;
        }

        await store.mutate((s) => {
          s.memberships = s.memberships.filter(
            (m) => !(m.userId === id && m.tenantId === ctx.tenant.id)
          );
        });
        const otherMemberships = store.data.memberships.some(
          (m) => m.userId === id
        );
        if (!otherMemberships) {
          await db.deleteUser(id);
        }

        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'USER_REMOVED',
          entityType: 'user',
          entityId: id,
          summary: `Removed ${target.email} from workspace`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'Failed to delete user.' });
      }
    }
  );

  // Tenant Invitations
  app.get(
    '/api/invitations',
    ...tenantGuard,
    requirePermission('users.read'),
    (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      res.json({
        invitations: store.data.invitations.filter(
          (i) => i.tenantId === ctx.tenant.id
        ),
      });
    }
  );

  app.post(
    '/api/invitations',
    ...tenantGuard,
    requirePermission('users.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      const ctx = req.tenantCtx!;
      const quota = checkQuotaExceeded(
        ctx.effectiveLimits.maxUsers,
        ctx.usage.usersCount,
        'users',
        ctx.plan.name
      );
      if (!quota.ok) {
        res.status(403).json({ error: quota.error, code: 'QUOTA_EXCEEDED' });
        return;
      }
      const email = String(req.body?.email ?? '').trim().toLowerCase();
      const name = String(req.body?.name ?? '').trim();
      const role = String(req.body?.role ?? 'it_technician') as TenantRole;
      if (!isValidEmail(email) || !name) {
        res.status(400).json({ error: 'Valid email and invitee name required.' });
        return;
      }
      const invite = {
        id: `inv-${crypto.randomUUID().slice(0, 8)}`,
        tenantId: ctx.tenant.id,
        email,
        name,
        role: VALID_TENANT_ROLES.includes(role) ? role : 'it_technician',
        orgAccessMode:
          req.body?.orgAccessMode === 'selected'
            ? ('selected' as const)
            : ('all' as const),
        allowedOrgIds: Array.isArray(req.body?.allowedOrgIds)
          ? req.body.allowedOrgIds.map(String)
          : [],
        token: crypto.randomBytes(16).toString('hex'),
        status: 'pending' as const,
        invitedBy: req.authUser!.name,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      };
      await store.mutate((s) => {
        s.invitations.unshift(invite);
      });
      res.status(201).json({ invitation: invite });
    }
  );

  app.delete(
    '/api/invitations/:id',
    ...tenantGuard,
    requirePermission('users.manage'),
    requireWritableSubscription,
    async (req: TenantRequest, res) => {
      try {
        const ctx = req.tenantCtx!;
        const id = String(req.params.id);
        const invite = store.data.invitations.find(
          (i) => i.id === id && i.tenantId === ctx.tenant.id
        );
        if (!invite) {
          res.status(404).json({ error: 'Invitation not found.' });
          return;
        }
        await store.mutate((s) => {
          s.invitations = s.invitations.filter(
            (i) => !(i.id === id && i.tenantId === ctx.tenant.id)
          );
        });
        await store.appendAuditLog({
          tenantId: ctx.tenant.id,
          orgId: ctx.targetOrgId,
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          actorRole: ctx.membership.role,
          action: 'INVITATION_REVOKED',
          entityType: 'invitation',
          entityId: id,
          summary: `Revoked invitation for ${invite.email}`,
        });
        res.json({ ok: true });
      } catch (err) {
        console.error('Delete invitation error:', err);
        res.status(500).json({ error: 'Failed to revoke invitation.' });
      }
    }
  );

  app.post('/api/invitations/accept', async (req, res) => {
    const token = String(req.body?.token ?? '').trim();
    const password = String(req.body?.password ?? '');
    if (!token || password.length < 8) {
      res.status(400).json({
        error: 'Invitation token and password (min 8 chars) are required.',
      });
      return;
    }
    const invite = store.data.invitations.find(
      (i) => i.token === token && i.status === 'pending'
    );
    if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) {
      res.status(400).json({ error: 'Invitation is invalid or expired.' });
      return;
    }
    let user = await db.findUserByEmail(invite.email);
    const now = new Date().toISOString();
    if (!user) {
      const created = await db.createUser({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        name: invite.name,
        email: invite.email,
        password_hash: hashPassword(password),
        role: isAdminTenantRole(invite.role) ? 'admin' : 'staff',
        department: 'IT Infrastructure',
        status: 'active',
        created_at: now,
        last_login: now,
        email_verified: true,
        mfa_enabled: false,
        is_super_admin: false,
      });
      user = { ...created, password_hash: '' };
    }
    await store.mutate((s) => {
      invite.status = 'accepted';
      const exists = s.memberships.some(
        (m) => m.userId === user!.id && m.tenantId === invite.tenantId
      );
      if (!exists) {
        s.memberships.push({
          id: `${user!.id}_${invite.tenantId}`,
          userId: user!.id,
          tenantId: invite.tenantId,
          role: invite.role,
          status: 'active',
          orgAccessMode: invite.orgAccessMode,
          allowedOrgIds: invite.allowedOrgIds,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
    const sessionToken = signSessionToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });
    res.json({ token: sessionToken, user });
  });

  return app;
}
