# Jimmi Payments & Club Onboarding Specification v1.0

**Purpose:** Codex / engineering implementation specification  
**Scope:** Authentication, Club onboarding, multi-organizer roles, payment onboarding, KYC/KYB, payout ownership, finance permissions, risk controls, refunds/chargebacks, and core data model.

> **Codex instruction:** Treat this document as the source of truth for this task. First audit the existing Jimmi codebase and map the current implementation to this specification. Then implement the required changes incrementally. Preserve existing working functionality, data and UI conventions unless this specification requires a change. Do not create a second parallel Club/payment architecture when existing models can safely be extended or migrated.

---

## 1. Product Principles

1. A **Jimmi User** represents a person.
2. A **Club** represents the operational workspace/payment-owning group inside Jimmi.
3. A Club can have multiple Users with different roles.
4. One User can belong to multiple Clubs.
5. A Session belongs financially to a Club, not to the individual Organizer who created it.
6. Each Club can have only **one active payment/connected account** at a time.
7. Each Club can have only **one active verified payout destination** at a time.
8. All paid Sessions belonging to a Club route through that Club's payment account.
9. Jimmi must not route Club revenue to different bank accounts based on which Organizer created a Session.
10. Jimmi should not receive player money into its ordinary company bank account and manually forward it to Clubs. Use a regulated marketplace/platform PSP structure.
11. KYC/KYB is **not required** merely to register, create a Club, invite colleagues, or create draft/free Sessions.
12. Payment verification is triggered when a Club enables payments or attempts to publish a paid Session.
13. Jimmi software roles and PSP legal/KYC roles are separate concepts.
14. Sensitive identity documents should be collected/retained by the PSP wherever possible, not Jimmi.

---

## 2. User Registration & Authentication

### 2.1 Registration fields

Current Jimmi registration MUST use:

- Full name
- Email address
- Password

**Do not require a mobile phone number or SMS OTP at this stage.**

### 2.2 Registration flow

```text
Create Account
    ↓
Full Name + Email + Password
    ↓
Create Account
    ↓
Send verification email
    ↓
User clicks verification link
    ↓
Email Verified
    ↓
Account Active
```

Email verification is mandatory before a user can:

- create a Club;
- accept a Club invitation;
- publish a Session;
- hold an active Owner/Admin/Organizer membership.

Before verification, allow login but gate protected actions and show:

> Please verify your email address to continue.

Provide:

- Resend verification email
- Change email address
- Log out

### 2.3 Authentication requirements

- Secure password hashing using the framework's recommended production mechanism.
- Password reset via email.
- Verification links must expire and be single-use or securely invalidated.
- Rate-limit login, reset and verification endpoints.
- Do not add SMS OTP at this stage.

---

## 3. Core Data Model

```text
User
  └── ClubMembership ──> Club
                         ├── Sessions
                         ├── PaymentAccount
                         ├── Payout configuration
                         └── Finance / Transactions
```

A User may belong to multiple Clubs with different roles.

Example:

```text
Jack
├── Bromley Badminton Club → Admin
├── Croydon Smashers       → Owner
└── London Elite           → Organizer
```

### 3.1 Recommended core entities

#### User

```text
id
full_name
email
password/auth fields
email_verified_at
status
created_at
```

#### Club

```text
id
name
primary_sport
main_area
status
created_by_user_id
payment_entity_type
created_at
```

#### ClubMembership

```text
id
club_id
user_id
role
status
invited_by_user_id
joined_at
```

#### ClubInvitation

```text
id
club_id
email
intended_role
token/hash
expires_at
accepted_at
revoked_at
```

#### Session

```text
id
club_id
created_by_user_id
organizer_user_id
venue
start/end time
capacity
price
status
...
```

#### PaymentAccount

```text
id
club_id
provider
provider_account_id
onboarding_status
payments_enabled
payouts_enabled
legal_entity_type
```

#### PayoutDestination

Prefer PSP references/metadata only:

```text
provider reference
bank display name
last4
status
```

Avoid storing raw bank credentials if the PSP can hold them.

#### Payment / BookingTransaction

```text
club_id
session_id
booking_id
provider_payment_id
gross_amount
platform_fee
provider_fee (if known)
refund_status
dispute_status
```

#### AuditEvent

```text
actor_user_id
club_id
event_type
target
timestamp
non-sensitive metadata
```

---

## 4. Club Creation Onboarding

