const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');

const User = require('../models/User');
const { sendOtp, verifyOtp } = require('../utils/otpService');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return `+91${last10}`;
}

function issueUserToken(res, user) {
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

// ---------- Pages ----------
router.get('/register', (req, res) => res.render('register', { title: 'Register' }));
router.get('/login', (req, res) => res.render('login', { title: 'Login' }));

// ---------- Step 1: submit registration details, send OTP ----------
router.post(
  '/api/auth/register/start',
  authLimiter,
  [
    body('username').trim().isLength({ min: 3, max: 40 }).withMessage('Username must be 3-40 characters.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('age').isInt({ min: 1, max: 120 }).withMessage('Enter a valid age.'),
    body('phone').custom((v) => INDIAN_PHONE_REGEX.test(String(v).replace(/\D/g, '').slice(-10)))
      .withMessage('Enter a valid Indian mobile number.'),
    body('dob').custom((value, { req }) => {
      const age = Number(req.body.age);
      if (age >= 18 && !value) {
        throw new Error('Date of birth is required for users 18 or older.');
      }
      return true;
    }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: errors.array()[0].msg });
    }

    const { username, password, age, dob, phone } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const existingActive = await User.findOne({ phone: normalizedPhone, isActive: true });
    if (existingActive) {
      return res.status(409).json({ success: false, message: 'This phone number is already registered. Please log in.' });
    }

    // Stash pending registration in a short-lived signed cookie rather than
    // an unverified DB row, so unverified accounts never occupy the Users
    // collection or collide on unique(phone).
    const pendingToken = jwt.sign(
      { username, password, age: Number(age), dob: age >= 18 ? dob : undefined, phone: normalizedPhone },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );
    res.cookie('pending_registration', pendingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

    try {
      const { resendAvailableInSeconds } = await sendOtp(normalizedPhone, 'registration');
      res.json({ success: true, message: 'OTP sent to your phone.', resendAvailableInSeconds, phone: normalizedPhone });
    } catch (err) {
      if (err.code === 'RATE_LIMITED') {
        return res.status(429).json({ success: false, message: err.message, retryAfterSeconds: err.retryAfterSeconds });
      }
      throw err;
    }
  })
);

// ---------- Resend OTP ----------
router.post(
  '/api/auth/register/resend-otp',
  authLimiter,
  asyncHandler(async (req, res) => {
    const pending = req.cookies?.pending_registration;
    if (!pending) return res.status(400).json({ success: false, message: 'Registration session expired. Please start again.' });

    const payload = jwt.verify(pending, process.env.JWT_SECRET);
    try {
      const { resendAvailableInSeconds } = await sendOtp(payload.phone, 'registration');
      res.json({ success: true, message: 'OTP resent.', resendAvailableInSeconds });
    } catch (err) {
      if (err.code === 'RATE_LIMITED') {
        return res.status(429).json({ success: false, message: err.message, retryAfterSeconds: err.retryAfterSeconds });
      }
      throw err;
    }
  })
);

// ---------- Step 2: verify OTP, create + activate account ----------
router.post(
  '/api/auth/register/verify-otp',
  authLimiter,
  asyncHandler(async (req, res) => {
    const pending = req.cookies?.pending_registration;
    if (!pending) return res.status(400).json({ success: false, message: 'Registration session expired. Please start again.' });

    let payload;
    try {
      payload = jwt.verify(pending, process.env.JWT_SECRET);
    } catch (_) {
      return res.status(400).json({ success: false, message: 'Registration session expired. Please start again.' });
    }

    const { code } = req.body;
    try {
      await verifyOtp(payload.phone, 'registration', code);
    } catch (err) {
      const statusMap = { EXPIRED: 410, TOO_MANY_ATTEMPTS: 429, INVALID: 400, NOT_FOUND: 400 };
      return res
        .status(statusMap[err.code] || 400)
        .json({ success: false, message: err.message, attemptsRemaining: err.attemptsRemaining });
    }

    const existingActive = await User.findOne({ phone: payload.phone, isActive: true });
    if (existingActive) {
      return res.status(409).json({ success: false, message: 'This phone number is already registered. Please log in.' });
    }

    let user = await User.findOne({ phone: payload.phone });
    if (!user) user = new User({ phone: payload.phone });

    user.username = payload.username;
    user.age = payload.age;
    if (payload.dob) user.dob = payload.dob;
    await user.setPassword(payload.password);
    user.phoneVerified = true;
    user.isActive = true;
    await user.save();

    res.clearCookie('pending_registration');
    issueUserToken(res, user);

    res.json({ success: true, message: 'Account created!', redirect: '/dashboard' });
  })
);

// ---------- Login ----------
router.post(
  '/api/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { phone, password } = req.body;
    const normalizedPhone = normalizePhone(phone);

    const user = await User.findOne({ phone: normalizedPhone, isActive: true });
    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid phone number or password.' });
    }

    issueUserToken(res, user);
    res.json({ success: true, message: 'Logged in!', redirect: '/dashboard' });
  })
);

router.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, redirect: '/login' });
});

module.exports = router;
