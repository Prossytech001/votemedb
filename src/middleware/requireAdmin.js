// Simple admin auth: expects header `x-admin-key` matching ADMIN_API_KEY env var.
// Good enough for a 2-day build. Swap for real auth (JWT/session) later if this becomes long-term.
module.exports = function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing admin key' });
  }
  next();
};
