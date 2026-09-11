import { transaction } from "../server/db.js";
import { PaymentProviderService } from "../server/payment-provider.js";
import { processEvent } from "../server/webhooks.js";
export const config = { api: { bodyParser: false } };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  try {
    const parts = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) return res.status(413).end();
      parts.push(chunk);
    }
    const provider = new PaymentProviderService();
    let event;
    try {
      event = provider.verify(
        Buffer.concat(parts),
        req.headers["stripe-signature"],
      );
    } catch {
      return res.status(400).json({ error: "Invalid webhook signature" });
    }
    const result = await transaction((db) => processEvent(db, provider, event));
    return res.status(200).json(result);
  } catch (e) {
    console.error("Webhook failed", e.code || e.name);
    return res
      .status(500)
      .json({ error: "Webhook processing failed; retry required." });
  }
}
