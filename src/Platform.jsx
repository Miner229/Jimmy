import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";
import { createClient } from "@supabase/supabase-js";
const url = import.meta.env?.VITE_SUPABASE_URL,
  key = import.meta.env?.VITE_SUPABASE_ANON_KEY;
export const auth = url && key ? createClient(url, key) : null;
const Context = createContext({
  user: null,
  memberships: [],
  catalog: { sessions: [], clubs: [] },
  bookings: [],
  refresh: async () => {},
});
export const usePlatform = () => useContext(Context);
export async function api(action, body) {
  const session = auth ? (await auth.auth.getSession()).data.session : null;
  const query = body === undefined ? "" : null;
  const response = await fetch(`/api/platform/${action}`, {
    method: query === null ? "POST" : "GET",
    headers: {
      ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
      ...(query === null ? { "Content-Type": "application/json" } : {}),
    },
    ...(query === null ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "The service is not available yet." }));
  if (!response.ok) {
    const error = new Error(data.error || "Unable to complete this action.");
    error.code = data.code;
    throw error;
  }
  return data;
}
export function PlatformProvider({ children }) {
  const [user, setUser] = useState(null),
    [memberships, setMemberships] = useState([]),
    [catalog, setCatalog] = useState({ clubs: [], sessions: [] }),
    [bookings, setBookings] = useState([]),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const session = auth ? (await auth.auth.getSession()).data.session : null;
      if (session) {
        const me = await api("me");
        setUser(me.user);
        setMemberships(me.memberships);
        if (me.user.email_verified_at)
          setBookings((await api("bookings")).bookings);
      } else {
        setUser(null);
        setMemberships([]);
        setBookings([]);
      }
      setError("");
    } catch (e) {
      setUser(null);
      setMemberships([]);
      setBookings([]);
      setError(e.message);
    }
    try {
      setCatalog(await api("catalog"));
    } catch {
      /* Keep the existing demo catalogue available when services are not configured. */
    }
  }, []);
  useEffect(() => {
    refresh();
    const sub = auth?.auth.onAuthStateChange(() => setTimeout(refresh, 0));
    return () => sub?.data.subscription.unsubscribe();
  }, [refresh]);
  return (
    <Context.Provider
      value={{ user, memberships, catalog, bookings, refresh, error }}
    >
      {children}
    </Context.Provider>
  );
}
export function AuthPanel({ onClose }) {
  const { user, refresh } = usePlatform();
  const [mode, setMode] = useState(
      new URLSearchParams(window.location.search).has("reset")
        ? "new-password"
        : "login",
    ),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const sub = auth?.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("new-password");
    });
    return () => sub?.data.subscription.unsubscribe();
  }, []);
  async function run(fn) {
    setBusy(true);
    setMessage("");
    try {
      if (!auth) throw Error("Account services are not configured yet.");
      const r = await fn();
      if (r?.error) throw r.error;
      await refresh();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.currentTarget));
    run(async () => {
      let r;
      if (mode === "register") {
        r = await auth.auth.signUp({
          email: d.email,
          password: d.password,
          options: {
            data: { full_name: d.full_name },
            emailRedirectTo: window.location.origin + "/?verified=1",
          },
        });
        if (!r.error) setMessage("Check your email for the verification link.");
      } else if (mode === "reset") {
        r = await auth.auth.resetPasswordForEmail(d.email, {
          redirectTo: window.location.origin + "/?reset=1",
        });
        if (!r.error)
          setMessage(
            "If this email is registered, a reset link has been sent.",
          );
      } else if (mode === "new-password") {
        r = await auth.auth.updateUser({ password: d.password });
        if (!r.error) {
          setMessage("Password updated.");
          setMode("login");
        }
      } else if (mode === "change-email") {
        r = await auth.auth.updateUser({ email: d.email });
        if (!r.error)
          setMessage("Check your email to confirm the new address.");
      } else
        r = await auth.auth.signInWithPassword({
          email: d.email,
          password: d.password,
        });
      return r;
    });
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-900/50 p-4">
      <div className="workspace-card mx-auto my-8 max-w-md">
        <header className="flex justify-between">
          <h2>
            {user
              ? "Your account"
              : mode === "register"
                ? "Create Account"
                : mode === "reset"
                  ? "Reset password"
                  : "Sign in"}
          </h2>
          <button onClick={onClose} aria-label="Close account">
            ✕
          </button>
        </header>
        {user && (
          <>
            <p className="mt-4">
              {user.full_name} · {user.email}
            </p>
            <p className="creation-note">
              {user.email_verified_at
                ? "Email verified"
                : "Please verify your email address to continue."}
            </p>
            {!user.email_verified_at && (
              <button
                className="workspace-button"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const r = await auth.auth.resend({
                      type: "signup",
                      email: user.email,
                      options: {
                        emailRedirectTo:
                          window.location.origin + "/?verified=1",
                      },
                    });
                    if (!r.error) setMessage("Verification email sent.");
                    return r;
                  })
                }
              >
                Resend verification email
              </button>
            )}
            <button
              className="workspace-button"
              onClick={() => setMode("change-email")}
            >
              Change email address
            </button>
            <button
              className="workspace-button"
              onClick={() => run(() => auth.auth.signOut())}
            >
              Log out
            </button>
          </>
        )}
        {(!user || ["change-email", "new-password"].includes(mode)) && (
          <form className="workspace-form" onSubmit={submit}>
            {mode === "register" && (
              <label>
                Full name
                <input
                  name="full_name"
                  required
                  maxLength={120}
                  autoComplete="name"
                />
              </label>
            )}
            {mode !== "new-password" && (
              <label>
                Email address
                <input
                  name="email"
                  required
                  type="email"
                  autoComplete="email"
                />
              </label>
            )}
            {!["reset", "change-email"].includes(mode) && (
              <label>
                Password
                <input
                  name="password"
                  required
                  type="password"
                  minLength={12}
                  autoComplete={
                    mode === "register" || mode === "new-password"
                      ? "new-password"
                      : "current-password"
                  }
                />
              </label>
            )}
            <button className="creation-primary" disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "register"
                  ? "Create Account"
                  : mode === "login"
                    ? "Sign in"
                    : "Continue"}
            </button>
          </form>
        )}
        {!user && (
          <div className="flex flex-wrap gap-4 mt-4 text-sm">
            <button
              onClick={() =>
                setMode(mode === "register" ? "login" : "register")
              }
            >
              {mode === "register" ? "Sign in instead" : "Create account"}
            </button>
            <button onClick={() => setMode("reset")}>Forgot password?</button>
          </div>
        )}
        {message && (
          <p className="creation-note" role="status">
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
export function VerifiedGate({ children, onAuth }) {
  const { user } = usePlatform();
  if (!user?.email_verified_at)
    return (
      <div className="workspace-card mx-auto max-w-xl my-8">
        <p>
          {user
            ? "Please verify your email address to continue."
            : "Sign in to create or manage your Club."}
        </p>
        <button className="creation-primary mt-4 px-6" onClick={onAuth}>
          {user ? "Verify email / resend link" : "Sign in / Create Account"}
        </button>
      </div>
    );
  return children;
}
export function ClubDashboard({ clubId, onSelect, onCreate, onSession }) {
  const { memberships, refresh } = usePlatform();
  const [data, setData] = useState(null),
    [finance, setFinance] = useState(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState("Sessions"),
    [participants, setParticipants] = useState(null),
    [participantSession, setParticipantSession] = useState(null);
  const selected = clubId || memberships[0]?.club_id;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const load = useCallback(async () => {
    if (!selected) return;
    try {
      const result = await api(`dashboard?club_id=${selected}`);
      if (selectedRef.current === selected) setData(result);
    } catch (e) {
      setMessage(e.message);
    }
  }, [selected]);
  useEffect(() => {
    setData(null);
    setFinance(null);
    setParticipants(null);
    setTab("Sessions");
    load();
  }, [load]);
  async function run(fn) {
    setBusy(true);
    setMessage("");
    try {
      await fn();
      await refresh();
      await load();
    } catch (e) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function showFinance() {
    setTab("Finance");
    setMessage("");
    try {
      const result = await api(`finance?club_id=${selected}`);
      if (selectedRef.current === selected) setFinance(result);
    } catch (e) {
      setMessage(e.message);
    }
  }
  const role = data?.role;
  return (
    <main className="mx-auto max-w-4xl px-4 py-6">
      <header className="flex flex-wrap gap-4 items-center justify-between">
        <h1 className="text-xl font-semibold">Club dashboard</h1>
        <button className="creation-primary px-5 flex-none" onClick={onCreate}>
          Create Club
        </button>
      </header>
      <select
        className="workspace-select my-5"
        value={selected || ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        <option value="" disabled>
          Select Club
        </option>
        {memberships.map((m) => (
          <option key={m.id} value={m.club_id}>
            {m.name} · {m.role}
          </option>
        ))}
      </select>
      {!memberships.length && (
        <p className="workspace-card">
          Create your first Club with just its name, sport and main area. No
          payment verification is needed.
        </p>
      )}
      {data && (
        <>
          <div className="workspace-card">
            <h2>{data.club.name}</h2>
            <p>
              {role} · {data.club.main_area}
            </p>
            <div className="flex gap-3 mt-4">
              {[
                "Sessions",
                ...(role === "Organizer"
                  ? []
                  : ["Team", "Finance", "Settings"]),
              ].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "text-yellow-700 font-semibold" : ""}
                  onClick={() => (t === "Finance" ? showFinance() : setTab(t))}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {tab === "Sessions" && (
            <div className="workspace-card mt-4">
              <button
                className="creation-primary px-5"
                onClick={() => onSession(selected)}
              >
                Create Session
              </button>
              {data.sessions.map((s) => (
                <div className="workspace-list" key={s.id}>
                  <div>
                    <strong>{s.title}</strong>
                    <p>
                      {s.status} · £{(s.price / 100).toFixed(2)} ·{" "}
                      {new Date(s.starts_at).toLocaleString()}
                    </p>
                  </div>
                  <div>
                    {s.status === "draft" && (
                      <button
                        className="workspace-button"
                        disabled={busy}
                        onClick={() => onSession(selected, s)}
                      >
                        Edit draft
                      </button>
                    )}
                    <button
                      className="workspace-button"
                      onClick={() =>
                        run(async () => {
                          setParticipantSession(s.id);
                          setParticipants(
                            (await api("participants", { session_id: s.id }))
                              .participants,
                          );
                        })
                      }
                    >
                      Participants
                    </button>
                    <button
                      className="workspace-button"
                      onClick={() => {
                        const message = window.prompt(
                          "Email confirmed participants",
                        );
                        if (message)
                          run(async () => {
                            const result = await api("message-participants", {
                              session_id: s.id,
                              message,
                            });
                            setMessage(result.message);
                          });
                      }}
                    >
                      Message participants
                    </button>
                    {s.status === "published" && (
                      <button
                        className="workspace-button"
                        onClick={() => {
                          const description = window.prompt(
                            "Update Session description",
                            s.details?.description || "",
                          );
                          if (description)
                            run(() =>
                              api("edit-session-details", {
                                session_id: s.id,
                                description,
                              }),
                            );
                        }}
                      >
                        Edit description
                      </button>
                    )}
                    {role !== "Organizer" &&
                      ["published", "cancelled"].includes(s.status) && (
                        <button
                          className="workspace-button"
                          onClick={() => {
                            if (
                              window.confirm(
                                "Cancel this Session and refund all confirmed bookings?",
                              )
                            )
                              run(async () => {
                                const r = await api("cancel-session", {
                                  session_id: s.id,
                                });
                                setMessage(r.message);
                              });
                          }}
                        >
                          {s.status === "cancelled"
                            ? "Retry cancellation refunds"
                            : "Cancel Session"}
                        </button>
                      )}
                    {role === "Owner" && s.status === "draft" && (
                      <button
                        className="workspace-button"
                        onClick={() =>
                          run(() => api("delete-session", { session_id: s.id }))
                        }
                      >
                        Delete draft
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {participants && (
                <div className="creation-note">
                  {participants.length
                    ? participants.map((p) => (
                        <p key={p.id}>
                          {p.full_name} · {p.status}{" "}
                          {p.status === "confirmed" && (
                            <label>
                              <input
                                type="checkbox"
                                checked={p.attended}
                                onChange={(e) => {
                                  const attended = e.target.checked;
                                  run(async () => {
                                    await api("attendance", {
                                      session_id: participantSession,
                                      booking_id: p.id,
                                      attended,
                                    });
                                    setParticipants((list) =>
                                      list.map((x) =>
                                        x.id === p.id ? { ...x, attended } : x,
                                      ),
                                    );
                                  });
                                }}
                              />{" "}
                              Attended
                            </label>
                          )}
                        </p>
                      ))
                    : "No participants yet."}
                </div>
              )}
            </div>
          )}
          {tab === "Team" && (
            <div className="workspace-card mt-4">
              <form
                className="workspace-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const d = Object.fromEntries(new FormData(e.currentTarget));
                  run(async () => {
                    const r = await api("invite", { club_id: selected, ...d });
                    setMessage(r.message);
                  });
                }}
              >
                <label>
                  Invite by email
                  <input type="email" name="email" required />
                </label>
                <label>
                  Role
                  <select name="role">
                    {role === "Owner" && <option>Admin</option>}
                    <option>Organizer</option>
                  </select>
                </label>
                <button disabled={busy} className="creation-primary">
                  Send invitation
                </button>
              </form>
              {data.members.map((m) => (
                <div className="workspace-list" key={m.id}>
                  <span>
                    {m.full_name} · {m.role} · {m.status}
                  </span>
                  {role === "Owner" &&
                    m.role !== "Owner" &&
                    m.status === "active" && (
                      <div>
                        <button
                          className="workspace-button"
                          onClick={() =>
                            run(() =>
                              api("members", {
                                club_id: selected,
                                id: m.id,
                                action: "role",
                                role:
                                  m.role === "Admin" ? "Organizer" : "Admin",
                              }),
                            )
                          }
                        >
                          Make {m.role === "Admin" ? "Organizer" : "Admin"}
                        </button>
                        <button
                          className="workspace-button"
                          onClick={() =>
                            run(() =>
                              api("members", {
                                club_id: selected,
                                id: m.id,
                                action: "remove",
                              }),
                            )
                          }
                        >
                          Remove
                        </button>
                        <button
                          className="workspace-button"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Transfer ownership to ${m.full_name}? You will become an Admin.`,
                              )
                            )
                              run(() =>
                                api("members", {
                                  club_id: selected,
                                  id: m.id,
                                  action: "transfer",
                                }),
                              );
                          }}
                        >
                          Transfer ownership
                        </button>
                      </div>
                    )}
                </div>
              ))}
              {data.invitations
                .filter((i) => !i.accepted_at && !i.revoked_at)
                .map((i) => (
                  <div className="workspace-list" key={i.id}>
                    <span>
                      {i.email} · {i.intended_role} · expires{" "}
                      {new Date(i.expires_at).toLocaleDateString()}
                    </span>
                    <button
                      onClick={() =>
                        run(() =>
                          api("revoke-invitation", {
                            club_id: selected,
                            id: i.id,
                          }),
                        )
                      }
                    >
                      Revoke
                    </button>
                  </div>
                ))}
            </div>
          )}
          {tab === "Finance" && (
            <div className="workspace-card mt-4">
              <h2>Club payments</h2>
              <p className="creation-note">
                {finance?.account?.onboarding_status || "NOT_STARTED"}
              </p>
              {finance?.destination && (
                <p>
                  {finance.destination.bank_display_name} ••••
                  {finance.destination.last4}
                </p>
              )}
              {finance?.balance && (
                <p>
                  Available:{" "}
                  {finance.balance.available
                    .filter((x) => x.currency === "gbp")
                    .map((x) => `£${(x.amount / 100).toFixed(2)}`)
                    .join(", ")}{" "}
                  · Pending:{" "}
                  {finance.balance.pending
                    .filter((x) => x.currency === "gbp")
                    .map((x) => `£${(x.amount / 100).toFixed(2)}`)
                    .join(", ")}
                </p>
              )}
              {finance?.changes?.map((c, i) => (
                <p key={i}>
                  Security hold until {new Date(c.hold_until).toLocaleString()}
                </p>
              ))}
              {finance?.risks?.map((r, i) => (
                <p key={i}>Review: {r.signal.replaceAll("_", " ")}</p>
              ))}
              {role === "Owner" && (
                <>
                  <h3 className="mt-5 font-semibold">
                    Start accepting payments
                  </h3>
                  <p className="text-sm text-stone-500">
                    Set up your Club to securely collect player payments.
                    Identity and bank information are collected by Stripe.
                  </p>
                  <form
                    className="workspace-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const d = Object.fromEntries(
                        new FormData(e.currentTarget),
                      );
                      run(async () => {
                        const r = await api("onboarding", {
                          club_id: selected,
                          ...d,
                        });
                        window.location.assign(r.url);
                      });
                    }}
                  >
                    <label>
                      How is this Club operated?
                      <select
                        name="entity"
                        defaultValue={
                          data.club.payment_entity_type || "individual"
                        }
                      >
                        <option value="individual">
                          Individual / Sole Trader
                        </option>
                        <option value="company">Registered Company</option>
                        <option value="organisation">
                          Club / Organisation
                        </option>
                      </select>
                    </label>
                    <label>
                      Organisation subtype (if applicable)
                      <select name="subtype">
                        <option>Sports Club</option>
                        <option>Association / Community Group</option>
                        <option>Charity</option>
                        <option>Other</option>
                      </select>
                    </label>
                    <button disabled={busy} className="creation-primary">
                      Set up payments
                    </button>
                  </form>
                  {finance?.account?.provider_account_id && (
                    <details className="mt-5">
                      <summary>
                        Change payout account / update payment details
                      </summary>
                      <p className="text-sm my-3">
                        Confirm your password. Stripe will collect the updated
                        details; automatic payouts will pause during the
                        security hold.
                      </p>
                      <form
                        className="workspace-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const password = new FormData(e.currentTarget).get(
                            "password",
                          );
                          e.currentTarget.reset();
                          run(async () => {
                            const proof = await api("step-up", {
                              club_id: selected,
                              password,
                            });
                            const r = await api("payout-change", {
                              club_id: selected,
                              step_up_token: proof.token,
                            });
                            window.location.assign(r.url);
                          });
                        }}
                      >
                        <label>
                          Current password
                          <input
                            name="password"
                            type="password"
                            autoComplete="current-password"
                            required
                          />
                        </label>
                        <button disabled={busy} className="creation-primary">
                          Continue securely to Stripe
                        </button>
                      </form>
                    </details>
                  )}
                </>
              )}
              {finance?.transactions.map((t) => (
                <div className="workspace-list" key={t.id}>
                  <span>
                    £{(t.gross_amount / 100).toFixed(2)} · {t.payment_status}
                    <br />
                    Refund: {t.refund_status} · Dispute: {t.dispute_status}
                  </span>
                  {t.payment_status === "succeeded" &&
                    t.refund_status === "none" && (
                      <button
                        disabled={busy}
                        className="workspace-button"
                        onClick={() => {
                          const reason = window.prompt(
                            "Reason for full refund",
                          );
                          if (reason)
                            run(async () => {
                              await api("refund", {
                                booking_id: t.booking_id,
                                reason,
                              });
                              await showFinance();
                            });
                        }}
                      >
                        Full refund
                      </button>
                    )}
                </div>
              ))}
              {finance?.payouts.map((p) => (
                <p className="workspace-list" key={p.provider_payout_id}>
                  Payout £{(p.amount / 100).toFixed(2)} · {p.status}{" "}
                  {p.failure_code}
                </p>
              ))}
            </div>
          )}
          {tab === "Settings" && (
            <div className="workspace-card mt-4">
              <form
                className="workspace-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() =>
                    api("edit-club", {
                      club_id: selected,
                      ...Object.fromEntries(new FormData(e.currentTarget)),
                    }),
                  );
                }}
              >
                <label>
                  Club name
                  <input name="name" required defaultValue={data.club.name} />
                </label>
                <label>
                  Main area
                  <input
                    name="main_area"
                    required
                    defaultValue={data.club.main_area}
                  />
                </label>
                <button className="creation-primary" disabled={busy}>
                  Save Club profile
                </button>
              </form>
              {role === "Owner" && (
                <button
                  className="workspace-button mt-5"
                  onClick={() => {
                    if (window.confirm("Archive this Club?"))
                      run(() => api("archive", { club_id: selected }));
                  }}
                >
                  Archive Club
                </button>
              )}
            </div>
          )}
        </>
      )}
      {message && (
        <p className="creation-note" role="status">
          {message}
        </p>
      )}
    </main>
  );
}
export function InvitationPage({ onAccepted }) {
  const { refresh } = usePlatform();
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="workspace-card max-w-xl mx-auto my-8">
      <h1>Club invitation</h1>
      <p className="my-4">
        Accept using the verified email address that received the invitation.
      </p>
      <button
        disabled={busy}
        className="creation-primary px-6"
        onClick={async () => {
          setBusy(true);
          try {
            const r = await api("accept-invitation", {
              token: new URLSearchParams(window.location.search).get(
                "invitation",
              ),
            });
            window.history.replaceState({}, "", window.location.pathname);
            await refresh();
            onAccepted(r.id);
          } catch (e) {
            setMessage(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Accept invitation
      </button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
