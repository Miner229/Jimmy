export class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export function requireVerified(user) {
  if (!user) throw new HttpError(401, "Please sign in to continue.");
  if (user.status !== "active")
    throw new HttpError(403, "This account is not active.");
  if (!user.email_verified_at)
    throw new HttpError(
      403,
      "Please verify your email address to continue.",
      "EMAIL_UNVERIFIED",
    );
}
const permissions = {
  createSession: ["Owner", "Admin", "Organizer"],
  editSession: ["Owner", "Admin", "Organizer"],
  deleteSession: ["Owner"],
  viewBookings: ["Owner", "Admin", "Organizer"],
  attendance: ["Owner", "Admin", "Organizer"],
  viewFinance: ["Owner", "Admin"],
  refund: ["Owner", "Admin"],
  invite: ["Owner", "Admin"],
  editClub: ["Owner", "Admin"],
  changeRole: ["Owner"],
  removeMember: ["Owner"],
  paymentSettings: ["Owner"],
  payoutChange: ["Owner"],
  transfer: ["Owner"],
  archive: ["Owner"],
};
export function authorize(user, membership, action, session = null) {
  requireVerified(user);
  if (
    !membership ||
    membership.status !== "active" ||
    membership.user_id !== user.id ||
    !permissions[action]?.includes(membership.role)
  )
    throw new HttpError(
      403,
      "You do not have permission for this Club action.",
    );
  if (session && session.club_id !== membership.club_id)
    throw new HttpError(403, "Session belongs to a different Club.");
  if (
    session &&
    ["editSession", "viewBookings", "attendance"].includes(action) &&
    membership.role === "Organizer" &&
    session.organizer_user_id !== user.id
  )
    throw new HttpError(403, "You can only manage Sessions assigned to you.");
}
export function validateInvitation(invite, user, now = Date.now()) {
  requireVerified(user);
  if (
    !invite ||
    invite.revoked_at ||
    invite.accepted_at ||
    new Date(invite.expires_at).getTime() <= now
  )
    throw new HttpError(
      410,
      "This invitation has expired or is no longer valid.",
    );
  if (invite.email.toLowerCase() !== user.email.toLowerCase())
    throw new HttpError(
      403,
      "Sign in with the email address that received this invitation.",
    );
}
export function assertPublish(session, account) {
  if (
    session.price > 0 &&
    (!account?.active ||
      !account.provider_account_id ||
      !account.payments_enabled)
  )
    throw new HttpError(
      409,
      "Set up Club payments before publishing a paid Session.",
      "PAYMENT_SETUP_REQUIRED",
    );
}
export function paymentState(account, holding = false) {
  const disabled = account.requirements?.disabled_reason;
  if (disabled?.startsWith("rejected")) return "DISABLED";
  if (disabled) return "RESTRICTED";
  if (holding) return "PAYOUTS_PAUSED";
  if (account.requirements?.past_due?.length)
    return "ADDITIONAL_VERIFICATION_REQUIRED";
  if (account.charges_enabled && account.payouts_enabled)
    return "PAYOUTS_ENABLED";
  if (account.charges_enabled) return "PAYMENTS_ENABLED";
  if (account.requirements?.currently_due?.length)
    return "REQUIREMENTS_PENDING";
  return account.details_submitted ? "VERIFIED" : "ONBOARDING";
}
export function text(value, label, max = 200) {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new HttpError(400, `Enter a valid ${label}.`);
  return value.trim();
}
export function integer(value, label, min, max) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new HttpError(400, `Invalid ${label}.`);
  return n;
}
