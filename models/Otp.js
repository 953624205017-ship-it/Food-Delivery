const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * OTPs are never stored in plain text — only a SHA-256 hash — and the
 * document is auto-deleted by MongoDB's TTL index once `expiresAt` passes,
 * so nothing lingers in the database after expiry.
 *
 * Supports both Email and Phone OTP verification.
 */
const otpSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      trim: true,
      lowercase: true,
      index: true,
    },
    phone: {
      type: String,
      trim: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ['registration', 'login', 'verification', 'password_reset'],
      default: 'registration',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    lastSentAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  { timestamps: true }
);

// Hash an OTP code with SHA-256
otpSchema.statics.hashCode = function (code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
};

module.exports = mongoose.model('Otp', otpSchema);
