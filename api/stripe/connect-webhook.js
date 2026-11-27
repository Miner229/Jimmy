// Stripe Connect webhook endpoint ("events on connected accounts").
// Uses the Web-standard Request so the raw body is available for signature verification.
import { handleConnectWebhook } from '../../server/payments/webhook-handler.js';

export default {
  fetch(request) {
    return handleConnectWebhook(request);
  },
};
