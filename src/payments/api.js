import { getAccessToken } from './auth.js';

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(route, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken();
  const search = query ? `?${new URLSearchParams(query)}` : '';
  const response = await fetch(`/api/payments/${route}${search}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, data.code, data.error || 'Something went wrong.');
  return data;
}

export const formatMoney = (minor, currency = 'gbp') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase() }).format((minor || 0) / 100);

export const formatDateTime = (iso) =>
  iso ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '';
