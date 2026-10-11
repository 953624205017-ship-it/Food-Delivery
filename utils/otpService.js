const crypto = require('crypto');
const Otp = require('../models/Otp');

const EXPIRY_MINUTES = Number(process.env.OTP_EXPIRY_MINUTES || 5);
const RESEND_COOLDOWN_SECONDS = Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

let twilioClient = null;
function getTwilioClient() {
  if (twilioClient) return twilioClient;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token || !sid.startsWith('AC')) {
    return null; // Not configured — caller falls back to console-log dev mode
  }
  // Lazy require so the app can boot without the twilio package configured
  const twilio = require('twilio');
  twilioClient = twilio(sid, token);
  return twilioClient;
}

function generateSixDigitCode() {
  // Cryptographically strong random 6-digit code
  return String(crypto.randomInt(100000, 999999));
}

/**
 * Sends (or resends) an OTP to a phone number.
 * Enforces a resend cooldown per phone number to rate-limit abuse.
 */
async function sendOtp(phone, purpose = 'registration') {
  const existing = await Otp.findOne({ phone, purpose }).sort({ createdAt: -1 });

  if (existing) {
    const secondsSinceLast = (Date.now() - existing.lastSentAt.getTime()) / 1000;
    if (secondsSinceLast < RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLast);
      const err = new Error(`Please wait ${wait}s before requesting another OTP.`);
      err.code = 'RATE_LIMITED';
      err.retryAfterSeconds = wait;
      throw err;
    }
    // Invalidate the previous OTP for this phone/purpose
    await Otp.deleteMany({ phone, purpose });
  }

  const code = generateSixDigitCode();
  const codeHash = Otp.hashCode(code);
  const expiresAt = new Date(Date.now() + EXPIRY_MINUTES * 60 * 1000);

  await Otp.create({ phone, purpose, codeHash, expiresAt, lastSentAt: new Date() });

  const client = getTwilioClient();
  if (client && process.env.TWILIO_VERIFY_SERVICE_SID) {
    // Preferred path: Twilio Verify API sends the SMS itself. We still keep
    // our own hashed record above so verification is self-contained and we
    // control expiry/attempt limits ourselves.
    await client.messages.create({
      to: phone,
      // NOTE: if using Twilio Verify's own OTP generation instead of ours,
      // swap this block for client.verify.v2.services(sid).verifications.create(...)
      messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || undefined,
      from: process.env.TWILIO_FROM_NUMBER || undefined,
      body: `${process.env.HOTEL_NAME || 'Hotel Little Jappan'}: Your OTP is ${code}. It expires in ${EXPIRY_MINUTES} minutes. Do not share this code.`,
    });
  } else {
    // Dev fallback — no Twilio credentials configured yet.
    console.log(`[otpService] (DEV MODE — no Twilio configured) OTP for ${phone}: ${code}`);
  }

  return { expiresAt, resendAvailableInSeconds: RESEND_COOLDOWN_SECONDS };
}

/**
 * Verifies a submitted OTP code against the stored hash.
 * Deletes the record on success; increments attempts on failure and
 * deletes it once MAX_ATTEMPTS is exceeded to force a fresh resend.
 */
async function verifyOtp(phone, purpose, code) {
  const record = await Otp.findOne({ phone, purpose }).sort({ createdAt: -1 });

  if (!record) {
    const err = new Error('No OTP request found. Please request a new OTP.');
    err.code = 'NOT_FOUND';
    throw err;
  }

  if (record.expiresAt.getTime() < Date.now()) {
    await Otp.deleteMany({ phone, purpose });
    const err = new Error('OTP has expired. Please request a new one.');
    err.code = 'EXPIRED';
    throw err;
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    await Otp.deleteMany({ phone, purpose });
    const err = new Error('Too many incorrect attempts. Please request a new OTP.');
    err.code = 'TOO_MANY_ATTEMPTS';
    throw err;
  }

  const submittedHash = Otp.hashCode(code);
  if (submittedHash !== record.codeHash) {
    record.attempts += 1;
    await record.save();
    const err = new Error('Incorrect OTP.');
    err.code = 'INVALID';
    err.attemptsRemaining = MAX_ATTEMPTS - record.attempts;
    throw err;
  }

  // Success — OTP is single-use, delete immediately.
  await Otp.deleteMany({ phone, purpose });
  return true;
}

module.exports = { sendOtp, verifyOtp };
