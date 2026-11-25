# Security Specification & Payload-First TDD (`security_spec.md`)

## 1. Core Data Invariants
1. **Tenant Isolation**: Every business record (`assets`, `tickets`, `incidents`, `problems`, `changes`, `serviceRequests`, `softwareLicences`, `vendors`, `purchaseRequests`, `slaPolicies`, `contracts`, `auditLogs`, etc.) requires a valid `tenantId` and `orgId` matching `^[a-zA-Z0-9_-]+$` (`<= 128` chars), and reads/writes are denied unless the authenticated user holds an active membership in `userMemberships/{uid}_{tenantId}` with org access (`orgAccessMode == 'all'` or `orgId` authorized) and `email_verified == true`, or is the verified Platform Super Admin (`georgearthur848@gmail.com` with `email_verified == true`).
2. **PII Isolation**: User PII (`email`, `phone`, `mfaEnabled`) lives under `/users/{uid}/private/{docId}` and is readable/writable ONLY by the owning `uid` or verified Platform Super Admin—never via blanket `isSignedIn()` reads.
3. **Immutable Ownership & Timestamps**: `createdBy`, `tenantId`, and `createdAt` (`== request.time` on create) cannot be reassigned during updates.
4. **Role & Subscription Integrity**: Client writes cannot escalate `role` on `userMemberships`, mutate `platformAuditLogs`, forge `payments` / `invoices`, or bypass subscription status/limits.
5. **Strict Key Allowlists**: Every document creation requires exact required fields (`hasAll`) and rejects shadow/ghost fields (`hasOnly`), while updates split into allowlisted `affectedKeys().hasOnly(...)` actions.

## 2. "Dirty Dozen" Attack Payloads (Must All Yield `PERMISSION_DENIED`)
1. **Unauthenticated Asset Read**: Anonymous client attempts `get(/assets/ast-1)` or `list(/assets)`.
2. **Cross-Tenant Asset Read**: User in `tenant-a` attempts `get(/assets/ast-b-1)` belonging to `tenant-b`.
3. **Cross-Tenant List Scrape**: User in `tenant-a` runs unfiltered `list(/assets)` without `where('createdBy', '==', uid)` / tenant constraint.
4. **Cross-Org MSP Leakage**: MSP Technician assigned only to `org-client-1` attempts write/read on `org-client-2` asset.
5. **Self-Role Escalation**: Normal tenant member creates/updates `/userMemberships/{uid}_{tenantId}` setting `role: 'tenant_owner'` or `status: 'active'`.
6. **Shadow / Ghost Field Injection**: Member creates an asset injecting `{ ..., isVerified: true, adminOverride: true }`.
7. **Email Spoof Without Verification**: User token with `email: 'georgearthur848@gmail.com'` and `email_verified: false` attempts Super Admin read/write on `/plans/starter`.
8. **ID Poisoning / DoW**: Attacker writes `/assets/${'A'.repeat(500)}` or injects 100KB string into `title`.
9. **PII Cross-User Read**: Authenticated User A attempts `get(/users/userB/private/info)`.
10. **Immutable Field Hijack**: Member updates `/assets/ast-1` attempting to change `tenantId` or `createdBy` or `createdAt`.
11. **Terminal State Mutation**: Non-admin user attempts to modify a closed/disposed record or mutate `/auditLogs/log-1` or `/platformAuditLogs/plog-1`.
12. **Client-Side Payment Forgery**: Non-super-admin tenant user attempts `create(/payments/pay-fake)` with `status: 'success'`.
