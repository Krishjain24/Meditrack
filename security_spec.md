# MediTrack Firestore Security Specification (Phase 0)

## 1. Data Invariants
1. **Verified Ownership & Isolation**: No collection permits unauthenticated reads/writes or blanket `isSignedIn()` reads. Every operational record (`smartBins`, `segregationEvents`, `collectionAlerts`, `vehicles`, `disposalLedger`, `visitorSessions`) carries an immutable `ownerId` matching `request.auth.uid` on creation, and `allow list` strictly evaluates `resource.data.ownerId == request.auth.uid || isBootstrappedAdmin()` with zero `get()`/`exists()` calls.
2. **Email Spoofing Guard**: Admin privileges require both `request.auth.token.email == 'krish.jain.workk@gmail.com'` AND `request.auth.token.email_verified == true` (or an admin document in `/admins/{uid}` with verified email).
3. **Referential Integrity & Atomicity**: Every `segregationEvents`, `collectionAlerts`, and `disposalLedger` document must reference an existing (or same-batch `existsAfter`) `smartBins` document owned by the same `ownerId` (`${ownerId}_${bin_code}`).
4. **Immutable Audit Trail**: `segregationEvents` and `disposalLedger` cannot be modified or deleted by standard owners once committed. `collectionAlerts` lock at terminal state `status == 'collected'`.
5. **Temporal Integrity & Bounded Payloads**: `createdAt` must equal `request.time` on creation and remain immutable on update; `updatedAt` must equal `request.time` on update. All strings, IDs, numbers, and `assigned_route` arrays (`<= 25`) have explicit type, regex, and `.size()` limits.

## 2. The "Dirty Dozen" Attack Payloads (Expected: `PERMISSION_DENIED`)
1. **Unauthenticated Read/Write**: Anonymous caller attempts to list `smartBins` or create a bin without `request.auth`.
2. **Unverified Email Spoof**: Caller sets `request.auth.token.email = 'krish.jain.workk@gmail.com'` with `email_verified: false` to read another user's `disposalLedger`.
3. **OwnerId Spoofing on Create**: User A sends `ownerId: "user-B"` when creating a `smartBins` document.
4. **OwnerId Hijack on Update**: User A updates `smartBins` with `ownerId: "user-B"` to transfer ownership.
5. **Shadow / Ghost Field Injection**: User creates `smartBins` with an extra undeclared field `isVerified: true` or `role: "admin"`.
6. **Document ID Poisoning**: Caller attempts `create` on `/smartBins/bad$id/../../../etc` or a 300-character document ID.
7. **Self-Assigned Admin Escalation**: Non-admin user attempts to create `/admins/{myUid}` with `role: "admin"`.
8. **Client Timestamp Forgery**: Caller creates `smartBins` with backdated `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
9. **Terminal State Bypass on CollectionAlert**: Non-admin user attempts to mutate a `collectionAlerts` record whose `status` is already `'collected'` back to `'pending'`.
10. **Immutable Ledger Tampering**: Non-admin user attempts to update or delete a committed `disposalLedger` manifest (`chain_hash` tampering).
11. **Orphaned Record Injection**: Caller creates a `disposalLedger` manifest referencing `bin_code: "NONEXISTENT-999"` with no backing `smartBins` document.
12. **Unbounded Array / Resource Exhaustion**: Caller updates `vehicles` with 50 stops in `assigned_route` (`> 25`) or a `notes` string exceeding 500 characters.
