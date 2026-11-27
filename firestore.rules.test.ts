/**
 * Firestore Security Rules Static & Policy Verification Suite
 *
 * Run directly with:
 *   npx tsx --test firestore.rules.test.ts
 *
 * Full Emulator Execution (when Java + firebase-tools emulator are installed locally):
 *   firebase emulators:exec --only firestore "npx tsx --test firestore.rules.test.ts"
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesText = fs.readFileSync(rulesPath, 'utf8');

describe('Firestore Security Rules Policy Assertions', () => {
  it('enforces default-deny safety net on root wildcard match', () => {
    assert.match(rulesText, /match \/\{document=\*\*\}[\s\S]*allow read, write: if false;/);
  });

  it('requires verified email and binds super admin bootstrap to tonadoappiah50@gmail.com', () => {
    assert.match(
      rulesText,
      /function isBootstrappedSuperAdmin\(\)\s*\{[\s\S]*request\.auth\.token\.email == 'tonadoappiah50@gmail\.com'/
    );
    assert.match(rulesText, /request\.auth\.token\.email_verified == true/);
  });

  it('enforces tenant membership and MSP allowedOrgIds scoping on operational collections', () => {
    assert.match(rulesText, /function hasActiveMembership\(tenantId\)/);
    assert.match(rulesText, /function canAccessTenantOrg\(tenantId, orgId\)/);
    assert.match(rulesText, /allowedOrgIds\.hasAny\(\[orgId\]\)/);

    for (const collection of [
      'assets',
      'tickets',
      'softwareLicences',
      'purchaseOrders',
      'slaPolicies',
      'contracts',
      'auditLogs',
    ]) {
      assert.match(
        rulesText,
        new RegExp(`match /${collection}/\\{docId\\}|match /${collection}/\\{ticketId\\}`)
      );
    }
  });

  it('locks down auditLogs, platformAuditLogs, assetTransfers, and ticket comments as strictly immutable append-only ledgers', () => {
    assert.match(rulesText, /match \/auditLogs\/\{docId\}[\s\S]*allow update, delete: if false;/);
    assert.match(rulesText, /match \/platformAuditLogs\/\{logId\}[\s\S]*allow update, delete: if false;/);
    assert.match(rulesText, /match \/assetTransfers\/\{docId\}[\s\S]*allow update: if false;[\s\S]*allow delete: if false;/);
    assert.match(rulesText, /match \/comments\/\{commentId\}[\s\S]*allow update, delete: if false;/);
  });

  it('restricts plans, platformSettings, payments, and invoices writes to Super Admin only', () => {
    assert.match(rulesText, /match \/plans\/\{planId\}[\s\S]*allow create: if isSuperAdmin\(\)/);
    assert.match(rulesText, /match \/platformSettings\/\{settingId\}[\s\S]*allow get, create, update, delete: if isSuperAdmin\(\)/);
    assert.match(rulesText, /match \/payments\/\{paymentId\}[\s\S]*allow create: if isSuperAdmin\(\)/);
    assert.match(rulesText, /match \/invoices\/\{invoiceId\}[\s\S]*allow create, update: if isSuperAdmin\(\)/);
  });
});
