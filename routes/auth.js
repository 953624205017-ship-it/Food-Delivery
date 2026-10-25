const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const asyncHandler = require('express-async-handler');

const User = require('../models/User');
const Otp = require('../models/Otp');
const {
  createAndSendEmailOtp,
  verifyEmailOtp,
  verifyOtp,
} = require('../utils/otpService');
const { isEmailConfigured } = require('../utils/emailService');
const { verifyFirebaseIdToken } = require('../config/firebaseAdmin');
const { authLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return `+91${last10}`;
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
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

// ---------- Step 1: Submit registration details & send Email OTP ----------
router.post(
  '/api/auth/register/start',
  authLimiter,
  [
    body('username').trim().isLength({ min: 3, max: 40 }).withMessage('Username must be 3-40 characters.'),
    body('email').trim().isEmail().normalizeEmail().withMessage('Please enter a valid email address.'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters.'),
    body('phone').custom((v) => INDIAN_PHONE_REGEX.test(String(v).replace(/\D/g, '').slice(-10)))
      .withMessage('Enter a valid 10-digit Indian mobile number.'),
    body('age').isInt({ min: 1, max: 120 }).withMessage('Enter a valid age.'),
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

    const { username, email, password, age, dob, phone } = req.body;
    const normalizedEmail = normalizeEmail(email);
    const normalizedPhone = normalizePhone(phone);

    // 1. Check if email is already registered to an active user
    const existingActiveEmail = await User.findOne({ email: normalizedEmail, isActive: true });
    if (existingActiveEmail) {
      return res.status(409).json({
        success: false,
        message: 'This email address is already registered. Please log in.',
      });
    }

    // 2. Check if phone is already registered to an active user
    const existingActivePhone = await User.findOne({ phone: normalizedPhone, isActive: true });
    if (existingActivePhone) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered. Please log in.',
      });
    }

    // 3. Check if username is already registered to an active user
    const existingActiveUsername = await User.findOne({ username: username.trim(), isActive: true });
    if (existingActiveUsername) {
      return res.status(409).json({
        success: false,
        message: 'This username is already taken. Please choose another username.',
      });
    }

    // 4. Check if Email SMTP service is configured
    if (!isEmailConfigured()) {
      return res.status(500).json({
        success: false,
        message:
          'Email service is not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in your .env file.',
        code: 'EMAIL_NOT_CONFIGURED',
      });
    }

    // 5. Generate secure 6-digit OTP and send via Gmail SMTP
    let otpResult;
    try {
      otpResult = await createAndSendEmailOtp({
        email: normalizedEmail,
        username: username.trim(),
        purpose: 'registration',
        hotelName: res.locals.hotelName || 'HOTEL LITTLE JAPPAN',
      });
    } catch (err) {
      const status = err.code === 'COOLDOWN_ACTIVE' ? 429 : 500;
      return res.status(status).json({
        success: false,
        message: err.message || 'Failed to send verification email. Please check your email configuration.',
        cooldownRemaining: err.cooldownRemaining,
      });
    }

    // 6. Stash pending registration details in a short-lived signed JWT cookie
    const pendingToken = jwt.sign(
      {
        username: username.trim(),
        email: normalizedEmail,
        password,
        age: Number(age),
        dob: Number(age) >= 18 ? dob : undefined,
        phone: normalizedPhone,
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.cookie('pending_registration', pendingToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.json({
      success: true,
      message: `A 6-digit verification code has been sent to ${normalizedEmail}.`,
      email: normalizedEmail,
      phone: normalizedPhone,
      resendAvailableInSeconds: otpResult.resendAvailableInSeconds || 60,
    });
  })
);

// ---------- Step 1B: Resend Email OTP ----------
router.post(
  '/api/auth/register/resend-otp',
  authLimiter,
  asyncHandler(async (req, res) => {
    // Read pending registration from cookie or body
    let payload = null;
    const pendingCookie = req.cookies?.pending_registration;
    if (pendingCookie) {
      try {
        payload = jwt.verify(pendingCookie, process.env.JWT_SECRET);
      } catch (_) {}
    }

    const email = payload?.email || normalizeEmail(req.body.email);
    const username = payload?.username || req.body.username || '';

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Registration session expired. Please start the registration process again.',
      });
    }

    if (!isEmailConfigured()) {
      return res.status(500).json({
        success: false,
        message: 'Email service is not configured. Please set EMAIL_USER and EMAIL_APP_PASSWORD in .env',
      });
    }

    try {
      const otpResult = await createAndSendEmailOtp({
        email,
        username,
        purpose: 'registration',
        hotelName: res.locals.hotelName || 'HOTEL LITTLE JAPPAN',
      });

      res.json({
        success: true,
        message: `A new 6-digit verification code has been sent to ${email}.`,
        email,
        resendAvailableInSeconds: otpResult.resendAvailableInSeconds || 60,
      });
    } catch (err) {
      const status = err.code === 'COOLDOWN_ACTIVE' ? 429 : 500;
      return res.status(status).json({
        success: false,
        message: err.message || 'Failed to resend verification email.',
        cooldownRemaining: err.cooldownRemaining,
      });
    }
  })
);