Club creation must be lightweight.

Do **not** request at this stage:

- Passport
- DOB
- Home address
- Bank details
- Company number
- Directors
- UBO information
- KYC documents

### Create Club form

Required:

- **Club Name** — e.g. Bromley Social Badminton
- **Primary Sport** — Badminton / Football / Basketball / Volleyball / Tennis / Padel / Other
- **Main Area** — e.g. Bromley

The verified User who creates the Club automatically becomes:

**Club Owner**

Immediately navigate to the Club Dashboard.

Before payment onboarding the Club can:

- invite team members;
- create free Sessions;
- create draft paid Sessions;
- configure capacity;
- configure pricing;
- configure cancellation rules;
- explore operational features.

---

## 5. Multi-Organizer Invitation Flow

V1 invitation method:

**Email**

```text
Owner/Admin enters invitee email
    ↓
Select role
    ↓
Send invitation
    ↓
Invitee receives email
    ↓
Existing user → Login
New user → Name + Email + Password → Verify email
    ↓
Accept invitation
    ↓
ClubMembership becomes active
```

Invitation must bind to:

- `club_id`
- intended role
- invited email

Invitation tokens must:

- expire;
- be revocable;
- not be reusable after acceptance.

---

## 6. Club Roles & Permissions

V1 uses three roles:

- Owner
- Admin
- Organizer

Do not build a complex custom permission builder in V1.

### 6.1 Owner

Can:

- edit Club profile;
- create/edit/delete Sessions;
- see all bookings;
- manage participants;
- issue refunds;
- view all financial data;
- invite/remove team members;
- change roles;
- access payment settings;
- initiate payout account changes;
- configure payout schedule if supported;
- transfer Club ownership;
- close/archive Club.

### 6.2 Admin

Can:

- create/edit Sessions;
- manage bookings;
- manage attendance;
- view Club financial information;
- issue refunds subject to policy;
- invite Organizers if permitted;
- manage operational Club settings.

By default Admin CANNOT:

- transfer ownership;
- close Club;
- replace active payout bank account;
- modify legal/KYC entity;
- remove Owner.

### 6.3 Organizer

Can:

- create Sessions;
- edit Sessions they manage;
- view participants for assigned Sessions;
- manage attendance;
- communicate with participants;
- view operational Session data.

Organizer CANNOT:

- access payout settings;
- modify bank account;
- access KYC settings;
- transfer Club ownership;
- remove other Club members;
- change Club legal entity;
- manually withdraw Club funds.

Optional V1:

Organizer may see Session-level gross revenue but not full Club finance.

---

## 7. Session Ownership

Every Session should contain:

```text
session.club_id
session.created_by_user_id
session.organizer_user_id
```

But financially:

```text
FINANCIAL OWNER = CLUB
```

Not:

```text
FINANCIAL OWNER = ORGANIZER
```

Consequences:

- Organizer leaving does not affect existing bookings.
- Session revenue remains with the Club.
- Refunds remain possible after Organizer leaves.
- Historical reporting stays intact.
- Club ownership/personnel can change without moving Session money between personal accounts.

---

## 8. Payment Architecture

Use a marketplace/platform PSP such as Stripe Connect or an equivalent provider supporting:

- connected/sub-merchant accounts;
- KYC/KYB;
- platform fees;
- payment processing;
- payouts.

### Do NOT use

```text
Player
  ↓
Jimmi ordinary bank account
  ↓
Club / Organizer
```

### Target architecture

```text
Player
  ↓
Regulated PSP
  ↓
Club Connected/Sub-merchant Account
  ├── Club proceeds
  └── Jimmi platform fee
```

Where practical, isolate provider-specific implementation behind something like:

```text
PaymentProviderService
```

Do not scatter provider-specific assumptions across unrelated application code.

---

## 9. One Club = One Active Payment Account

Each Club can have:

```text
0 or 1 active payment account
```

Example:

```text
Bromley Social Badminton
    ↓
Connected Payment Account
    ↓
Verified Bank Account ••••3812
```

All paid Sessions under that Club use this payment account.

Do NOT:

- create one payment account per Organizer;
- route Session funds based on which Organizer created the Session;
- create Organizer wallets for V1.

---

## 10. Enable Payments: Progressive Onboarding

Do not perform KYC during initial registration or Club creation.

Trigger payment onboarding when the Club:

- selects **Accept Payments**, or
- attempts to publish its first paid Session.

