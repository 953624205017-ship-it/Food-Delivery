const crypto = require('crypto');
const Otp = require('../models/Otp');
const { sendOtpEmail, EXPIRY_MINUTES } = require('./emailService');

const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const INDIAN_PHONE_REGEX = /^[6-9]\d{9}$/;

function toDbPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return `+91${last10}`;
}

function validateIndianMobile(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  const last10 = digits.slice(-10);
  return INDIAN_PHONE_REGEX.test(last10);
}

/**
 * Generates a cryptographically secure random 6-digit OTP (100000 - 999999).
 * Uses Node's crypto.randomInt for uniform, non-deterministic entropy.
 * @returns {string} 6-digit numeric string
 */
function generateSecureOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Creates, securely stores, and emails an OTP to the given address.
 * Enforces a 60-second resend cooldown and 5-minute expiration.
 * Stores only a SHA-256 hash in MongoDB — never plain text.
 *
 * @param {object} params
 * @param {string} params.email - Recipient email
 * @param {string} [params.username] - User's name
 * @param {string} [params.purpose='registration'] - Purpose
 * @param {string} [params.hotelName] - Hotel Little Jappan
 * @returns {Promise<{ expiresAt: Date, resendAvailableInSeconds: number }>}
 */
async function createAndSendEmailOtp({ email, username = '', purpose = 'registration', hotelName = 'HOTEL LITTLE JAPPAN' }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail || !/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    const err = new Error('Please provide a valid email address.');
    err.code = 'INVALID_EMAIL';
    throw err;
  }

  // 1. Check for active unexpired OTP to enforce resend cooldown
  const existing = await Otp.findOne({ email: normalizedEmail, purpose }).sort({ createdAt: -1 });
  if (existing) {
    const elapsedSeconds = Math.floor((Date.now() - new Date(existing.lastSentAt).getTime()) / 1000);
    if (elapsedSeconds < RESEND_COOLDOWN_SECONDS) {
      const remainingSeconds = RESEND_COOLDOWN_SECONDS - elapsedSeconds;
      const err = new Error(`Please wait ${remainingSeconds} second(s) before requesting another code.`);
      err.code = 'COOLDOWN_ACTIVE';
      err.cooldownRemaining = remainingSeconds;
      throw err;
    }
  }

  // 2. Generate cryptographically secure 6-digit OTP
  const plainOtp = generateSecureOtp();
  const codeHash = Otp.hashCode(plainOtp);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  // 3. Clear any older OTPs for this email and purpose to prevent multiple valid codes
  await Otp.deleteMany({ email: normalizedEmail, purpose });

  // 4. Save new hashed record to MongoDB
  const otpRecord = await Otp.create({
    email: normalizedEmail,
    codeHash,
    purpose,
    attempts: 0,
    lastSentAt: new Date(),
    expiresAt,
  });

  // 5. Send real email via Nodemailer + Gmail SMTP
  try {
    await sendOtpEmail({
      to: normalizedEmail,
      otp: plainOtp,
      username,
      hotelName,
    });
  } catch (sendErr) {
    // If sending fails, delete the record so no ghost OTP exists
    await Otp.deleteOne({ _id: otpRecord._id });
    throw sendErr;
  }

  return {
    expiresAt,
    resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

/**
 * Verifies a submitted 6-digit code against the stored SHA-256 hash.
 * Single-use: automatically deleted on success.
 * Enforces max 5 attempts and expiry.
 *
 * @param {string} email - Recipient email
 * @param {string} purpose - Purpose
 * @param {string} code - Submitted 6-digit code
 * @returns {Promise<boolean>} true if verified
 */
async function verifyEmailOtp(email, purpose = 'registration', code) {
  const trimmedCode = String(code || '').trim();
  if (!trimmedCode || trimmedCode.length !== 6 || !/^\d{6}$/.test(trimmedCode)) {
    const err = new Error('Please enter a valid 6-digit verification code.');
    err.code = 'INVALID_FORMAT';
    throw err;
  }

  const normalizedEmail = String(email || '').trim().toLowerCase();
  const record = await Otp.findOne({ email: normalizedEmail, purpose }).sort({ createdAt: -1 });

  if (!record) {
    const err = new Error('No active verification code found. Please request a new code.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  // Check expiry
  if (record.expiresAt.getTime() < Date.now()) {
    await Otp.deleteMany({ email: normalizedEmail, purpose });
    const err = new Error('Verification code has expired. Please request a new one.');
    err.code = 'EXPIRED';
    throw err;
  }

  // Check maximum attempts
  if (record.attempts >= MAX_ATTEMPTS) {
    await Otp.deleteMany({ email: normalizedEmail, purpose });
    const err = new Error('Too many incorrect attempts. Please request a new verification code.');
    err.code = 'TOO_MANY_ATTEMPTS';
    throw err;
  }

  // Compare hashes
  const submittedHash = Otp.hashCode(trimmedCode);
  if (record.codeHash && record.codeHash === submittedHash) {
    // Single-use: delete immediately to prevent replay
    await Otp.deleteMany({ email: normalizedEmail, purpose });
    return true;
  } else {
    record.attempts += 1;
    await record.save();

    const attemptsRemaining = Math.max(0, MAX_ATTEMPTS - record.attempts);
    if (attemptsRemaining === 0) {
      await Otp.deleteMany({ email: normalizedEmail, purpose });
      const err = new Error('Too many incorrect attempts. Please request a new verification code.');
      err.code = 'TOO_MANY_ATTEMPTS';
      err.attemptsRemaining = 0;
      throw err;
    }

    const err = new Error(`Incorrect verification code. ${attemptsRemaining} attempt(s) remaining.`);
    err.code = 'INVALID';
    err.attemptsRemaining = attemptsRemaining;
    throw err;
  }
}

/**
 * Legacy phone OTP verification stub preserved for any legacy routes.
 */
async function verifyOtp(phone, purpose = 'registration', code) {
  if (!code || String(code).trim().length < 4) {
    const err = new Error('Please enter a valid OTP code.');
    err.code = 'INVALID';
    throw err;
  }

  const normalizedPhone = toDbPhone(phone);
  const record = await Otp.findOne({ phone: normalizedPhone, purpose }).sort({ createdAt: -1 });

  if (!record) {
    const err = new Error('No active OTP request found.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await Otp.deleteMany({ phone: normalizedPhone, purpose });
    const err = new Error('OTP has expired. Please request a new one.');
    err.code = 'EXPIRED';
    throw err;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await Otp.deleteMany({ phone: normalizedPhone, purpose });
    const err = new Error('Too many incorrect attempts. Please request a new OTP.');
    err.code = 'TOO_MANY_ATTEMPTS';
    throw err;
  }

  const submittedHash = Otp.hashCode(String(code).trim());
  if (record.codeHash && record.codeHash === submittedHash) {
    await Otp.deleteMany({ phone: normalizedPhone, purpose });
    return true;
  } else {
    record.attempts += 1;
    await record.save();
    const err = new Error('Incorrect OTP. Please check and try again.');
    err.code = 'INVALID';
    err.attemptsRemaining = Math.max(0, MAX_ATTEMPTS - record.attempts);
    throw err;
  }
}

module.exports = {
  generateSecureOtp,
  createAndSendEmailOtp,
  verifyEmailOtp,
  verifyOtp,
  toDbPhone,
  validateIndianMobile,
  EXPIRY_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  MAX_ATTEMPTS,
};
