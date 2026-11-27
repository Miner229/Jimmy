// All /api/payments/* routes (see vercel.json rewrites and server/payments/router.js).
import { handlePaymentsRequest } from '../server/payments/router.js';

export default {
  fetch(request) {
    return handlePaymentsRequest(request);
  },
};
