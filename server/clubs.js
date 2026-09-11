import { one, uuid, token, hash, audit } from "./db.js";
import {
  authorize,
  requireVerified,
  validateInvitation,
  HttpError,
  text,
  integer,
  assertPublish,
  paymentState,
} from "./domain.js";
import { siteOrigin } from "./payment-provider.js";
export async function membership(db, user, club, action, session) {
  const m = await one(
    db,
    `select m.* from club_memberships m join clubs c on c.id=m.club_id where m.user_id=$1 and m.club_id=$2 and c.status='active' for update of c,m`,
    [user.id, club],
  );
  authorize(user, m, action, session);
  return m;
}
export async function email(db, recipient, subject, body) {
  await db.query(
    "insert into email_outbox(id,recipient,subject,body) values($1,$2,$3,$4)",
    [uuid(), recipient, subject, body],
  );
}
export async function financeNotification(db, club, subject, body) {
  const recipients = (
    await db.query(
      `select u.email from users u join club_memberships m on m.user_id=u.id where m.club_id=$1 and m.status='active' and m.role in ('Owner','Admin')`,
      [club],
    )
  ).rows;
  for (const u of recipients) await email(db, u.email, subject, body);
}
export async function createClub(db, user, input) {
  requireVerified(user);
  const id = uuid();
  const name = text(input.name, "Club name", 120),
    sport = text(input.primary_sport, "primary sport", 50),
    area = text(input.main_area, "main area", 120);
  if (
    ![
      "Badminton",
      "Football",
      "Basketball",
      "Volleyball",
      "Tennis",
      "Padel",
      "Other",
    ].includes(sport)
  )
    throw new HttpError(400, "Select a primary sport.");
  await db.query(
    "insert into clubs(id,name,primary_sport,main_area,created_by_user_id) values($1,$2,$3,$4,$5)",
    [id, name, sport, area, user.id],
  );
  await db.query(
    `insert into club_memberships(id,club_id,user_id,role) values($1,$2,$3,'Owner')`,
    [uuid(), id, user.id],
  );
  await audit(db, user, id, "club.created", id);
  const count = await one(
    db,
    `select count(*)::int as n from clubs where created_by_user_id=$1 and created_at>now()-interval '1 day'`,
    [user.id],
  );
  if (count.n > 5)
    await db.query(
      `insert into risk_flags(id,club_id,signal) values($1,$2,'rapid_club_creation')`,
      [uuid(), id],
    );
  return { id };
}
export async function invite(db, user, input) {
  const m = await membership(db, user, input.club_id, "invite");
  const role = input.role;
  if (
    !["Admin", "Organizer"].includes(role) ||
    (m.role === "Admin" && role !== "Organizer")
  )
    throw new HttpError(403, "Admins can only invite Organizers.");
  const address = text(input.email, "email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
    throw new HttpError(400, "Enter a valid email address.");
  const secret = token(),
    id = uuid();
  await db.query(
    "insert into club_invitations(id,club_id,email,intended_role,token_hash,expires_at,invited_by_user_id) values($1,$2,$3,$4,$5,now()+interval '7 days',$6)",
    [id, input.club_id, address, role, hash(secret), user.id],
  );
  await email(
    db,
    address,
    "You are invited to a Jimmi Club",
    `Sign in and verify this email address, then accept your invitation as ${role}: ${siteOrigin()}/?invitation=${secret}\nThis link expires in 7 days.`,
  );
  await audit(db, user, input.club_id, "invitation.sent", id, { role });
  return { id, message: "Invitation queued for email delivery." };
}
export async function acceptInvite(db, user, secret) {
  requireVerified(user);
  const i = await one(
    db,
    "select * from club_invitations where token_hash=$1 for update",
    [hash(text(secret, "invitation token", 100))],
  );
  validateInvitation(i, user);
  const c = await one(
    db,
    "select id from clubs where id=$1 and status='active' for update",
    [i.club_id],
  );
  if (!c) throw new HttpError(410, "This Club is no longer active.");
  const existing = await one(
    db,
    "select * from club_memberships where user_id=$1 and club_id=$2",
    [user.id, i.club_id],
  );
  if (existing?.status === "active")
    throw new HttpError(
      409,
      "You already have an active membership in this Club.",
    );
  await db.query(
    `insert into club_memberships(id,club_id,user_id,role,invited_by_user_id) values($1,$2,$3,$4,$5) on conflict(club_id,user_id) do update set role=excluded.role,status='active',invited_by_user_id=excluded.invited_by_user_id,joined_at=now()`,
    [uuid(), i.club_id, user.id, i.intended_role, i.invited_by_user_id],
  );
  await db.query("update club_invitations set accepted_at=now() where id=$1", [
    i.id,
  ]);
  await audit(db, user, i.club_id, "invitation.accepted", i.id);
  return { id: i.club_id };
}
export async function mutateMember(db, user, input) {
  await membership(
    db,
    user,
    input.club_id,
    input.action === "remove"
      ? "removeMember"
      : input.action === "transfer"
        ? "transfer"
        : "changeRole",
  );
  const target = await one(
    db,
    "select m.*,u.email_verified_at from club_memberships m join users u on u.id=m.user_id where m.id=$1 and m.club_id=$2 for update of m",
    [input.id, input.club_id],
  );
  if (!target || target.status !== "active")
    throw new HttpError(404, "Member not found.");
  if (target.role === "Owner")
    throw new HttpError(
      403,
      "Use ownership transfer; the Owner cannot be removed or demoted.",
    );
  if (input.action === "transfer") {
    if (!target.email_verified_at)
      throw new HttpError(403, "The new Owner must have a verified email.");
    await db.query(
      "update club_memberships set role='Admin' where club_id=$1 and user_id=$2",
      [input.club_id, user.id],
    );
    await db.query("update club_memberships set role='Owner' where id=$1", [
      target.id,
    ]);
  } else if (input.action === "remove")
    await db.query("update club_memberships set status='removed' where id=$1", [
      target.id,
    ]);
  else {
    if (!["Admin", "Organizer"].includes(input.role))
      throw new HttpError(400, "Invalid role.");
    await db.query("update club_memberships set role=$1 where id=$2", [
      input.role,
      target.id,
    ]);
  }
  await audit(
    db,
    user,
    input.club_id,
    `membership.${input.action}`,
    target.id,
    { role: input.role },
  );
  return { ok: true };
}
export async function syncAccount(db, provider, account) {
  if (!provider) throw new HttpError(503, "Payments are not configured yet.");
  const current = await provider.account(account.provider_account_id);
  const hold = await one(
    db,
    "select id from payout_changes where payment_account_id=$1 and status!='completed'",
    [account.id],
  );
  const state = paymentState(current, !!hold);
  const updated = await one(
    db,
    "update payment_accounts set onboarding_status=$1,payments_enabled=$2,payouts_enabled=$3,legal_entity_type=$4,requirements=$5,updated_at=now() where id=$6 returning *",
    [
      state,
      !!current.charges_enabled,
      !!current.payouts_enabled && !hold,
      current.business_type || null,
      JSON.stringify(current.requirements?.currently_due || []),
      account.id,
    ],
  );
  if (account.onboarding_status !== state)
    await audit(
      db,
      null,
      account.club_id,
      "payment.status_changed",
      account.id,
      { from: account.onboarding_status, to: state },
    );
  return updated;
}
export async function saveSession(db, user, input, provider) {
  let previous;
  if (input.id) {
    previous = await one(db, "select * from sessions where id=$1", [input.id]);
    if (!previous) throw new HttpError(404, "Session not found.");
  }
  const club = previous?.club_id || input.club_id;
  await membership(
    db,
    user,
    club,
    previous ? "editSession" : "createSession",
    previous,
  );
  if (previous && previous.status !== "draft")
    throw new HttpError(
      409,
      "Use the Session description update for published Sessions. Cancel and refund before changing price, time or capacity.",
    );
  const starts = new Date(input.starts_at),
    ends = new Date(input.ends_at);
  if (
    !Number.isFinite(+starts) ||
    !Number.isFinite(+ends) ||
    ends <= starts ||
    starts <= new Date()
  )
    throw new HttpError(400, "Choose valid future start and end times.");
  const value = {
    id: previous?.id || uuid(),
    club_id: club,
    title: text(input.title, "title", 180),
    venue: text(input.venue, "venue", 300),
    starts_at: starts.toISOString(),
    ends_at: ends.toISOString(),
    capacity: integer(input.capacity, "capacity", 1, 1000),
    price: integer(input.price, "price", 0, 1000000),
  };
  const allowed = [
    "kind",
    "courts",
    "description",
    "format",
    "gender",
    "menMin",
    "menMax",
    "womenMin",
    "womenMax",
    "visibility",
  ];
  const details = Object.fromEntries(
    Object.entries(input.details || {}).filter(
      ([k, v]) =>
        allowed.includes(k) && typeof v === "string" && v.length <= 5000,
    ),
  );
  const status = input.publish ? "published" : "draft";
  let account = await one(
    db,
    "select * from payment_accounts where club_id=$1 and active for update",
    [club],
  );
  if (input.publish && value.price > 0 && account?.provider_account_id)
    account = await syncAccount(db, provider, account);
  if (input.publish) assertPublish(value, account);
  const organizer = previous?.organizer_user_id || user.id;
  if (previous)
    await db.query(
      "update sessions set title=$1,venue=$2,starts_at=$3,ends_at=$4,capacity=$5,price=$6,status=$7,cancellation_hours=$8,details=$9 where id=$10",
      [
        value.title,
        value.venue,
        value.starts_at,
        value.ends_at,
        value.capacity,
        value.price,
        status,
        integer(input.cancellation_hours ?? 12, "cancellation policy", -1, 720),
        JSON.stringify(details),
        value.id,
      ],
    );
  else
    await db.query(
      "insert into sessions(id,club_id,created_by_user_id,organizer_user_id,title,venue,starts_at,ends_at,capacity,price,status,cancellation_hours,details) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [
        value.id,
        club,
        user.id,
        organizer,
        value.title,
        value.venue,
        value.starts_at,
        value.ends_at,
        value.capacity,
        value.price,
        status,
        integer(input.cancellation_hours ?? 12, "cancellation policy", -1, 720),
        JSON.stringify(details),
      ],
    );
  await audit(db, user, club, `session.${status}`, value.id);
  return { id: value.id, status };
}
export async function startOnboarding(db, user, input, provider) {
  await membership(db, user, input.club_id, "paymentSettings");
  if (!["individual", "company", "organisation"].includes(input.entity))
    throw new HttpError(400, "Select how your Club is operated.");
  let club = await one(db, "select * from clubs where id=$1 for update", [
    input.club_id,
  ]);
  let account = await one(
    db,
    "select * from payment_accounts where club_id=$1 and active for update",
    [club.id],
  );
  if (account?.provider_account_id && club.payment_entity_type !== input.entity)
    throw new HttpError(
      409,
      "The legal entity is already associated with this account. Contact support to change it.",
    );
  if (!account) {
    account = { id: uuid(), club_id: club.id };
    await db.query("insert into payment_accounts(id,club_id) values($1,$2)", [
      account.id,
      club.id,
    ]);
  }
  await db.query(
    "update clubs set payment_entity_type=$1,organisation_subtype=$2 where id=$3",
    [input.entity, input.subtype || null, club.id],
  );
  club = { ...club, payment_entity_type: input.entity };
  if (!account.provider_account_id) {
    const created = await provider.createAccount(
      club,
      user.email,
      `club-account-${club.id}`,
    );
    account.provider_account_id = created.id;
    await db.query(
      "update payment_accounts set provider_account_id=$1,onboarding_status='ONBOARDING' where id=$2",
      [created.id, account.id],
    );
  }
  // Once onboarded, all hosted update links must go through the protected
  // payout-change path, since hosted forms may expose bank fields.
  const remote = await provider.account(account.provider_account_id);
  if (remote.details_submitted)
    throw new HttpError(
      409,
      "Use the protected payment details update to continue.",
      "STEP_UP_REQUIRED",
    );
  const link = await provider.onboarding(account.provider_account_id, club.id);
  await audit(db, user, club.id, "payment.onboarding_started", account.id);
  return { url: link.url };
}
