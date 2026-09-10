// The existing site has no authenticated backend. Fail explicitly until real
// identity, durable storage, private certificate uploads and review are wired.
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return res.status(503).json({
    error: 'The publishing and registration service is not connected yet. Nothing has been submitted. Your information is still in this form; please keep this page open.',
    code: 'SERVICE_NOT_CONFIGURED',
  });
}