Suggested UI:

```text
Start accepting payments

Set up your Club to securely collect player payments.
Usually takes only a few minutes.

[ Set up payments ]
```

---

## 11. Select How the Club Is Operated

Before entering PSP onboarding ask:

```text
How is this Club operated?

○ Individual / Sole Trader
○ Registered Company
○ Club / Organisation
```

Store as Jimmi metadata, for example:

```text
club.payment_entity_type
```

Suggested values:

```text
individual
company
organisation
```

The PSP remains the source of truth for legal/KYC status.

---

## 12. Payment Onboarding by Entity Type

### 12.1 Individual / Informal Group

This supports a common case where several people run a sports group without an incorporated company.

Example:

```text
Bromley Social Badminton
├── Benny → Owner
├── Jack  → Admin
└── Amy   → Organizer
```

One appropriate person becomes the:

**Payment Account Representative**

Example:

```text
Representative: Benny
```

The PSP performs required identity verification.

The public/display Club name may remain:

```text
Bromley Social Badminton
```

but the underlying payment account must have a clearly identified legal payee/representative.

Jimmi must not imply that an informal Club is a separate incorporated legal entity when it is not.

### 12.2 Registered Company

Launch PSP hosted/embedded onboarding.

The PSP may request:

- legal company name;
- company number;
- registered address;
- account representative;
- directors;
- beneficial owners / UBOs;
- identity information;
- bank details.

Do not hard-code all compliance fields into Jimmi.

Prefer PSP Hosted or Embedded Onboarding.

### 12.3 Club / Organisation

Optionally ask subtype:

- Sports Club
- Association / Community Group
- Charity
- Other

Then enter the PSP-supported legal entity flow.

The PSP determines required verification.

---

## 13. Jimmi Roles vs Payment Legal Roles

These concepts MUST remain separate.

Example:

| Person | Jimmi role | Possible payment/legal role |
|---|---|---|
| Benny | Owner | Account Representative |
| Jack | Admin | Director / UBO if legally applicable |
| Amy | Organizer | None |

A Jimmi Organizer must NOT automatically require KYC.

Only people required by the PSP/legal entity structure should complete compliance verification.

---

## 14. Multi-Organizer Club Payout Model

Default model:

**Club balance + automatic payout to one verified payout destination.**

```text
Monday Session revenue
Wednesday Session revenue
Saturday Session revenue
        ↓
     CLUB BALANCE
        ↓
Automatic payout
        ↓
Verified bank account ••••3812
```

V1 should prefer automatic payouts rather than giving every Organizer a manual **Withdraw** button.

Authorized finance viewers may see balance and payout status according to role.

Only the Owner should be able to initiate the protected payout-destination change flow by default.

---

## 15. Payout Bank Account Security

Changing where Club money is paid is a high-risk action.

Minimum V1 flow:

1. Owner selects **Change payout account**.
2. Require recent authentication/password re-entry or another secure step-up supported by the auth stack.
3. New payout destination is entered/verified through the PSP wherever possible.
4. Send security notification email to Owner and relevant Admins.
5. Record an AuditEvent.
6. Apply a configurable security hold before the new destination becomes active where supported/appropriate.

Never expose full bank details.

Display masked information, e.g.:

```text
Barclays ••••3812
```

### Future: Dual approval

Do not make dual approval mandatory for small Clubs in V1.

Architect the system so a later security setting can require two authorized finance users to approve payout destination changes.

---

## 16. Payment State Machine

Recommended Club payment states:

```text
NOT_STARTED
    ↓
ONBOARDING
    ↓
REQUIREMENTS_PENDING
    ↓
VERIFIED
    ↓
PAYMENTS_ENABLED
    ↓
PAYOUTS_ENABLED
```

Possible exception states:

```text
RESTRICTED
ADDITIONAL_VERIFICATION_REQUIRED
PAYOUTS_PAUSED
DISABLED
```

Do not infer verification merely because a user completed a UI form.

Update state from the PSP API/webhooks and treat provider state as authoritative.

---

## 17. Publishing Rules

| State / action | Allowed? |
|---|---|
| Create Club without KYC | Yes |
| Invite team without KYC | Yes |
| Create draft Session without KYC | Yes |
| Publish free Session without payment onboarding | Yes |
| Configure price before KYC | Yes |
| Publish paid Session before payment account can accept payments | No — route to payment setup |
| Collect player payment when PSP says payments disabled | No |

