import { api, usePlatform } from "./Platform";
import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  X,
  ImagePlus,
  Camera,
  Calendar,
  Trophy,
  Building2,
  Award,
} from "lucide-react";
import "./creation.css";

export function CreateSheet({ onClose, onChoose }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="create-sheet"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="sheet-inner">
        <div className="sheet-handle" />
        <header>
          <h2>What would you like to create?</h2>
          <button aria-label="Close" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className="creation-options">
          {[
            ["session", "Session", Calendar, "Bring players together"],
            ["coaching", "Coaching", Award, "Share your skills"],
            ["tournament", "Tournaments", Trophy, "Set up a competition"],
            ["club", "Club", Building2, "Build your community"],
          ].map(([id, label, Icon, detail]) => (
            <button key={id} onClick={() => onChoose(id)}>
              <Icon size={23} />
              <strong>{label}</strong>
              <span>{detail}</span>
            </button>
          ))}
        </div>
      </div>
    </dialog>
  );
}
function Field({ label, required, children }) {
  return (
    <label className="creation-row">
      <span>
        {label}
        {required && <b className="required"> *</b>}
      </span>
      <div>{children}</div>
    </label>
  );
}
function Input({ label, required, ...props }) {
  return (
    <Field label={label} required={required}>
      <input required={required} {...props} />
    </Field>
  );
}
function Select({ label, options, required, ...props }) {
  return (
    <Field label={label} required={required}>
      <select required={required} {...props}>
        {options.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
    </Field>
  );
}
function Upload({ label, name, required, multiple, cover }) {
  const [previews, setPreviews] = useState([]);
  const [error, setError] = useState("");
  useEffect(
    () => () => previews.forEach((p) => URL.revokeObjectURL(p.url)),
    [previews],
  );
  return (
    <div className={cover ? "cover-upload" : "creation-upload"}>
      <label>
        <span>{cover ? <ImagePlus size={30} /> : <Camera size={28} />}</span>
        <span>
          {label}
          {required && <b className="required"> *</b>}
        </span>
        <input
          name={name}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          required={required}
          multiple={multiple}
          onChange={(e) => {
            const files = [...e.target.files];
            if (
              files.length > (multiple ? 9 : 1) ||
              files.some((f) => f.size > 4 * 1024 * 1024)
            ) {
              e.target.value = "";
              setError(
                "Choose up to " +
                  (multiple ? 9 : 1) +
                  " images, each under 4 MB.",
              );
              setPreviews([]);
              return;
            }
            setError("");
            setPreviews(
              files.map((f) => ({ url: URL.createObjectURL(f), name: f.name })),
            );
          }}
        />
      </label>
      {previews.length > 0 && (
        <div className="upload-previews">
          {previews.map((p) => (
            <img key={p.url} src={p.url} alt={p.name} />
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
function Toggle({ label, name, children }) {
  const [on, setOn] = useState(false);
  return (
    <>
      <Field label={label}>
        <input
          className="creation-toggle"
          type="checkbox"
          name={name}
          checked={on}
          onChange={(e) => setOn(e.target.checked)}
        />
      </Field>
      {on && children}
    </>
  );
}
function Intro({ title, onBack }) {
  return (
    <header className="creation-title">
      <button type="button" onClick={onBack} aria-label="Back">
        <ArrowLeft size={21} />
      </button>
      <h1>{title}</h1>
      <span />
    </header>
  );
}
function formData(form) {
  const disabled = [...form.querySelectorAll("fieldset:disabled")];
  disabled.forEach((x) => (x.disabled = false));
  const data = new FormData(form);
  disabled.forEach((x) => (x.disabled = true));
  return data;
}
async function send(kind, form) {
  const response = await fetch(`/api/creation/${kind}`, {
    method: "POST",
    body: formData(form),
    credentials: "same-origin",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.id)
    throw new Error(
      data?.error ||
        "Publishing is not connected yet. Your form has not been submitted. Please keep this page open and try again later.",
    );
  return data;
}
function useSubmit(kind) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  return {
    status,
    busy,
    submit: async (e) => {
      e.preventDefault();
      setBusy(true);
      setStatus("");
      try {
        await send(kind, e.currentTarget);
        setStatus(
          kind === "coach"
            ? "Application submitted for manual review."
            : "Published successfully.",
        );
      } catch (err) {
        setStatus(err.message);
      } finally {
        setBusy(false);
      }
    },
  };
}
export function EventForm({
  kind = "session",
  onBack,
  clubId,
  onPaymentSetup,
  initialSession,
}) {
  const { memberships, refresh } = usePlatform();
  const [publishMessage, setPublishMessage] = useState(""),
    [publishing, setPublishing] = useState(false),
    [setupClub, setSetupClub] = useState(null);
  async function persist(e) {
    e.preventDefault();
    const f = e.currentTarget;
    const d = Object.fromEntries(new FormData(f));
    const publish = e.nativeEvent.submitter?.value === "publish";
    setPublishing(true);
    setPublishMessage("");
    try {
      if ([...new FormData(f)].some(([, v]) => v instanceof File && v.size > 0))
        throw Error(
          "Photo uploads are not connected yet. Remove selected files to save the Session without images.",
        );
      if (d.womenDiscount || d.earlyBird)
        throw Error(
          "Discounted checkout is not supported yet. Turn off discounts to save this Session.",
        );
      if (d.payment === "Pay at venue")
        throw Error(
          "Pay-at-venue Sessions are not supported yet. Choose advance payment or Free.",
        );
      if (
        Number(d.MenMin) > Number(d.MenMax) ||
        Number(d.WomenMin) > Number(d.WomenMax)
      )
        throw Error("Minimum player level must not exceed maximum level.");
      const entries = dates.map((date) => ({
        ...(initialSession ? { id: initialSession.id } : {}),
        club_id: d.club_id,
        title: d.title,
        venue: d.location,
        starts_at: new Date(date + "T" + d.start).toISOString(),
        ends_at: new Date(date + "T" + d.end).toISOString(),
        price: d.payment === "Free" ? 0 : Math.round(Number(d.price) * 100),
        capacity: Number(d.capacity),
        cancellation_hours: Number.isFinite(parseInt(d.cancellation))
          ? parseInt(d.cancellation)
          : -1,
        publish,
        details: {
          kind,
          courts: d.courts,
          description: d.description,
          format: d.format,
          gender: d.gender,
          menMin: d.MenMin,
          menMax: d.MenMax,
          womenMin: d.WomenMin,
          womenMax: d.WomenMax,
          visibility: d.visibility,
        },
      }));
      await api("sessions", { entries });
      await refresh();
      setPublishMessage(
        publish ? "Session published." : "Draft saved to your Club.",
      );
    } catch (error) {
      setPublishMessage(error.message);
      if (error.code === "PAYMENT_SETUP_REQUIRED") {
        try {
          const entries = dates.map((date) => ({
            ...(initialSession ? { id: initialSession.id } : {}),
            club_id: d.club_id,
            title: d.title,
            venue: d.location,
            starts_at: new Date(date + "T" + d.start).toISOString(),
            ends_at: new Date(date + "T" + d.end).toISOString(),
            price: Math.round(Number(d.price) * 100),
            capacity: Number(d.capacity),
            publish: false,
          }));
          await api("sessions", { entries });
          await refresh();
          setSetupClub(d.club_id);
          setPublishMessage(
            "Paid draft saved. Set up Club payments before publishing.",
          );
        } catch (saveError) {
          setPublishMessage(saveError.message);
        }
      }
    } finally {
      setPublishing(false);
    }
  }
  const status = "";
  const [tab, setTab] = useState("Fill in details");
  const [dates, setDates] = useState([
    initialSession
      ? new Date(initialSession.starts_at).toLocaleDateString("en-CA")
      : "",
  ]);
  const [saved, setSaved] = useState("");
  const form = useRef(null);
  function draft() {
    const data = Object.fromEntries(
      [...new FormData(form.current)].filter(([, v]) => typeof v === "string"),
    );
    data.dates = dates;
    try {
      localStorage.setItem(
        `jimmy-draft-${kind}`,
        JSON.stringify({ ...data, dates }),
      );
      setSaved(
        "Draft saved on this device. Images must be selected again; check discount options when restoring.",
      );
    } catch {
      setSaved("Unable to save this draft. Please keep this page open.");
    }
  }
  function restore() {
    try {
      const d = JSON.parse(
        localStorage.getItem(`jimmy-draft-${kind}`) || "null",
      );
      if (!d) {
        setSaved("No saved draft on this device.");
        return;
      }
      Object.entries(d).forEach(([key, value]) => {
        const el = form.current.elements.namedItem(key);
        if (el && typeof value === "string" && el.type !== "checkbox")
          el.value = value;
      });
      setDates(d.dates || [""]);
      setSaved("Draft restored. Please check options and reselect images.");
    } catch {
      setSaved("Unable to restore draft.");
    }
  }
  return (
    <main className="creation-page">
      <Intro
        title={
          kind === "tournament"
            ? "Create Tournament"
            : kind === "coaching"
              ? "Create Coaching Session"
              : "Create Session"
        }
        onBack={onBack}
      />
      <div className="creation-tabs">
        {["Fill in details", "History", "Saved", "Other"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={tab === t ? "selected" : ""}
          >
            {t}
          </button>
        ))}
      </div>
      {tab !== "Fill in details" && (
        <div className="creation-note">
          {tab === "History" ? (
            "View saved drafts and published Sessions in your Club dashboard."
          ) : tab === "Saved" ? (
            <button
              onClick={() => {
                setTab("Fill in details");
                restore();
              }}
            >
              Restore draft saved on this device
            </button>
          ) : (
            <button
              onClick={() => {
                setTab("Fill in details");
                setTimeout(
                  () =>
                    document.getElementById("more-settings")?.scrollIntoView(),
                  0,
                );
              }}
            >
              Open more settings
            </button>
          )}
        </div>
      )}
      <form ref={form} onSubmit={persist}>
        <Field label="Club" required>
          <select
            name="club_id"
            required
            defaultValue={clubId || memberships[0]?.club_id || ""}
          >
            <option value="" disabled>
              Select your Club
            </option>
            {memberships.map((m) => (
              <option key={m.id} value={m.club_id}>
                {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Upload name="cover" label="Upload cover image" cover />
        <section>
          <Input
            label="Title"
            name="title"
            required
            defaultValue={initialSession?.title}
            placeholder="Enter a title"
          />
          <Select
            label="Organiser type"
            name="organiser"
            required
            options={["", "Individual", "Club", "Venue"]}
          />
          <Input
            label="Location"
            name="location"
            required
            defaultValue={initialSession?.venue}
            placeholder="Choose a venue or enter its address"
          />
          <Input
            label="Court numbers"
            name="courts"
            placeholder="Enter court numbers"
          />
          <Field label="Session dates (multiple allowed)" required>
            <div>
              {dates.map((d, i) => (
                <input
                  key={i}
                  aria-label={`Date ${i + 1}`}
                  name="dates"
                  type="date"
                  required
                  min={new Date().toLocaleDateString("en-CA")}
                  value={d}
                  onChange={(e) =>
                    setDates(
                      dates.map((x, j) => (j === i ? e.target.value : x)),
                    )
                  }
                />
              ))}
              <button
                type="button"
                disabled={!!initialSession}
                onClick={() => setDates([...dates, ""])}
              >
                + Add date
              </button>
              {dates.length > 1 && (
                <button
                  type="button"
                  onClick={() => setDates(dates.slice(0, -1))}
                >
                  Remove last date
                </button>
              )}
            </div>
          </Field>
          <Field label="Session time" required>
            <div className="time-fields">
              <input
                aria-label="Start time"
                name="start"
                type="time"
                defaultValue={
                  initialSession
                    ? new Date(initialSession.starts_at)
                        .toTimeString()
                        .slice(0, 5)
                    : undefined
                }
                required
              />
              <span>–</span>
              <input
                aria-label="End time"
                name="end"
                type="time"
                defaultValue={
                  initialSession
                    ? new Date(initialSession.ends_at)
                        .toTimeString()
                        .slice(0, 5)
                    : undefined
                }
                required
              />
            </div>
          </Field>
          <Select
            label="Cancellation deadline"
            name="cancellation"
            options={[
              "12 hours before",
              "24 hours before",
              "48 hours before",
              "No cancellations",
            ]}
          />
        </section>
        <section className="insurance">
          <strong>Extra protection for peace of mind</strong>
          <p>Insurance options</p>
          <div className="insurance-cards">
            <label>
              <input
                type="radio"
                name="insurance"
                value="none"
                defaultChecked
              />{" "}
              No insurance
              <br />
              <small>Arrange your own cover</small>
            </label>
            <label className="unavailable">
              <input type="radio" disabled /> More cover
              <br />
              <small>Not yet available</small>
            </label>
          </div>
        </section>
        <section>
          <label className="creation-text">
            Session description
            <textarea
              name="description"
              placeholder="Describe your session…"
              rows={5}
            />
          </label>
          <Upload name="photos" label="Add photos (up to 9)" multiple />
        </section>
        <section>
          <Select
            label="Payment type"
            required
            name="payment"
            options={["Pay in full in advance", "Pay at venue", "Free"]}
          />
          <p className="field-help">
            For advance payment, the full fee is collected when booking.
          </p>
          <Toggle label="Discount for women" name="womenDiscount">
            <Input
              label="Discount (£)"
              name="womenDiscountAmount"
              required
              type="number"
              min="0"
              step="0.01"
            />
          </Toggle>
          <Toggle label="Early bird discount" name="earlyBird">
            <Input
              label="Early bird price (£)"
              name="earlyBirdPrice"
              required
              type="number"
              min="0"
              step="0.01"
            />
            <Input
              label="Early bird deadline"
              name="earlyBirdDeadline"
              required
              type="datetime-local"
            />
          </Toggle>
        </section>
        <h2 className="creation-section-heading">Session format</h2>
        <section>
          <p className="field-help">
            Create or manage groups in the session details after publishing.
          </p>
          <Select
            label="Activity format"
            name="format"
            options={["Regular session", "Group session"]}
          />
          <Select
            label="Gender restriction"
            required
            name="gender"
            options={["Everyone", "Men only", "Women only"]}
          />
          <Input
            label="Number of players"
            required
            name="capacity"
            defaultValue={initialSession?.capacity}
            type="number"
            min="1"
            max="1000"
            placeholder="Enter capacity"
          />
          <Input
            label="Entry fee (£ / person)"
            required
            name="price"
            defaultValue={
              initialSession ? initialSession.price / 100 : undefined
            }
            type="number"
            min="0"
            step="0.01"
            placeholder="Enter entry fee"
          />
          <h3 className="creation-section-heading">Player level</h3>
          {["Men", "Women"].map((g) => (
            <Field key={g} label={`${g}'s level`}>
              <div className="time-fields">
                <select aria-label={`${g} minimum level`} name={`${g}Min`}>
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      L{i + 1}
                    </option>
                  ))}
                </select>
                <span>–</span>
                <select
                  aria-label={`${g} maximum level`}
                  name={`${g}Max`}
                  defaultValue="8"
                >
                  {Array.from({ length: 8 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      L{i + 1}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
          ))}
        </section>
        <h2 className="creation-section-heading">Organiser information</h2>
        <section>
          <Input
            label="Contact person"
            name="contact"
            placeholder="Your name"
          />
          <Input
            label="Contact phone"
            required
            name="phone"
            type="tel"
            placeholder="Phone number"
          />
          <Input label="WeChat ID" name="wechat" placeholder="WeChat ID" />
          <details id="more-settings">
            <summary>More settings</summary>
            <Select
              label="Visibility"
              name="visibility"
              options={["Public", "Unlisted"]}
            />
            <Input
              label="Registration deadline"
              name="registrationDeadline"
              type="datetime-local"
            />
            <textarea
              name="additionalNotes"
              placeholder="Other session details"
            />
          </details>
        </section>
        {setupClub && (
          <button
            type="button"
            className="workspace-button"
            onClick={() => onPaymentSetup?.(setupClub)}
          >
            Set up Club payments
          </button>
        )}
        {publishMessage && (
          <p role="status" className="creation-note">
            {publishMessage}
          </p>
        )}
        {saved && (
          <p role="status" className="creation-note">
            {saved}
          </p>
        )}
        {status && (
          <p role="status" className="creation-note">
            {status}
          </p>
        )}
        <div className="creation-actions">
          <button type="button" onClick={draft}>
            Save on device
          </button>
          <button type="submit" value="draft" disabled={publishing}>
            Save draft
          </button>
          <button
            type="submit"
            value="publish"
            className="creation-primary"
            disabled={publishing}
          >
            {publishing ? "Saving…" : "Publish"}
          </button>
        </div>
      </form>
    </main>
  );
}
export function ClubForm({ onBack, onCreated }) {
  const [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const { refresh } = usePlatform();
  return (
    <main className="creation-page">
      <Intro title="Create Club" onBack={onBack} />
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const data = Object.fromEntries(new FormData(e.currentTarget));
          setBusy(true);
          try {
            const result = await api("clubs", data);
            await refresh();
            onCreated?.(result.id);
          } catch (error) {
            setStatus(error.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <section>
          <Input
            label="Club Name"
            name="name"
            required
            placeholder="Bromley Social Badminton"
          />
          <Select
            label="Primary Sport"
            name="primary_sport"
            required
            options={[
              "Badminton",
              "Football",
              "Basketball",
              "Volleyball",
              "Tennis",
              "Padel",
              "Other",
            ]}
          />
          <Input
            label="Main Area"
            name="main_area"
            required
            placeholder="Bromley"
          />
        </section>
        <p className="creation-note">
          You will become the Club Owner. You can invite your team and publish
          free Sessions immediately. Set up payments when you are ready to
          accept paid bookings.
        </p>
        {status && (
          <p className="creation-note" role="alert">
            {status}
          </p>
        )}
        <div className="creation-actions">
          <button className="creation-primary" disabled={busy}>
            {busy ? "Creating…" : "Create Club"}
          </button>
        </div>
      </form>
    </main>
  );
}
export function CoachingFlow({ onBack }) {
  const [step, setStep] = useState(1);
  const [state, setState] = useState("checking");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const form = useRef(null);
  useEffect(() => {
    let active = true;
    fetch("/api/creation/coach-status", { credentials: "same-origin" })
      .then(async (r) => {
        const d = await r.json();
        if (
          !r.ok ||
          !["approved", "pending", "rejected", "not_registered"].includes(
            d.status,
          )
        )
          throw Error();
        if (active) setState(d.status);
      })
      .catch(() => {
        if (active) setState("unconnected");
      });
    return () => {
      active = false;
    };
  }, []);
  if (state === "checking")
    return (
      <main className="creation-page">
        <p className="creation-note" role="status">
          Checking coaching registration…
        </p>
      </main>
    );
  if (state === "approved")
    return <EventForm kind="coaching" onBack={onBack} />;
  if (state === "pending")
    return (
      <main className="creation-page">
        <Intro title="Coaching" onBack={onBack} />
        <p className="creation-note">
          Your application is awaiting manual review. You can publish coaching
          sessions after approval.
        </p>
      </main>
    );
  async function next(e) {
    e.preventDefault();
    if (step < 3) {
      setStep(step + 1);
      window.scrollTo(0, 0);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await send("coach", form.current);
      setState("pending");
    } catch (err) {
      setMessage(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="creation-page coaching-page">
      <Intro
        title="Coach Registration"
        onBack={() => (step > 1 ? setStep(step - 1) : onBack())}
      />
      <ol className="coach-steps">
        {["Teaching details", "Qualifications", "About you"].map((label, i) => (
          <li key={label} className={step >= i + 1 ? "active" : ""}>
            <span>{i + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>
      {state === "unconnected" && (
        <p className="creation-note">
          Registration status is unavailable. You can prepare your application
          here; submission will be available once the registration service is
          connected.
        </p>
      )}
      {state === "rejected" && (
        <p className="creation-note">
          Please update your application and resubmit for review.
        </p>
      )}
      <form ref={form} onSubmit={next}>
        <fieldset hidden={step !== 1} disabled={step !== 1}>
          <section>
            <Select
              label="Teaching category"
              name="category"
              required
              options={[
                "",
                "Badminton",
                "Tennis",
                "Table tennis",
                "Football",
                "Basketball",
              ]}
            />
            <Input
              label="Teaching city"
              required
              name="city"
              placeholder="Select or enter teaching city"
              list="coach-cities"
            />
            <datalist id="coach-cities">
              <option>London</option>
              <option>Manchester</option>
              <option>Birmingham</option>
            </datalist>
            <Input
              label="Teaching area"
              required
              name="area"
              placeholder="Select or enter teaching area"
            />
          </section>
        </fieldset>
        <fieldset hidden={step !== 2} disabled={step !== 2}>
          <section>
            <Input
              label="Coaching qualification"
              required
              name="qualification"
              placeholder="Enter qualification name"
            />
            <Upload
              name="qualificationImage"
              required
              label="Upload a clear image of your coaching certificate"
            />
            <Input
              label="Athlete level (optional)"
              name="athleteLevel"
              placeholder="Enter athlete level"
            />
            <p className="field-help">
              An athlete grading certificate issued by the relevant sports
              authority.
            </p>
            <Upload
              name="athleteImage"
              label="Upload a clear image of your athlete grading certificate"
            />
          </section>
        </fieldset>
        <fieldset hidden={step !== 3} disabled={step !== 3}>
          <section>
            <label className="creation-text">
              Self-introduction <b className="required">*</b>
              <textarea
                name="introduction"
                required
                minLength={30}
                maxLength={3000}
                rows={9}
                placeholder="Tell us about your coaching experience, teaching style and the players you work with (30–3,000 characters)."
              />
            </label>
            <p className="field-help">
              Your application and certificates will be reviewed by our team
              before your coach profile is approved.
            </p>
          </section>
        </fieldset>
        {message && (
          <p className="creation-note" role="alert">
            {message}
          </p>
        )}
        <div className="creation-actions">
          {step > 1 && (
            <button type="button" onClick={() => setStep(step - 1)}>
              Back
            </button>
          )}
          <button className="creation-primary" disabled={busy}>
            {busy
              ? "Submitting…"
              : step === 3
                ? "Submit for review"
                : "Confirm and continue"}
          </button>
        </div>
      </form>
    </main>
  );
}
