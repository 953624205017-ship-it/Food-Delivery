const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

/**
 * Separate cookie ("admin_token") and separate JWT audience from the
 * customer auth, so a customer session can never touch admin routes and
 * vice-versa.
 */
async function requireAdmin(req, res, next) {
  try {
    const token = req.cookies?.admin_token;
    if (!token) throw new Error('No token');

    const payload = jwt.verify(token, process.env.JWT_SECRET, { audience: 'admin' });
    const admin = await Admin.findById(payload.id);
    if (!admin) throw new Error('Invalid admin');

    req.admin = admin;
    res.locals.currentAdmin = admin;
    next();
  } catch (err) {
    if (req.originalUrl.startsWith('/api/')) {
      return res.status(401).json({ success: false, message: 'Admin login required.' });
    }
    return res.redirect('/admin/login');
  }
}

module.exports = { requireAdmin };