---

## 18. PSP Webhooks & Synchronisation

Implement idempotent webhook processing for events relevant to:

- connected/payment account updates;
- requirements due;
- verification status;
- payments succeeded/failed;
- refunds;
- disputes/chargebacks;
- payout created/paid/failed;
- payment/payout capability restrictions.

Store provider event IDs.

Duplicate webhook delivery must not create duplicate financial state changes.

---

## 19. Refunds, Cancellations & Chargebacks

Refund authority belongs to the Club permission model, not to whoever originally created the Session.

Minimum rules:

- Refund references original booking/payment.
- Store refund reason, actor, amount, timestamp and PSP refund ID.
- Support full refund first; keep architecture compatible with partial refunds.
- Session cancellation uses Club cancellation/refund policy.
- Chargebacks/disputes associate with Club, Session and Booking.
- Do not deduct dispute losses from unrelated Organizer personal balances because Organizer wallets do not exist.
- Surface dispute/payout restrictions clearly to Owner/Admin.

---

## 20. Jimmi Risk & Trust Layer

The PSP handles statutory payment KYC/KYB/AML controls.

Jimmi should add marketplace risk controls without building its own passport/selfie KYC system.

Potential risk signals:

- unusually rapid GMV growth for a new Club;
- high refund rate;
- high dispute/chargeback rate;
- repeated payout destination changes;
- multiple unrelated Clubs using the same payout destination;
- many Clubs created by the same account in a short period;
- large value spikes inconsistent with historical Session activity;
- suspicious account access or ownership changes.

Risk actions should be proportionate.

Where appropriate prefer:

- additional review;
- additional verification;
- payout restriction/hold;

rather than automatically deleting the Club.

---

## 21. Public Trust Indicators

Jimmi may display safe trust indicators such as:

```text
Verified Organizer / Verified Club
38 Sessions hosted
146 players joined
4.9 rating
```

Wording must accurately reflect what was actually verified.

Never publicly expose:

- DOB;
- home address;
- identity documents;
- full bank details;
- PSP KYC data.

---

## 22. Audit Logging

At minimum audit:

- Club creation;
- invitation sent/revoked/accepted;
- role changes;
- member removal;
- ownership transfer;
- payment onboarding started/completed/status changed;
- payout destination change requested/completed;
- refunds;
- Club closure/archive;
- security-sensitive finance changes.

Each audit record should identify:

```text
actor
club
action
timestamp
relevant non-sensitive metadata
```

---

## 23. Server-Side Authorization

Recommended authorization functions/policies:

```text
canCreateSession(user, club)
canEditSession(user, session)
canViewClubFinance(user, club)
canIssueRefund(user, club)
canInviteMember(user, club)
canChangeRole(user, club)
canManagePaymentSettings(user, club)
canChangePayoutDestination(user, club)
canTransferOwnership(user, club)
```

Authorization MUST be enforced server-side.

Hiding a UI button is not sufficient.

---

## 24. Existing Jimmi Codebase: Migration Instructions for Codex

Before changing code:

1. Inspect the current project architecture.
2. Identify existing auth/user/profile models.
3. Identify existing Club/group/team models.
4. Identify existing Session/event models.
5. Identify booking/payment code.
6. Identify current database schema/migrations.
7. Identify existing payment provider integration.
8. Identify current UI routes/components.

Then implement incrementally:

1. Map existing models to User, Club, ClubMembership, Session and PaymentAccount concepts.
2. Preserve existing IDs/data; use migrations instead of resetting data.
3. Change registration UI/API to **Full Name + Email + Password**.
4. Implement email verification and protected-action gating.
5. Introduce/normalize roles: Owner, Admin, Organizer.
6. Ensure Session has `club_id` and is financially owned by Club.
7. Add email-based Club invitations.
8. Add Club payment onboarding state and legal entity type.
9. Integrate/refactor PSP connected-account onboarding behind a payment service abstraction.
10. Ensure all Club paid Sessions route to one Club payment account.
11. Implement role-based finance permissions.
12. Implement payout-destination security flow.
13. Implement provider webhook synchronization.
14. Add audit logging for sensitive actions.
15. Add automated tests for authorization, invitations, payment state gating and multi-Club membership.

Do NOT rewrite unrelated UI/business logic unless required.

Keep current visual design conventions unless a screen must change to support this specification.

---

## 25. Acceptance Criteria

