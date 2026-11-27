// Connect webhook endpoint logic: verify the signature on the raw body, then hand the
// event to the payments service. A non-2xx response makes Stripe retry the delivery.

import { buildDependencies, errorResponse, json } from './router.js';
import { SignatureError, verifyStripeSignature } from './webhook-signature.js';

export async function handleConnectWebhook(request, deps) {
  if (request.method.toUpperCase() !== 'POST') return json(405, { error: 'Method not allowed' });
  try {
    const { config, service } = deps || buildDependencies();
    const payload = await request.text();
    if (payload.length > 1024 * 1024) return json(413, { error: 'Payload too large' });

    let event;
    try {
      event = verifyStripeSignature(payload, request.headers.get('stripe-signature'), config.webhookSecret);
    } catch (error) {
      if (error instanceof SignatureError) return json(400, { error: 'Invalid signature' });
      throw error;
    }
    const result = await service.handleEvent(event);
    return json(200, { received: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
