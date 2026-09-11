import platform from "../platform/[action].js";
// Preserve legacy URLs, reusing the same canonical Club/Session service.
export default async function handler(req, res) {
  const actions = {
    club: "clubs",
    session: "sessions",
    tournament: "sessions",
  };
  if (actions[req.query?.kind]) {
    if (!req.headers["content-type"]?.includes("application/json"))
      return res
        .status(415)
        .json({ error: "Use the current Club or Session form." });
    req.query.action = actions[req.query.kind];
    return platform(req, res);
  }
  res.setHeader("Cache-Control", "no-store");
  return res
    .status(503)
    .json({
      error:
        "Coach application review is not configured yet. Nothing has been submitted.",
      code: "SERVICE_NOT_CONFIGURED",
    });
}
