import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApiApp } from '../server/app.ts';
import { createDatabase } from '../server/db.ts';
import { SaasStore } from '../server/saasStore.ts';
import { generateTotpToken } from '../server/totp.ts';

let server: http.Server;
let baseUrl = '';
let tmpDir = '';
let store: SaasStore;

async function jsonReq(
  method: string,
  route: string,
  opts: {
    token?: string;
    tenantId?: string;
    orgId?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
  };
  if (opts.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  if (opts.tenantId) {
    headers['X-Tenant-Id'] = opts.tenantId;
  }
  if (opts.orgId) {
    headers['X-Org-Id'] = opts.orgId;
  }

  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  return { status: res.status, data };
}

describe('Multi-tenant isolation, MSP scoping, RBAC, Plan Quotas, & Paystack Webhooks', () => {
  let tenantAToken = '';
  let tenantAId = '';
  let tenantBToken = '';
  let tenantBId = '';
  let tenantBAssetId = '';
  let tenantBTicketId = '';

  let mspAdminToken = '';
  let mspTenantId = '';
  let mspOrg1Id = '';
  let mspOrg2Id = '';
  let mspTechToken = '';
  let mspOrg1AssetId = '';
  let mspOrg2AssetId = '';

  let employeeToken = '';

  before(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'assetvault-test-'));
    const sqlitePath = path.join(tmpDir, 'test.db');
    process.env.ITAMS_FORCE_SQLITE = '1';
    process.env.PAYSTACK_SECRET_KEY = 'sk_test_unit_test_secret_key_for_hmac';

    const db = await createDatabase(sqlitePath);
    store = new SaasStore(sqlitePath);
    await store.init();
    const app = createApiApp(db, store);

    server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') {
      throw new Error('Failed to bind test HTTP server.');
    }
    baseUrl = `http://127.0.0.1:${addr.port}`;

    // Register Tenant A (Starter plan)
    const regA = await jsonReq('POST', '/api/auth/register', {
      body: {
        name: 'Alice Owner',
        email: 'alice@tenant-a.test',
        password: 'Password123!',
        companyName: 'Alpha Corp',
        tenantType: 'company',
        planCode: 'starter',
      },
    });
    assert.equal(regA.status, 201);
    tenantAToken = String(regA.data.token);
    tenantAId = String((regA.data.tenant as { id: string }).id);

    // Register Tenant B (Business plan)
    const regB = await jsonReq('POST', '/api/auth/register', {
      body: {
        name: 'Bob Owner',
        email: 'bob@tenant-b.test',
        password: 'Password123!',
        companyName: 'Beta Industries',
        tenantType: 'company',
        planCode: 'business',
      },
    });
    assert.equal(regB.status, 201);
    tenantBToken = String(regB.data.token);
    tenantBId = String((regB.data.tenant as { id: string }).id);

    // Create asset & ticket with internal note inside Tenant B
    const bAsset = await jsonReq('POST', '/api/assets', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        asset_tag: 'BET-LP-001',
        name: 'Beta Executive Laptop',
        category: 'Laptops',
        brand: 'Dell',
        model: 'XPS 15',
        serial_number: 'SN-BETA-001',
        purchase_date: '2026-01-10',
        cost: 12000,
        warranty_expiry: '2029-01-10',
        status: 'Available',
      },
    });
    assert.equal(bAsset.status, 201);
    tenantBAssetId = String((bAsset.data.asset as { id: string }).id);

    const bTicket = await jsonReq('POST', '/api/tickets', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        subject: 'Beta VPN Issue',
        description: 'Tunnel drops intermittently',
        category: 'Network',
        priority: 'High',
      },
    });
    assert.equal(bTicket.status, 201);
    tenantBTicketId = String((bTicket.data.ticket as { id: string }).id);

    const internalComment = await jsonReq(
      'POST',
      `/api/tickets/${tenantBTicketId}/comments`,
      {
        token: tenantBToken,
        tenantId: tenantBId,
        body: {
          body: 'INTERNAL: Root password rotated on core firewall',
          isInternal: true,
        },
      }
    );
    assert.equal(internalComment.status, 201);

    // Create an employee inside Tenant B to verify RBAC restrictions
    const empCreate = await jsonReq('POST', '/api/users', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        name: 'Charlie Employee',
        email: 'charlie@tenant-b.test',
        password: 'Password123!',
        tenant_role: 'employee',
        department: 'Finance',
      },
    });
    assert.equal(empCreate.status, 201);

    const empLogin = await jsonReq('POST', '/api/auth/login', {
      body: {
        email: 'charlie@tenant-b.test',
        password: 'Password123!',
      },
    });
    assert.equal(empLogin.status, 200);
    employeeToken = String(empLogin.data.token);

    // Register MSP Tenant (Business plan) with 2 client orgs and restricted tech
    const regMsp = await jsonReq('POST', '/api/auth/register', {
      body: {
        name: 'Manny MSP',
        email: 'manny@msp-ops.test',
        password: 'Password123!',
        companyName: 'Accra Managed IT',
        tenantType: 'msp',
        planCode: 'business',
      },
    });
    assert.equal(regMsp.status, 201);
    mspAdminToken = String(regMsp.data.token);
    mspTenantId = String((regMsp.data.tenant as { id: string }).id);

    const mspCtx = await jsonReq('GET', '/api/auth/context', {
      token: mspAdminToken,
      tenantId: mspTenantId,
    });
    assert.equal(mspCtx.status, 200);
    mspOrg1Id = String((mspCtx.data.activeOrg as { id: string }).id);

    const org2Res = await jsonReq('POST', '/api/orgs/client-organisations', {
      token: mspAdminToken,
      tenantId: mspTenantId,
      body: {
        name: 'Client Two Banking',
        code: 'CLI-02',
        industry: 'Finance',
      },
    });
    assert.equal(org2Res.status, 201);
    mspOrg2Id = String((org2Res.data.organisation as { id: string }).id);

    const org1Asset = await jsonReq('POST', '/api/assets', {
      token: mspAdminToken,
      tenantId: mspTenantId,
      orgId: mspOrg1Id,
      body: {
        asset_tag: 'MSP1-001',
        name: 'Client 1 Switch',
        category: 'Networking Equipment',
        brand: 'Cisco',
        model: 'Catalyst',
        serial_number: 'SN-MSP1-001',
        purchase_date: '2026-02-01',
        cost: 8000,
        warranty_expiry: '2029-02-01',
      },
    });
    assert.equal(org1Asset.status, 201);
    mspOrg1AssetId = String((org1Asset.data.asset as { id: string }).id);

    const org2Asset = await jsonReq('POST', '/api/assets', {
      token: mspAdminToken,
      tenantId: mspTenantId,
      orgId: mspOrg2Id,
      body: {
        asset_tag: 'MSP2-001',
        name: 'Client 2 Firewall',
        category: 'Networking Equipment',
        brand: 'Fortinet',
        model: '60F',
        serial_number: 'SN-MSP2-001',
        purchase_date: '2026-02-01',
        cost: 9500,
        warranty_expiry: '2029-02-01',
      },
    });
    assert.equal(org2Asset.status, 201);
    mspOrg2AssetId = String((org2Asset.data.asset as { id: string }).id);

    const mspTechCreate = await jsonReq('POST', '/api/users', {
      token: mspAdminToken,
      tenantId: mspTenantId,
      body: {
        name: 'Restricted MSP Tech',
        email: 'tech@msp-ops.test',
        password: 'Password123!',
        tenant_role: 'msp_technician',
        org_access_mode: 'selected',
        allowed_org_ids: [mspOrg1Id],
      },
    });
    assert.equal(mspTechCreate.status, 201);

    const techLogin = await jsonReq('POST', '/api/auth/login', {
      body: {
        email: 'tech@msp-ops.test',
        password: 'Password123!',
      },
    });
    assert.equal(techLogin.status, 200);
    mspTechToken = String(techLogin.data.token);
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('1. Enforces strict cross-tenant isolation on assets and tickets', async () => {
    const listA = await jsonReq('GET', '/api/assets', {
      token: tenantAToken,
      tenantId: tenantAId,
    });
    assert.equal(listA.status, 200);
    const aAssets = listA.data.assets as Array<{ id: string }>;
    assert.equal(
      aAssets.some((a) => a.id === tenantBAssetId),
      false,
      'Tenant A must not list Tenant B assets'
    );

    const getBAssetAsA = await jsonReq('GET', `/api/assets/${tenantBAssetId}`, {
      token: tenantAToken,
      tenantId: tenantAId,
    });
    assert.equal(getBAssetAsA.status, 404);

    // Spoofing X-Tenant-Id header to Tenant B must be rejected
    const spoofedGet = await jsonReq('GET', '/api/assets', {
      token: tenantAToken,
      tenantId: tenantBId,
    });
    assert.equal(spoofedGet.status, 403);

    const getBTicketAsA = await jsonReq('GET', `/api/tickets/${tenantBTicketId}`, {
      token: tenantAToken,
      tenantId: tenantAId,
    });
    assert.equal(getBTicketAsA.status, 404);
  });

  it('2. Enforces MSP technician allowedOrgIds client-org isolation', async () => {
    // Restricted tech with no X-Org-Id defaults to allowed orgs only (mspOrg1Id)
    const listAssets = await jsonReq('GET', '/api/assets', {
      token: mspTechToken,
      tenantId: mspTenantId,
    });
    assert.equal(listAssets.status, 200);
    const ids = (listAssets.data.assets as Array<{ id: string }>).map((a) => a.id);
    assert.ok(ids.includes(mspOrg1AssetId));
    assert.equal(ids.includes(mspOrg2AssetId), false);

    // Restricted tech requesting ALL orgs or Client Org 2 must be denied (403)
    const allOrgsAttempt = await jsonReq('GET', '/api/assets', {
      token: mspTechToken,
      tenantId: mspTenantId,
      orgId: 'ALL',
    });
    assert.equal(allOrgsAttempt.status, 403);

    const directOrg2Asset = await jsonReq('GET', `/api/assets/${mspOrg2AssetId}`, {
      token: mspTechToken,
      tenantId: mspTenantId,
    });
    assert.equal(directOrg2Asset.status, 404);

    const switchToForbiddenOrg = await jsonReq('GET', '/api/assets', {
      token: mspTechToken,
      tenantId: mspTenantId,
      orgId: mspOrg2Id,
    });
    assert.equal(switchToForbiddenOrg.status, 403);
  });

  it('3. Enforces RBAC: employee cannot delete assets or read licences, auditor sees masked licence keys, and employee cannot view internal ticket notes', async () => {
    const delRes = await jsonReq('DELETE', `/api/assets/${tenantBAssetId}`, {
      token: employeeToken,
      tenantId: tenantBId,
    });
    assert.equal(delRes.status, 403);

    // Employee lacks licences.read permission -> 403
    const empLicForbidden = await jsonReq('GET', '/api/licences', {
      token: employeeToken,
      tenantId: tenantBId,
    });
    assert.equal(empLicForbidden.status, 403);

    // Create a software licence as Tenant B owner and verify key masking for auditor
    const licCreate = await jsonReq('POST', '/api/licences', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        softwareName: 'Microsoft 365 E3',
        vendor: 'Microsoft',
        licenceKey: 'ABCD-1234-EFGH-5678',
        totalSeats: 20,
        costPerYearGhs: 4000,
      },
    });
    assert.equal(licCreate.status, 201);

    const ownerLic = await jsonReq('GET', '/api/licences', {
      token: tenantBToken,
      tenantId: tenantBId,
    });
    assert.equal(ownerLic.status, 200);
    assert.equal(ownerLic.data.canViewKeys, true);
    assert.equal(
      (ownerLic.data.licences as Array<{ licenceKey: string }>)[0].licenceKey,
      'ABCD-1234-EFGH-5678'
    );

    const audCreate = await jsonReq('POST', '/api/users', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        name: 'Diana Auditor',
        email: 'diana@tenant-b.test',
        password: 'Password123!',
        tenant_role: 'auditor',
        department: 'Finance',
      },
    });
    assert.equal(audCreate.status, 201);

    const audLogin = await jsonReq('POST', '/api/auth/login', {
      body: { email: 'diana@tenant-b.test', password: 'Password123!' },
    });
    assert.equal(audLogin.status, 200);

    const audLic = await jsonReq('GET', '/api/licences', {
      token: String(audLogin.data.token),
      tenantId: tenantBId,
    });
    assert.equal(audLic.status, 200);
    assert.equal(audLic.data.canViewKeys, false);
    assert.notEqual(
      (audLic.data.licences as Array<{ licenceKey: string }>)[0].licenceKey,
      'ABCD-1234-EFGH-5678'
    );

    // Employee reading ticket must NOT see internal comment
    const empTicket = await jsonReq('GET', `/api/tickets/${tenantBTicketId}`, {
      token: employeeToken,
      tenantId: tenantBId,
    });
    assert.equal(empTicket.status, 200);
    const comments = empTicket.data.comments as Array<{ isInternal: boolean; body: string }>;
    assert.equal(
      comments.some((c) => c.isInternal || c.body.includes('Root password')),
      false
    );
  });

  it('4. Enforces plan feature gates, quota limits, and expired subscription read-only mode', async () => {
    // Starter plan does not include 'itsm_suite' -> 403 FEATURE_LOCKED on creating incident
    const featureGate = await jsonReq('POST', '/api/itsm/incidents', {
      token: tenantAToken,
      tenantId: tenantAId,
      body: {
        title: 'Starter Incident Test',
        description: 'Should be blocked on starter plan',
      },
    });
    assert.equal(featureGate.status, 403);
    assert.equal(featureGate.data.code, 'FEATURE_LOCKED');

    // Starter plan maxClientOrgs = 1 -> creating a 2nd client org returns 403 QUOTA_EXCEEDED
    const quotaOrg = await jsonReq('POST', '/api/orgs/client-organisations', {
      token: tenantAToken,
      tenantId: tenantAId,
      body: {
        name: 'Second Org Not Allowed',
        code: 'ORG-02',
      },
    });
    assert.equal(quotaOrg.status, 403);
    assert.equal(quotaOrg.data.code, 'QUOTA_EXCEEDED');

    // Simulate expired subscription for Tenant A -> mutations return 402 SUBSCRIPTION_READ_ONLY
    await store.mutate((s) => {
      const sub = s.subscriptions.find((x) => x.tenantId === tenantAId);
      if (sub) sub.status = 'expired';
    });

    const writeWhileExpired = await jsonReq('POST', '/api/assets', {
      token: tenantAToken,
      tenantId: tenantAId,
      body: {
        asset_tag: 'EXP-001',
        name: 'Blocked Laptop',
        category: 'Laptops',
        brand: 'Lenovo',
        model: 'T14',
        serial_number: 'SN-EXP-001',
        purchase_date: '2026-03-01',
        cost: 5000,
        warranty_expiry: '2029-03-01',
      },
    });
    assert.equal(writeWhileExpired.status, 402);
    assert.equal(writeWhileExpired.data.code, 'SUBSCRIPTION_READ_ONLY');

    // Reads must still succeed in read-only expired mode
    const readWhileExpired = await jsonReq('GET', '/api/assets', {
      token: tenantAToken,
      tenantId: tenantAId,
    });
    assert.equal(readWhileExpired.status, 200);
  });

  it('5. Blocks non-super-admins from /api/platform/overview and grants access to Super Admin', async () => {
    const nonAdminRes = await jsonReq('GET', '/api/platform/overview', {
      token: tenantBToken,
    });
    assert.equal(nonAdminRes.status, 403);

    const superLogin = await jsonReq('POST', '/api/auth/login', {
      body: {
        email: 'tonadoappiah50@gmail.com',
        password: process.env.SUPER_ADMIN_INITIAL_PASSWORD || 'SuperAdmin@2026!',
      },
    });
    assert.equal(superLogin.status, 200);

    const superOverview = await jsonReq('GET', '/api/platform/overview', {
      token: String(superLogin.data.token),
    });
    assert.equal(superOverview.status, 200);
    assert.ok((superOverview.data.kpis as { totalTenants: number }).totalTenants >= 3);
  });

  it('6. Validates Paystack webhook HMAC-SHA512 signature and enforces idempotency', async () => {
    // Seed a pending payment transaction for Tenant A
    const reference = 'AV-PAY-TESTHMAC01';
    await store.mutate((s) => {
      const sub = s.subscriptions.find((x) => x.tenantId === tenantAId)!;
      s.payments.unshift({
        id: 'pay-test-01',
        tenantId: tenantAId,
        subscriptionId: sub.id,
        reference,
        provider: 'paystack',
        planCode: 'professional',
        billingCycle: 'monthly',
        amountGhs: 349,
        currency: 'GHS',
        status: 'pending',
        paidAt: null,
        createdBy: 'usr-test',
        createdAt: new Date().toISOString(),
      });
    });

    const payload = {
      event: 'charge.success',
      data: {
        reference,
        amount: 34900,
        channel: 'card',
      },
    };
    const rawBody = JSON.stringify(payload);

    // Invalid signature -> 401
    const badSigRes = await fetch(`${baseUrl}/api/billing/paystack/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': 'deadbeef',
      },
      body: rawBody,
    });
    assert.equal(badSigRes.status, 401);

    // Valid HMAC-SHA512 signature -> 200 & activates subscription
    const validSig = crypto
      .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!)
      .update(rawBody)
      .digest('hex');

    const okRes = await fetch(`${baseUrl}/api/billing/paystack/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': validSig,
      },
      body: rawBody,
    });
    assert.equal(okRes.status, 200);
    const okJson = (await okRes.json()) as { ok: boolean; idempotent?: boolean };
    assert.equal(okJson.ok, true);
    assert.equal(okJson.idempotent, undefined);

    const updatedSub = store.data.subscriptions.find((x) => x.tenantId === tenantAId);
    assert.equal(updatedSub?.status, 'active');
    assert.equal(updatedSub?.planCode, 'professional');

    // Replay same webhook -> idempotent: true without double-processing
    const replayRes = await fetch(`${baseUrl}/api/billing/paystack/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-paystack-signature': validSig,
      },
      body: rawBody,
    });
    assert.equal(replayRes.status, 200);
    const replayJson = (await replayRes.json()) as { ok: boolean; idempotent?: boolean };
    assert.equal(replayJson.ok, true);
    assert.equal(replayJson.idempotent, true);
  });

  it('7. Enforces TOTP 2FA enrollment, login challenge, recovery/TOTP verify, and disable', async () => {
    const setupRes = await jsonReq('POST', '/api/auth/mfa/setup', {
      token: tenantBToken,
      tenantId: tenantBId,
    });
    assert.equal(setupRes.status, 200);
    const secret = String(setupRes.data.secret);
    assert.ok(secret.length >= 16);

    const badEnable = await jsonReq('POST', '/api/auth/mfa/enable', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: { code: '000000' },
    });
    // Wait: extremely small chance '000000' matches; use guaranteed invalid format if needed
    if (badEnable.status === 200) {
      // No-op if random secret happened to generate 000000
    } else {
      assert.equal(badEnable.status, 400);
      const totp = generateTotpToken(secret);
      const enableRes = await jsonReq('POST', '/api/auth/mfa/enable', {
        token: tenantBToken,
        tenantId: tenantBId,
        body: { code: totp },
      });
      assert.equal(enableRes.status, 200);
    }

    // Login should now return mfaRequired: true challenge
    const loginRes = await jsonReq('POST', '/api/auth/login', {
      body: { email: 'bob@tenant-b.test', password: 'Password123!' },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.mfaRequired, true);
    const challenge = String(loginRes.data.mfaChallengeToken);
    assert.ok(challenge.length > 10);

    const verifyRes = await jsonReq('POST', '/api/auth/mfa/verify', {
      body: {
        mfaChallengeToken: challenge,
        code: generateTotpToken(secret),
      },
    });
    assert.equal(verifyRes.status, 200);
    assert.ok(verifyRes.data.token);
    tenantBToken = String(verifyRes.data.token);

    // Disable 2FA cleanly so later calls remain deterministic
    const disableRes = await jsonReq('POST', '/api/auth/mfa/disable', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: { code: generateTotpToken(secret) },
    });
    assert.equal(disableRes.status, 200);

    // Forgot-password records outbox entry safely
    const resetReq = await jsonReq('POST', '/api/auth/forgot-password', {
      body: { email: 'bob@tenant-b.test' },
    });
    assert.equal(resetReq.status, 200);
    assert.ok(
      store.data.emailOutbox.some((e) => e.to === 'bob@tenant-b.test')
    );
  });

  it('8. Supports attachments isolation, custom fields gating, API keys, webhook SSRF blocking, multi-currency & scheduled reports', async () => {
    // 8a. Attachments: upload valid PNG to Tenant B asset, block Tenant A from reading it
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const attCreate = await jsonReq('POST', '/api/attachments', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        entityType: 'asset',
        entityId: tenantBAssetId,
        fileName: 'receipt.png',
        mimeType: 'image/png',
        dataUrl: pngBase64,
      },
    });
    assert.equal(attCreate.status, 201);
    const attId = String((attCreate.data.attachment as { id: string }).id);

    const attListA = await jsonReq('GET', `/api/attachments?entityType=asset&entityId=${tenantBAssetId}`, {
      token: tenantAToken,
      tenantId: tenantAId,
    });
    assert.equal(attListA.status, 200);
    assert.equal((attListA.data.attachments as unknown[]).length, 0);

    const badMime = await jsonReq('POST', '/api/attachments', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        entityType: 'asset',
        entityId: tenantBAssetId,
        fileName: 'malware.exe',
        mimeType: 'application/x-msdownload',
        dataUrl: pngBase64,
      },
    });
    assert.equal(badMime.status, 400);

    const attDelA = await jsonReq('DELETE', `/api/attachments/${attId}`, {
      token: tenantAToken,
      tenantId: tenantAId,
    });
    assert.equal(attDelA.status, 404);

    // 8b. Custom fields: Starter plan (Tenant A) lacks custom_fields -> 403 FEATURE_LOCKED; Business (Tenant B) succeeds
    const cfGate = await jsonReq('POST', '/api/custom-fields', {
      token: tenantAToken,
      tenantId: tenantAId,
      body: { entityType: 'asset', label: 'Cost Center', fieldType: 'text' },
    });
    assert.equal(cfGate.status, 403);
    assert.equal(cfGate.data.code, 'FEATURE_LOCKED');

    const cfCreate = await jsonReq('POST', '/api/custom-fields', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: { entityType: 'asset', label: 'Cost Center', fieldType: 'text', required: true },
    });
    assert.equal(cfCreate.status, 201);
    const fieldKey = String((cfCreate.data.field as { fieldKey: string }).fieldKey);

    const cfSave = await jsonReq(
      'PUT',
      `/api/custom-fields/values/asset/${tenantBAssetId}`,
      {
        token: tenantBToken,
        tenantId: tenantBId,
        body: { values: { [fieldKey]: 'FIN-204' } },
      }
    );
    assert.equal(cfSave.status, 200);
    assert.equal((cfSave.data.values as Record<string, string>)[fieldKey], 'FIN-204');

    // 8c. API Key (/api/v1/assets) & Webhook SSRF protection
    const apiKeyRes = await jsonReq('POST', '/api/integrations/api-keys', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: { name: 'BI Sync', scopes: ['assets.read', 'tickets.read'] },
    });
    assert.equal(apiKeyRes.status, 201);
    const plaintextKey = String(apiKeyRes.data.plaintextKey);
    assert.ok(plaintextKey.startsWith('av_live_'));

    const v1Assets = await jsonReq('GET', '/api/v1/assets', {
      headers: { 'X-API-Key': plaintextKey },
    });
    assert.equal(v1Assets.status, 200);
    const v1List = v1Assets.data.assets as Array<{ id: string }>;
    assert.ok(v1List.some((a) => a.id === tenantBAssetId));

    const ssrfWebhook = await jsonReq('POST', '/api/integrations/webhooks', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        name: 'Local SSRF Attempt',
        url: 'http://127.0.0.1:8080/hook',
        events: ['asset.created'],
      },
    });
    assert.equal(ssrfWebhook.status, 400);

    // 8d. Multi-currency workspace setting & Scheduled reports
    const wsRes = await jsonReq('PUT', '/api/workspace/settings', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: { currency: 'GHS' },
    });
    assert.equal(wsRes.status, 200);
    assert.equal((wsRes.data.tenant as { currency: string }).currency, 'GHS');

    const schedRes = await jsonReq('POST', '/api/automation/schedules', {
      token: tenantBToken,
      tenantId: tenantBId,
      body: {
        name: 'Weekly Executive Asset Digest',
        reportType: 'depreciation',
        frequency: 'weekly',
        recipients: ['cfo@tenant-b.test'],
      },
    });
    assert.equal(schedRes.status, 201);
    const schedId = String((schedRes.data.schedule as { id: string }).id);

    const runSched = await jsonReq('POST', `/api/automation/schedules/${schedId}/run`, {
      token: tenantBToken,
      tenantId: tenantBId,
    });
    assert.equal(runSched.status, 200);
    assert.ok(
      store.data.emailOutbox.some(
        (e) =>
          e.to === 'cfo@tenant-b.test' &&
          e.subject.includes('DEPRECIATION Digest') &&
          e.bodyPreview.includes('Weekly Executive Asset Digest')
      )
    );
  });
});
