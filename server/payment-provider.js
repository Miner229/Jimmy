import Stripe from "stripe";
import { HttpError, paymentState } from "./domain.js";
export class PaymentProviderService {
  constructor(stripe) {
    if (!stripe && !process.env.STRIPE_SECRET_KEY)
      throw new HttpError(503, "Payments are not configured yet.");
    this.stripe =
      stripe ||
      new Stripe(process.env.STRIPE_SECRET_KEY, {
        maxNetworkRetries: 2,
        timeout: 15000,
      });
  }
  async createAccount(club, email, idempotencyKey) {
    return this.stripe.accounts.create(
      {
        type: "custom",
        country: "GB",
        email,
        ...(club.payment_entity_type === "organisation"
          ? {}
          : { business_type: club.payment_entity_type }),
        business_profile: {
          name: club.name,
          product_description: "Sports club sessions and coaching",
        },
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        settings: { payouts: { schedule: { interval: "daily" } } },
        metadata: {
          club_id: club.id,
          payment_entity_type: club.payment_entity_type,
        },
      },
      { idempotencyKey },
    );
  }
  async account(id) {
    return this.stripe.accounts.retrieve(id);
  }
  async onboarding(id, club, update = false) {
    const base = siteOrigin();
    return this.stripe.accountLinks.create({
      account: id,
      type: update ? "account_update" : "account_onboarding",
      return_url: `${base}/?club=${club}&payment_return=1`,
      refresh_url: `${base}/?club=${club}&payment_refresh=1`,
    });
  }
  async checkout(account, session, booking, fee) {
    return this.stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: booking.id,
        expires_at: Math.floor(new Date(booking.expires_at).getTime() / 1000),
        line_items: [
          {
            price_data: {
              currency: "gbp",
              unit_amount: session.price,
              product_data: { name: session.title },
            },
            quantity: 1,
          },
        ],
        payment_intent_data: {
          application_fee_amount: fee,
          metadata: {
            booking_id: booking.id,
            club_id: session.club_id,
            session_id: session.id,
          },
        },
        metadata: { booking_id: booking.id },
        success_url: `${siteOrigin()}/?booking=${booking.id}`,
        cancel_url: `${siteOrigin()}/?booking=${booking.id}&cancelled=1`,
      },
      {
        stripeAccount: account.provider_account_id,
        idempotencyKey: `checkout-${booking.id}`,
      },
    );
  }
  async refund(account, payment, id) {
    return this.stripe.refunds.create(
      {
        payment_intent: payment.provider_payment_id,
        amount: payment.gross_amount,
        refund_application_fee: true,
      },
      {
        stripeAccount: account.provider_account_id,
        idempotencyKey: `refund-${id}`,
      },
    );
  }
  async pause(id, key) {
    return this.stripe.accounts.update(
      id,
      { settings: { payouts: { schedule: { interval: "manual" } } } },
      { idempotencyKey: key },
    );
  }
  async resume(id, key) {
    return this.stripe.accounts.update(
      id,
      { settings: { payouts: { schedule: { interval: "daily" } } } },
      { idempotencyKey: key },
    );
  }
  async balance(id) {
    return this.stripe.balance.retrieve({ stripeAccount: id });
  }
  async banks(id) {
    return (
      await this.stripe.accounts.listExternalAccounts(id, {
        object: "bank_account",
        limit: 100,
      })
    ).data;
  }
  async payment(id, account) {
    return this.stripe.paymentIntents.retrieve(
      id,
      { expand: ["latest_charge.balance_transaction"] },
      { stripeAccount: account },
    );
  }
  async refundStatus(id, account) {
    return this.stripe.refunds.retrieve(id, { stripeAccount: account });
  }
  async dispute(id, account) {
    return this.stripe.disputes.retrieve(id, { stripeAccount: account });
  }
  async payout(id, account) {
    return this.stripe.payouts.retrieve(id, { stripeAccount: account });
  }
  verify(payload, signature) {
    if (!process.env.STRIPE_WEBHOOK_SECRET)
      throw new HttpError(503, "Webhook secret is not configured.");
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  }
}
export function siteOrigin() {
  const origin = process.env.APP_ORIGIN;
  if (!origin || !/^https:\/\/[^/]+$/.test(origin))
    throw new HttpError(
      503,
      "APP_ORIGIN must be configured as the HTTPS website origin.",
    );
  return origin;
}
export { paymentState };