// ---------- Step 2: Verify Email OTP & Finalize Account Creation ----------
router.post(
  ['/api/auth/register/verify-otp', '/api/auth/register/verify-email'],
  authLimiter,
  asyncHandler(async (req, res, next) => {
    // If client sends idToken (from legacy Firebase Phone Auth), forward to Firebase handler
    if (req.body.idToken) {
      req.url = '/api/auth/register/verify-firebase';
      return router.handle(req, res, next);
    }

    const code = req.body.code || req.body.otp;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Please enter the 6-digit verification code.' });
    }

    // Retrieve pending registration details from signed cookie or request body
    let payload = null;
    const pendingCookie = req.cookies?.pending_registration;
    if (pendingCookie) {
      try {
        payload = jwt.verify(pendingCookie, process.env.JWT_SECRET);
      } catch (_) {}
    }

    // Fallback: accept registration details in body if cookie was blocked
    if (!payload && req.body.email && req.body.password && req.body.phone && req.body.username) {
      payload = {
        username: req.body.username.trim(),
        email: normalizeEmail(req.body.email),
        password: req.body.password,
        age: Number(req.body.age || 20),
        dob: req.body.dob,
        phone: normalizePhone(req.body.phone),
      };
    }

    if (!payload || !payload.email) {
      return res.status(400).json({
        success: false,
        message: 'Registration session expired or details missing. Please fill the registration form again.',
      });
    }

    // Verify OTP securely against SHA-256 hash in MongoDB
    try {
      await verifyEmailOtp(payload.email, 'registration', code);
    } catch (err) {
      const statusMap = {
        EXPIRED: 410,
        TOO_MANY_ATTEMPTS: 429,
        INVALID: 400,
        NOT_FOUND: 400,
        INVALID_FORMAT: 400,
      };
      return res.status(statusMap[err.code] || 400).json({
        success: false,
        message: err.message || 'OTP verification failed.',
        attemptsRemaining: err.attemptsRemaining,
      });
    }

    // OTP is valid! Check if an active account already exists with this email or phone
    const existingActive = await User.findOne({
      $or: [{ email: payload.email }, { phone: payload.phone }],
      isActive: true,
    });

    if (existingActive) {
      return res.status(409).json({
        success: false,
        message: 'This email or phone number is already registered. Please log in.',
      });
    }

    // Create or activate user
    let user = await User.findOne({
      $or: [{ email: payload.email }, { phone: payload.phone }],
    });

    if (!user) {
      user = new User({
        email: payload.email,
        phone: payload.phone,
      });
    }

    user.username = payload.username;
    user.email = payload.email;
    user.phone = payload.phone;
    user.age = payload.age;
    if (payload.dob) user.dob = payload.dob;
    await user.setPassword(payload.password);
    user.emailVerified = true;
    user.phoneVerified = true;
    user.isActive = true;
    await user.save();

    // Clear pending registration cookie
    res.clearCookie('pending_registration');

    // Issue session token cookie
    issueUserToken(res, user);

    res.json({
      success: true,
      message: 'Email verified and account created successfully!',
      redirect: '/dashboard',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
      },
    });
  })
);

// ---------- Password Login (Supports Email OR Phone) ----------
router.post(
  '/api/auth/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { identifier, phone, email, password } = req.body;
    const rawIdentifier = (identifier || email || phone || '').trim();

    if (!rawIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please enter your email or phone number, and your password.',
      });
    }

    let user = null;

    if (rawIdentifier.includes('@')) {
      // Login via Email
      const normalizedEmail = normalizeEmail(rawIdentifier);
      user = await User.findOne({ email: normalizedEmail, isActive: true });
    } else {
      // Login via Phone
      const normalizedPhone = normalizePhone(rawIdentifier);
      user = await User.findOne({ phone: normalizedPhone, isActive: true });
    }

    if (!user || !(await user.verifyPassword(password))) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email/phone number or password.',
      });
    }

    issueUserToken(res, user);
    res.json({
      success: true,
      message: 'Logged in successfully!',
      redirect: '/dashboard',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
      },
    });
  })
);

