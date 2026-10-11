const crypto = require('crypto');

let razorpayInstance = null;
function getRazorpay() {
  if (razorpayInstance) return razorpayInstance;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_id || !key_secret) {
    const err = new Error('Payment gateway is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing).');
    err.code = 'PAYMENT_NOT_CONFIGURED';
    throw err;
  }
  const Razorpay = require('razorpay');
  razorpayInstance = new Razorpay({ key_id, key_secret });
  return razorpayInstance;
}

/**
 * Creates a Razorpay order for the given amount (in rupees).
 * The amount MUST already be the server-computed total — never a
 * client-supplied figure.
 */
async function createPaymentOrder({ amountRupees, receipt, notes }) {
  const instance = getRazorpay();
  const order = await instance.orders.create({
    amount: Math.round(amountRupees * 100), // paise
    currency: 'INR',
    receipt,
    notes,
  });
  return order;
}

/**
 * Verifies the HMAC signature Razorpay returns after checkout, using the
 * secret key — this is the ONLY way an order may be marked PAID. The
 * frontend's "success" callback is never trusted on its own.
 */
function verifyPaymentSignature({ razorpayOrderId, razorpayPaymentId, razorpaySignature }) {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    const err = new Error('Payment gateway is not configured.');
    err.code = 'PAYMENT_NOT_CONFIGURED';
    throw err;
  }
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');

  return expectedSignature === razorpaySignature;
}

module.exports = { createPaymentOrder, verifyPaymentSignature, getRazorpay };