The implementation is not complete until all of the following are true:

- [ ] New user can register using only Name + Email + Password.
- [ ] No phone number is required at registration.
- [ ] No SMS OTP is required.
- [ ] User receives verification email.
- [ ] User must verify email before creating/joining a Club.
- [ ] Verified User can create Club without KYC.
- [ ] Club creator automatically becomes Owner.
- [ ] Owner can invite users by email as Admin or Organizer.
- [ ] One User can belong to multiple Clubs.
- [ ] Club can create free/draft Sessions without KYC.
- [ ] Paid Session cannot go live until Club payment account can accept payments.
- [ ] Payment onboarding supports Individual/Sole Trader, Registered Company and Club/Organisation entry paths.
- [ ] Jimmi does not require every Organizer to complete KYC.
- [ ] All paid Sessions for one Club route to the same active Club payment account.
- [ ] Organizer cannot change payout bank account.
- [ ] Admin cannot change payout bank account by default.
- [ ] Owner payout change uses step-up security, notification and audit logging.
- [ ] Session revenue remains with Club if Organizer leaves.
- [ ] PSP webhooks update verification/payment/payout state idempotently.
- [ ] Sensitive KYC documents are not unnecessarily stored in Jimmi.

---

## 26. Required Test Scenarios

1. Register → verification email → verify → create Club.
2. Attempt to create Club before email verification → blocked with resend option.
3. Owner invites existing Admin and new Organizer → both join correctly.
4. One User belongs to two Clubs with different roles.
5. Organizer creates Session → Club remains financial owner.
6. Free Session publishes without KYC.
7. Paid Session publish attempt without payment setup → redirected/gated.
8. Individual Club completes PSP onboarding → payment capability updates from provider/webhook state.
9. Company Club supports Owner who is not necessarily the only PSP-verified legal person.
10. Organizer attempts payout-account change → server rejects.
11. Admin attempts payout-account change → server rejects by default.
12. Owner changes payout account → step-up + notification + AuditEvent.
13. Organizer removed after bookings exist → Session/bookings/revenue remain intact.
14. Duplicate payment webhook → no duplicate financial mutation.
15. Authorized refund → correct audit/payment linkage.
16. Club A and Club B owned by same User maintain completely separate payment account references/balances.

---

## 27. Explicitly Out of Scope for V1

Do NOT implement unless already required elsewhere in the existing product:

- SMS/phone-number registration.
- Phone OTP.
- Organizer-specific wallets.
- Multiple active payout bank accounts per Club.
- Per-Organizer revenue routing.
- Mandatory two-person approval for every payout change.
- Custom role/permission builder.
- Jimmi-built passport/selfie KYC engine.
- Jimmi manually holding and redistributing Club funds.

---

## 28. Target Architecture Summary

```text
JIMMI USER
(Name + Email + Password)
        ↓
EMAIL VERIFICATION
        ↓
CLUB
        ├── Owner
        ├── Admin(s)
        └── Organizer(s)
        ↓
SESSIONS
(Financially owned by Club)
        ↓
ENABLE PAYMENTS
        ↓
ENTITY TYPE
Individual / Company / Organisation
        ↓
PSP CONNECTED/SUB-MERCHANT ONBOARDING
(KYC/KYB performed as required by PSP)
        ↓
ONE CLUB PAYMENT ACCOUNT
        ↓
PLAYER PAYMENTS
        ├── Club proceeds
        └── Jimmi platform fee
        ↓
CLUB BALANCE
        ↓
AUTOMATIC PAYOUT
        ↓
ONE VERIFIED PAYOUT DESTINATION
```

---

# Final Instruction to Codex

**Do not immediately start rewriting the application.**

First:

1. Audit the existing Jimmi implementation.
2. Compare the existing architecture with this specification.
3. Identify which existing models/routes/components/services can be reused.
4. Identify required database migrations.
5. Identify any conflicts or migration risks.
6. Produce a concise implementation plan referencing the actual project files.

Then implement the changes in safe, testable increments.

Preserve existing working features, data and styling wherever possible.

Do not invent a second parallel Club/payment architecture if equivalent existing models can be migrated or extended.

Where the selected payment provider's actual API/compliance requirements differ from assumptions in this specification, follow the provider's current supported marketplace/connected-account flow while preserving the Jimmi domain principles above.

**Do not implement Jimmi as an unregulated wallet or manual money-transmission layer.**