// ---------- Logout ----------
router.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, redirect: '/login' });
});

// ---------- Firebase Phone Auth Endpoints (Preserved for compatibility) ----------
router.post(
  '/api/auth/register/verify-firebase',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Firebase authentication token is required.' });
    }

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      const status = err.code === 'FIREBASE_NOT_CONFIGURED' ? 500 : 401;
      return res.status(status).json({
        success: false,
        message: err.message || 'Firebase token verification failed.',
      });
    }

    let payload = null;
    const pendingCookie = req.cookies?.pending_registration;
    if (pendingCookie) {
      try {
        payload = jwt.verify(pendingCookie, process.env.JWT_SECRET);
      } catch (_) {}
    }

    if (!payload && req.body.username && req.body.password && req.body.phone) {
      payload = {
        username: req.body.username,
        email: req.body.email ? normalizeEmail(req.body.email) : undefined,
        password: req.body.password,
        age: Number(req.body.age || 20),
        dob: req.body.dob,
        phone: normalizePhone(req.body.phone),
      };
    }

    if (!payload) {
      return res.status(400).json({
        success: false,
        message: 'Registration session expired. Please fill the registration form again.',
      });
    }

    const verifiedPhone = normalizePhone(decodedToken.phone_number);
    let user = await User.findOne({ phone: verifiedPhone });
    if (!user) user = new User({ phone: verifiedPhone });

    user.username = payload.username;
    if (payload.email) user.email = payload.email;
    user.age = payload.age;
    if (payload.dob) user.dob = payload.dob;
    await user.setPassword(payload.password);
    user.phoneVerified = true;
    user.isActive = true;
    user.firebaseUid = decodedToken.uid;
    await user.save();

    res.clearCookie('pending_registration');
    issueUserToken(res, user);

    res.json({
      success: true,
      message: 'Account created successfully!',
      redirect: '/dashboard',
    });
  })
);

router.post(
  ['/api/auth/login/verify-firebase', '/api/auth/firebase-login'],
  authLimiter,
  asyncHandler(async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'Firebase authentication token is required.' });
    }

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      const status = err.code === 'FIREBASE_NOT_CONFIGURED' ? 500 : 401;
      return res.status(status).json({
        success: false,
        message: err.message || 'Firebase token verification failed.',
      });
    }

    const normalizedPhone = normalizePhone(decodedToken.phone_number);
    const user = await User.findOne({ phone: normalizedPhone, isActive: true });

    if (!user) {
      return res.status(404).json({
        success: false,
        notRegistered: true,
        message: 'No active account found for this mobile number. Please create an account.',
      });
    }

    if (!user.firebaseUid) {
      user.firebaseUid = decodedToken.uid;
      await user.save();
    }

    issueUserToken(res, user);
    res.json({
      success: true,
      message: 'Logged in successfully!',
      redirect: '/dashboard',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        phone: user.phone,
      },
    });
  })
);

router.post(
  '/api/auth/verify-firebase-token',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ success: false, message: 'idToken is required.' });
    }

    let decodedToken;
    try {
      decodedToken = await verifyFirebaseIdToken(idToken);
    } catch (err) {
      const status = err.code === 'FIREBASE_NOT_CONFIGURED' ? 500 : 401;
      return res.status(status).json({
        success: false,
        message: err.message || 'Token verification failed.',
      });
    }

    const normalizedPhone = normalizePhone(decodedToken.phone_number);
    const user = await User.findOne({ phone: normalizedPhone, isActive: true });

    if (user) issueUserToken(res, user);

    res.json({
      success: true,
      message: 'Token verified successfully.',
      isExistingUser: Boolean(user),
      phone: normalizedPhone,
    });
  })
);

// Diagnostic SMTP check endpoint (dev only)
router.get('/api/auth/smtp-check', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ success: false, message: 'Not found.' });
  }

  const { verifySmtpConnection } = require('../utils/emailService');
  if (!isEmailConfigured()) {
    return res.json({
      success: false,
      configured: false,
      message: 'EMAIL_USER and EMAIL_APP_PASSWORD are not set in .env',
      envHelp: 'Add EMAIL_USER=your_email@gmail.com and EMAIL_APP_PASSWORD=your_16_char_app_password to .env',
    });
  }

  try {
    await verifySmtpConnection();
    res.json({
      success: true,
      configured: true,
      message: 'Gmail SMTP credentials verified successfully. Ready to send emails!',
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      configured: true,
      error: err.message,
      code: err.code,
    });
  }
}));

module.exports = router;
