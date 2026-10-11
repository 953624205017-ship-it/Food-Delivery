const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * Reads the JWT from the httpOnly "token" cookie, verifies it, and attaches
 * req.user. Redirects to /login for page routes, or 401 JSON for /api routes.
 */
async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) throw new Error('No token');

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (!user || !user.isActive) throw new Error('Invalid user');

    req.user = user;
    res.locals.currentUser = user;
    next();
  } catch (err) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Please log in to continue.' });
    }
    return res.redirect('/login');
  }
}

/** Populates req.user if logged in, but never blocks the request. */
async function attachUserIfPresent(req, res, next) {
  try {
    const token = req.cookies?.token;
    if (!token) return next();
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.id);
    if (user && user.isActive) {
      req.user = user;
      res.locals.currentUser = user;
    }
  } catch (_) {
    // ignore invalid/expired token for optional auth
  }
  next();
}

module.exports = { requireAuth, attachUserIfPresent };
