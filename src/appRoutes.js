export const APP_BASE = "/dev53";

const staticRoutes = {
  discover: "discover",
  clubs: "clubs",
  bookings: "bookings",
  profile: "my-space",
  about: "about",
  contact: "contact",
  terms: "terms",
  tools: "tools",
  scoreboard: "tools/scoreboard",
  tactics: "tools/tactics-board",
  levels: "levels",
  rankings: "my-ranking",
  tournaments: "tournaments",
  organiser: "organiser",
  "create-session": "create/session",
  "create-tournament": "create/tournament",
  "create-club": "create/club",
  coaching: "coaching",
};

export function routeToPath(view, params = {}) {
  if (view === "eventDetail") return `${APP_BASE}/session/${encodeURIComponent(params.eventId || "")}`;
  if (view === "payment") return `${APP_BASE}/booking/${encodeURIComponent(params.eventId || "")}`;
  if (view === "clubDetail") return `${APP_BASE}/club/${encodeURIComponent(params.clubId || "")}`;
  if (view === "tournamentDetail") return `${APP_BASE}/tournament/${encodeURIComponent(params.tournamentId || "")}`;
  return `${APP_BASE}/${staticRoutes[view] || "discover"}`;
}

export function pathToRoute(pathname = "/") {
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === APP_BASE) return { view: "discover", params: {} };
  if (!clean.startsWith(`${APP_BASE}/`)) return null;
  const path = clean.slice(APP_BASE.length + 1);
  const dynamic = [
    ["session/", "eventDetail", "eventId"],
    ["booking/", "payment", "eventId"],
    ["club/", "clubDetail", "clubId"],
    ["tournament/", "tournamentDetail", "tournamentId"],
  ].find(([prefix]) => path.startsWith(prefix));
  if (dynamic) {
    const [prefix, view, key] = dynamic;
    return { view, params: { [key]: decodeURIComponent(path.slice(prefix.length)) } };
  }
  const entry = Object.entries(staticRoutes).find(([, route]) => route === path);
  return { view: entry?.[0] || "discover", params: {} };
}
