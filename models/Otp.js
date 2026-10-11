const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * OTPs are never stored in plain text — only a SHA-256 hash — and the
 * document is auto-deleted by MongoDB's TTL index once `expiresAt` passes,
 * so nothing lingers in the database after expiry.
 */
const otpSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    purpose: {
      type: String,
      enum: ['registration', 'login'],
      default: 'registration',
    },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
  },
  { timestamps: true }
);

otpSchema.statics.hashCode = function (code) {
  return crypto.createHash('sha256').update(String(code)).digest('hex');
};

module.exports = mongoose.model('Otp', otpSchema);
