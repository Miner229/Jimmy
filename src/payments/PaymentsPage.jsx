import React, { useCallback, useEffect, useState } from 'react';
import { api, formatDateTime, formatMoney } from './api.js';
import { authConfigured, consumeRedirectSession, currentUser, signIn, signOut, signUp } from './auth.js';

const TABS = [
  { key: 'book', label: 'Book' },
  { key: 'bookings', label: 'My bookings' },
  { key: 'host', label: 'Host' },
  { key: 'account', label: 'Account' },
];

const BOOKING_STATUS = {
  reserved: { label: 'Awaiting payment', tone: 'warn' },
  confirmed: { label: 'Confirmed', tone: 'accent' },
  expired: { label: 'Expired', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  refund_pending: { label: 'Refund in progress', tone: 'warn' },
  cancelled_refunded: { label: 'Refunded', tone: 'neutral' },
  late_paid: { label: 'Paid after seat was released: refund in progress', tone: 'warn' },
  late_paid_refunded: { label: 'Paid late: refunded', tone: 'neutral' },
};

const PAYMENT_STATE = {
  NOT_STARTED: ['Payments not set up', 'neutral'],
  ONBOARDING: ['Stripe setup in progress', 'warn'],
  REQUIREMENTS_PENDING: ['Stripe is verifying your details', 'warn'],
  ADDITIONAL_VERIFICATION_REQUIRED: ['Stripe needs more information', 'warn'],
  VERIFIED: ['Verified', 'neutral'],
  RESTRICTED: ['Restricted by Stripe', 'error'],
  DISABLED: ['Disconnected from JimmiPlay', 'error'],
  PAYOUTS_PAUSED: ['Payments on, payouts paused', 'warn'],
  PAYOUTS_ENABLED: ['Payments and payouts enabled', 'ok'],
};

const ENTITY_TYPE = { individual: 'Individual / sole trader', company: 'Registered company', organisation: 'Club / organisation' };

const REFUND_STATUS = {
  requested: 'Requested', pending: 'Pending', requires_action: 'Action required', succeeded: 'Succeeded',
  failed: 'Failed', canceled: 'Cancelled',
};

function Badge({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-stone-100 text-stone-600', accent: 'bg-yellow-100 text-yellow-800',
    warn: 'bg-amber-50 text-amber-700', error: 'bg-red-50 text-red-700', ok: 'bg-emerald-50 text-emerald-700',
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function Button({ children, variant = 'primary', className = '', ...props }) {
  const styles = {
    primary: 'bg-stone-900 text-white hover:bg-stone-800',
    accent: 'bg-yellow-400 text-stone-900 hover:bg-yellow-300',
    outline: 'border border-stone-300 text-stone-900 hover:bg-stone-50',
    danger: 'border border-red-200 text-red-700 hover:bg-red-50',
  };
  return (
    <button className={`inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-40 ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

function Card({ children, className = '' }) {
  return <div className={`rounded-xl border border-stone-200 bg-white p-4 ${className}`}>{children}</div>;
}

function Notice({ tone = 'info', children }) {
  const tones = { info: 'border-stone-200 bg-stone-50 text-stone-700', error: 'border-red-200 bg-red-50 text-red-700', ok: 'border-emerald-200 bg-emerald-50 text-emerald-800' };
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-lg border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-stone-700">{label}</span>
      {children}
    </label>
  );
}

const inputClass = 'w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-stone-900 focus:outline-none';

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

function cleanQuery(keys) {
  const url = new URL(window.location.href);
  keys.forEach((k) => url.searchParams.delete(k));
  window.history.replaceState(window.history.state, '', url.pathname + url.search);
}

/* ---------------------------------------------------------------
   Account
---------------------------------------------------------------- */
function AccountPanel({ user, setUser }) {
  const [mode, setMode] = useState('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [info, setInfo] = useState('');
  const { busy, error, run } = useAction();

  if (!authConfigured) {
    return <Notice tone="error">Sign-in is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.</Notice>;
  }
  if (user) {
    return (
      <Card className="mt-5">
        <p className="text-sm text-stone-500">Signed in as</p>
        <p className="font-medium text-stone-900">{user.email}</p>
        <Button variant="outline" className="mt-4" onClick={async () => { await signOut(); setUser(null); }}>Sign out</Button>
      </Card>
    );
  }
  const submit = (e) => {
    e.preventDefault();
    setInfo('');
    run(async () => {
      const session = mode === 'signin' ? await signIn(email, password) : await signUp(email, password, fullName.trim());
      if (session) setUser(session.user);
      else setInfo('Check your email to confirm your account, then sign in.');
    });
  };
  return (
    <Card className="mt-5">
      <h2 className="text-base font-semibold text-stone-900">{mode === 'signin' ? 'Sign in' : 'Create an account'}</h2>
      <form onSubmit={submit} className="mt-4 space-y-3">
        {mode === 'signup' && (
          <Field label="Full name"><input className={inputClass} autoComplete="name" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} /></Field>
        )}
        <Field label="Email"><input className={inputClass} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password"><input className={inputClass} type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <Button type="submit" disabled={busy} className="w-full">{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
      </form>
      <button className="mt-3 text-sm text-stone-500 hover:text-stone-900" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
        {mode === 'signin' ? 'New to JimmiPlay? Create an account' : 'Already have an account? Sign in'}
      </button>
      {error && <Notice tone="error">{error}</Notice>}
      {info && <Notice>{info}</Notice>}
    </Card>
  );
}

function SignInPrompt({ setTab, what }) {
  return (
    <Card className="mt-5 text-center">
      <p className="text-sm text-stone-600">Sign in to {what}.</p>
      <Button className="mt-3" onClick={() => setTab('account')}>Sign in</Button>
    </Card>
  );
}

/* ---------------------------------------------------------------
   Book
---------------------------------------------------------------- */
function BookPanel({ user, setTab, notice }) {
  const [sessions, setSessions] = useState(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    run(async () => setSessions((await api('sessions')).sessions));
  }, [run]);

  const book = (sessionId) => run(async () => {
    const { url } = await api('checkout', { method: 'POST', body: { session_id: sessionId } });
    window.location.assign(url);
  });

  return (
    <div>
      {notice}
      {error && <Notice tone="error">{error}</Notice>}
      {sessions === null && !error && <p className="mt-6 text-sm text-stone-500">Loading sessions…</p>}
      {sessions?.length === 0 && <p className="mt-6 text-sm text-stone-500">No paid sessions are open for booking yet.</p>}
      <div className="mt-5 space-y-3">
        {sessions?.map((s) => (
          <Card key={s.id} className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-stone-900">{s.title}</p>
              <p className="text-sm text-stone-500">{formatDateTime(s.starts_at)} · {s.venue}</p>
              <p className="text-xs text-stone-400">Hosted by {s.host_name} · Full refund up to {s.refund_deadline_hours} h before the start</p>
            </div>
            <div className="flex items-center gap-3 sm:flex-col sm:items-end">
              <p className="text-lg font-semibold tabular-nums">{formatMoney(s.price_minor, s.currency)}</p>
              <p className="text-xs text-stone-500">{s.seats_left > 0 ? `${s.seats_left} of ${s.capacity} places left` : 'Full'}</p>
              {user ? (
                <Button variant="accent" disabled={busy || s.seats_left <= 0 || !s.host_can_accept_payments} onClick={() => book(s.id)}>Book and pay</Button>
              ) : (
                <Button variant="outline" onClick={() => setTab('account')}>Sign in to book</Button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   My bookings
---------------------------------------------------------------- */
function BookingsPanel({ user, setTab }) {
  const [bookings, setBookings] = useState(null);
  const [message, setMessage] = useState(null);
  const [confirming, setConfirming] = useState(null);
  const { busy, error, run } = useAction();

  const load = useCallback(() => run(async () => setBookings((await api('bookings')).bookings)), [run]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const checkoutSession = params.get('session_id');
    if (params.get('checkout') === 'success' && checkoutSession) {
      run(async () => {
        const out = await api('checkout/return', { query: { session_id: checkoutSession } });
        const texts = {
          confirmed: ['ok', 'Payment received. Your place is confirmed.'],
          already_confirmed: ['ok', 'Payment received. Your place is confirmed.'],
          processing: ['info', 'Your payment is processing. We will confirm your place when it completes.'],
          refund_required: ['error', 'Your payment arrived after the place was released and the session is now full. A full refund has been started.'],
        };
        const [tone, text] = texts[out.result] || ['info', 'We are checking your payment. Refresh in a moment.'];
        setMessage(<Notice tone={tone}>{text}</Notice>);
        cleanQuery(['checkout', 'session_id']);
      }).finally(load);
    } else {
      load();
    }
  }, [user, run, load]);

  if (!user) return <SignInPrompt setTab={setTab} what="see your bookings" />;

  const cancel = (id) => run(async () => {
    const out = await api('bookings/cancel', { method: 'POST', body: { booking_id: id } });
    setConfirming(null);
    setMessage(<Notice tone={out.retry_scheduled ? 'info' : 'ok'}>{out.retry_scheduled ? 'Your cancellation is saved. The refund will be retried automatically.' : 'Booking cancelled. Your refund has been requested.'}</Notice>);
    await load();
  });

  return (
    <div>
      {message}
      {error && <Notice tone="error">{error}</Notice>}
      {bookings?.length === 0 && <p className="mt-6 text-sm text-stone-500">You have no paid bookings yet.</p>}
      <div className="mt-5 space-y-3">
        {bookings?.map((b) => {
          const status = BOOKING_STATUS[b.status] || { label: b.status, tone: 'neutral' };
          const canCancel = b.status === 'confirmed' && new Date(b.refund_deadline) > new Date();
          return (
            <Card key={b.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">{b.title}</p>
                  <p className="text-sm text-stone-500">{formatDateTime(b.starts_at)} · {b.venue}</p>
                  <p className="text-xs text-stone-400">{b.host_name} · {formatMoney(b.amount_minor, b.currency || 'gbp')}</p>
                </div>
                <Badge tone={status.tone}>{status.label}</Badge>
              </div>
              {b.refunds?.length > 0 && (
                <ul className="mt-3 space-y-1 border-t border-stone-100 pt-3 text-xs text-stone-600">
                  {b.refunds.map((r, i) => (
                    <li key={i}>
                      Refund {formatMoney(r.amount_minor)}: {REFUND_STATUS[r.status] || r.status}
                      {r.origin === 'stripe_dashboard' ? ' (made by the host)' : ''}
                      {r.failure_reason ? ` · ${r.failure_reason}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex flex-wrap gap-2">
                {b.status === 'reserved' && b.checkout_url && b.payment_status === 'open' && (
                  <Button variant="accent" onClick={() => window.location.assign(b.checkout_url)}>Continue to payment</Button>
                )}
                {canCancel && confirming !== b.id && (
                  <Button variant="outline" onClick={() => setConfirming(b.id)}>Cancel and refund</Button>
                )}
                {canCancel && confirming === b.id && (
                  <>
                    <Button variant="danger" disabled={busy} onClick={() => cancel(b.id)}>Confirm cancellation</Button>
                    <Button variant="outline" onClick={() => setConfirming(null)}>Keep my place</Button>
                  </>
                )}
                {b.status === 'confirmed' && !canCancel && (
                  <p className="text-xs text-stone-400">The refund deadline ({formatDateTime(b.refund_deadline)}) has passed.</p>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   Host
---------------------------------------------------------------- */
function HostStatus({ status }) {
  if (!status?.account) return null;
  const a = status.account;
  const due = [...a.past_due, ...a.currently_due];
  return (
    <div className="mt-3 space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <Badge tone={a.charges_enabled ? 'ok' : 'warn'}>{a.charges_enabled ? 'Can take payments' : 'Payments not enabled'}</Badge>
        <Badge tone={a.payouts_enabled ? 'ok' : 'warn'}>{a.payouts_enabled ? 'Payouts enabled' : 'Payouts not enabled'}</Badge>
        {a.details_submitted && <Badge>Details submitted</Badge>}
      </div>
      {due.length > 0 && <p className="text-amber-700">Stripe still needs: {due.join(', ')}</p>}
      {a.pending_verification.length > 0 && <p className="text-stone-500">Stripe is verifying: {a.pending_verification.join(', ')}</p>}
      {a.disabled_reason && <p className="text-red-700">Restriction: {a.disabled_reason}</p>}
      {status.balance && (
        <p className="text-stone-600">
          Stripe balance: {formatMoney(status.balance.available_minor)} available · {formatMoney(status.balance.pending_minor)} pending
        </p>
      )}
      {a.payout_schedule && (
        <p className="text-xs text-stone-500">
          Payouts to your bank follow your Stripe schedule ({a.payout_schedule.interval}{a.payout_schedule.delay_days ? `, ${a.payout_schedule.delay_days}-day delay` : ''}). Manage them, refunds and disputes in your <a className="underline" href="https://dashboard.stripe.com/" target="_blank" rel="noreferrer">Stripe Dashboard</a>.
        </p>
      )}
    </div>
  );
}

function NewSessionForm({ hostId, onCreated }) {
  const [form, setForm] = useState({ title: '', venue: '', date: '', start: '19:00', end: '21:00', capacity: 12, price: '10.00', deadline: 24 });
  const { busy, error, run } = useAction();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const pence = Math.round(Number.parseFloat(form.price) * 100);
      await api('sessions', {
        method: 'POST',
        body: {
          host_id: hostId, title: form.title, venue: form.venue,
          starts_at: new Date(`${form.date}T${form.start}`).toISOString(),
          ends_at: new Date(`${form.date}T${form.end}`).toISOString(),
          capacity: Number(form.capacity), price_minor: pence, refund_deadline_hours: Number(form.deadline), publish: true,
        },
      });
      onCreated();
    });
  };
  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-stone-100 pt-4 sm:grid-cols-2">
      <Field label="Session title"><input className={inputClass} required maxLength={200} value={form.title} onChange={set('title')} /></Field>
      <Field label="Venue"><input className={inputClass} required maxLength={300} value={form.venue} onChange={set('venue')} /></Field>
      <Field label="Date"><input className={inputClass} type="date" required value={form.date} onChange={set('date')} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start"><input className={inputClass} type="time" required value={form.start} onChange={set('start')} /></Field>
        <Field label="End"><input className={inputClass} type="time" required value={form.end} onChange={set('end')} /></Field>
      </div>
      <Field label="Places"><input className={inputClass} type="number" min={1} max={1000} required value={form.capacity} onChange={set('capacity')} /></Field>
      <Field label="Price per player (£)"><input className={inputClass} type="number" min="0.30" step="0.01" required value={form.price} onChange={set('price')} /></Field>
      <Field label="Full refund until (hours before start)"><input className={inputClass} type="number" min={0} max={720} required value={form.deadline} onChange={set('deadline')} /></Field>
      <div className="flex items-end"><Button type="submit" disabled={busy} className="w-full">Publish session</Button></div>
      {error && <div className="sm:col-span-2"><Notice tone="error">{error}</Notice></div>}
      <p className="text-xs text-stone-500 sm:col-span-2">Players pay the listed price. JimmiPlay keeps a 1% platform fee (rounded to the nearest penny); Stripe's processing fees are charged to your Stripe account.</p>
    </form>
  );
}

function HostCard({ host, statusById, refreshStatus, reload }) {
  const [showForm, setShowForm] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const { busy, error, run } = useAction();
  const continueOnboarding = () => run(async () => {
    const { url } = await api('host/onboard', { method: 'POST', body: { host_id: host.id } });
    window.location.assign(url);
  });
  const cancelSession = (sessionId) => run(async () => {
    await api('sessions/cancel', { method: 'POST', body: { session_id: sessionId } });
    setConfirmCancel(null);
    await reload();
  });
  return (
    <Card className="mt-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-stone-900">{host.display_name}</p>
          <p className="text-xs text-stone-500">
            {host.host_type === 'club' ? 'Club' : 'Individual organiser'}
            {host.payment_entity_type ? ` · ${ENTITY_TYPE[host.payment_entity_type]}` : ''}
          </p>
          {host.payment_state && (
            <div className="mt-1"><Badge tone={(PAYMENT_STATE[host.payment_state] || [])[1]}>{(PAYMENT_STATE[host.payment_state] || [host.payment_state])[0]}</Badge></div>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" disabled={busy} onClick={() => run(() => refreshStatus(host.id))}>Refresh status</Button>
          {!host.charges_enabled && <Button variant="accent" disabled={busy} onClick={continueOnboarding}>{host.stripe_account_id ? 'Continue Stripe setup' : 'Set up payments'}</Button>}
        </div>
      </div>
      <HostStatus status={statusById[host.id]} />
      {!statusById[host.id] && host.stripe_account_id && (
        <p className="mt-2 text-xs text-stone-500">{host.charges_enabled ? 'Ready to take payments.' : 'Stripe setup is not finished yet.'}</p>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {host.sessions?.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-stone-100 pt-4">
          {host.sessions.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">{s.title} <span className="text-xs font-normal text-stone-400">· {s.status}</span></p>
                <p className="text-xs text-stone-500">
                  {formatDateTime(s.starts_at)} · {s.confirmed}/{s.capacity} booked{s.reserved > 0 ? `, ${s.reserved} paying now` : ''} ·
                  {' '}paid {formatMoney(s.gross_minor)} · JimmiPlay fee {formatMoney(s.fees_minor)} · refunded {formatMoney(s.refunded_minor)}
                  {s.open_disputes > 0 ? ` · ${s.open_disputes} open dispute(s): respond in Stripe` : ''}
                </p>
              </div>
              {s.status !== 'cancelled' && confirmCancel !== s.id && <Button variant="outline" onClick={() => setConfirmCancel(s.id)}>Cancel session</Button>}
              {confirmCancel === s.id && (
                <div className="flex gap-2">
                  <Button variant="danger" disabled={busy} onClick={() => cancelSession(s.id)}>Cancel and refund everyone</Button>
                  <Button variant="outline" onClick={() => setConfirmCancel(null)}>Keep</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {host.charges_enabled && !showForm && <Button className="mt-4" onClick={() => setShowForm(true)}>New paid session</Button>}
      {showForm && <NewSessionForm hostId={host.id} onCreated={async () => { setShowForm(false); await reload(); }} />}
    </Card>
  );
}

function HostPanel({ user, setTab }) {
  const [hosts, setHosts] = useState(null);
  const [statusById, setStatusById] = useState({});
  const [form, setForm] = useState({ display_name: '', host_type: 'club', payment_entity_type: 'organisation' });
  const [message, setMessage] = useState(null);
  const { busy, error, run } = useAction();

  const reload = useCallback(async () => setHosts((await api('host/overview')).hosts), []);
  const refreshStatus = useCallback(async (hostId) => {
    const status = await api('host/status', { query: { host_id: hostId } });
    setStatusById((m) => ({ ...m, [hostId]: status }));
    await reload();
    return status;
  }, [reload]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const step = params.get('onboarding');
    const hostId = params.get('host');
    run(async () => {
      if (step === 'refresh' && hostId) {
        // The Account Link expired or was already used: create a new one and continue.
        const { url } = await api('host/onboard', { method: 'POST', body: { host_id: hostId } });
        window.location.assign(url);
        return;
      }
      await reload();
      if (step === 'return' && hostId) {
        const status = await refreshStatus(hostId);
        setMessage(<Notice tone={status.account?.charges_enabled ? 'ok' : 'info'}>{status.account?.charges_enabled ? 'Stripe setup complete. You can publish paid sessions.' : 'Stripe has saved your progress. Finish the remaining items to take payments.'}</Notice>);
        cleanQuery(['onboarding', 'host']);
      }
    });
  }, [user, run, reload, refreshStatus]);

  if (!user) return <SignInPrompt setTab={setTab} what="host paid sessions" />;

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const { url } = await api('host/onboard', { method: 'POST', body: form });
      window.location.assign(url);
    });
  };

  return (
    <div>
      {message}
      {error && <Notice tone="error">{error}</Notice>}
      {hosts?.map((h) => <HostCard key={h.id} host={h} statusById={statusById} refreshStatus={refreshStatus} reload={reload} />)}
      <Card className="mt-4">
        <h2 className="text-base font-semibold text-stone-900">Get paid with Stripe</h2>
        <p className="mt-1 text-sm text-stone-500">Hosts get their own Stripe account. Stripe verifies your identity or business, and pays out to your bank.</p>
        <form onSubmit={create} className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Club or organiser name"><input className={inputClass} required maxLength={120} value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Host type">
            <select className={inputClass} value={form.host_type} onChange={(e) => setForm({ ...form, host_type: e.target.value })}>
              <option value="club">Club</option>
              <option value="individual">Individual organiser</option>
            </select>
          </Field>
          <Field label="How is it operated?">
            <select className={inputClass} value={form.payment_entity_type} onChange={(e) => setForm({ ...form, payment_entity_type: e.target.value })}>
              {Object.entries(ENTITY_TYPE).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Button type="submit" disabled={busy} variant="accent" className="w-full">Continue to Stripe</Button></div>
          <p className="text-xs text-stone-500 sm:col-span-2">Stripe asks for the details it needs for this type and verifies them. An informal group is set up with one person as the account representative.</p>
        </form>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------
   Page
---------------------------------------------------------------- */
export default function PaymentsPage() {
  const initial = new URLSearchParams(window.location.search).get('tab');
  const [tab, setTabState] = useState(TABS.some((t) => t.key === initial) ? initial : 'book');
  const [user, setUser] = useState(() => currentUser());
  const [bookNotice] = useState(() =>
    new URLSearchParams(window.location.search).get('checkout') === 'cancelled'
      ? <Notice>Payment cancelled. Your place is held for a short time if you want to try again.</Notice>
      : null);

  useEffect(() => {
    const session = consumeRedirectSession();
    if (session) setUser(session.user);
    if (new URLSearchParams(window.location.search).get('checkout') === 'cancelled') cleanQuery(['checkout']);
  }, []);

  const setTab = (key) => {
    setTabState(key);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', key);
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-stone-900">Payments</h1>
        <Badge tone="warn">Test mode</Badge>
      </div>
      <p className="mt-1 text-sm text-stone-500">Book paid sessions, manage refunds and set up hosting. No real money moves in test mode.</p>
      <div role="tablist" className="mt-5 flex gap-1 overflow-x-auto rounded-lg bg-stone-100 p-1">
        {TABS.map((t) => (
          <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
            className={`flex-1 whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium ${tab === t.key ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-500 hover:text-stone-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'book' && <BookPanel user={user} setTab={setTab} notice={bookNotice} />}
      {tab === 'bookings' && <BookingsPanel user={user} setTab={setTab} />}
      {tab === 'host' && <HostPanel user={user} setTab={setTab} />}
      {tab === 'account' && <AccountPanel user={user} setUser={setUser} />}
    </main>
  );
}
