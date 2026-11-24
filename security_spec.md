# IND AGENT Firestore Security Specification (Phase 0)

## Data Invariants
1. Every document under `/users/{userId}` and its subcollections (`/sessions`, `/memories`, `/skills`) is strictly private to the authenticated, email-verified user whose `request.auth.uid == userId` (with an explicit `isAdmin()` escape hatch on `/users/{userId}` solely for reading and activating `plan` + `planExpiresAt`).
2. Users cannot self-upgrade `plan` to `'plus'` or set `planExpiresAt` on create or update — client creation must initialize `plan == 'free'`, and user updates cannot mutate `plan`, `planExpiresAt`, `uid`, or `createdAt`.
3. Only the verified owner-admin (`ffonlypro@gmail.com` with `email_verified == true`) can write `/settings/billing`, list all `/paymentRequests`, approve/reject a pending payment request, or activate `plan: 'plus'` + `planExpiresAt` on a user's `/users/{userId}` document.
4. Payment requests under `/paymentRequests/{requestId}` can only be created by an authenticated, email-verified user for their own `userId` with `status == 'pending'`, `amountInr == 200`, `plan == 'plus'`, and a valid 10–24 char alphanumeric UTR. Once reviewed (`approved` or `rejected`), a payment request enters a terminal locked state and can never be modified or deleted.
5. Every subcollection write verifies parent user document existence via `exists(/databases/$(database)/documents/users/$(userId))` (Master Gate).
6. All IDs match `^[a-zA-Z0-9_\-]+$` (<= 128 chars), all strings enforce explicit `.size()` bounds, `messages` arrays are bounded (`<= 100`), and timestamps match `request.time`.
7. Rolling 5-hour usage fields (`usageWindowStart`, `usageWindowCount`) on `/users/{userId}` are strictly bounded integers and cannot be downgraded or reset by the client before the 5-hour window expires.

## Dirty Dozen Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/alice` with `auth == null`.
2. **Cross-User PII Read**: `GET /users/alice` signed in as `bob`.
3. **Unverified Email Write**: `CREATE /users/alice` where `auth.token.email_verified == false`.
4. **Plan Self-Escalation on Create**: `CREATE /users/alice` with `{ plan: "plus" }`.
5. **Plan Self-Escalation on Update**: `UPDATE /users/alice` modifying `plan` to `"plus"` or `planExpiresAt`.
6. **Self-Approving Payment Request**: `CREATE /paymentRequests/p1` with `{ status: "approved" }` or `UPDATE /paymentRequests/p1` as the customer.
7. **Tampering Billing UPI ID**: `UPDATE /settings/billing` by a non-admin user trying to swap in their own UPI ID.
8. **Cross-User Payment Request Read**: `GET /paymentRequests/p1` or `LIST /paymentRequests` by a non-admin user reading another customer's UTR/email.
9. **Re-opening Terminal Payment Request**: `UPDATE /paymentRequests/p1` when `existing().status != 'pending'`.
10. **Amount Forgery**: `CREATE /paymentRequests/p1` with `{ amountInr: 1 }` instead of `200`.
11. **Shadow Field Injection / ID Poisoning**: `CREATE /users/alice` with `{ isAdmin: true }` or `CREATE /users/alice/memories/bad..id$!!`.
12. **Usage Quota Downgrade / Tampering**: `UPDATE /users/alice` resetting `usageWindowCount` from `20` to `0` while inside an active 5-hour window.
