const express = require('express');
const asyncHandler = require('express-async-handler');
const QRCode = require('qrcode');

const Order = require('../models/Order');
const { requireAuth } = require('../middleware/auth');
const { createPaymentOrder, verifyPaymentSignature } = require('../utils/paymentService');
const { sendOrderNotificationEmail } = require('../utils/emailService');

const router = express.Router();

// ---------- Step 1: create a Razorpay order for an existing Order ----------
router.post(
  '/api/payment/create',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId } = req.body;
    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ success: false, message: 'This order is not awaiting payment.' });
    }

    let rzpOrder;
    try {
      // Amount comes from the ORDER document (server-computed at creation
      // time), never recomputed from anything the client sends here.
      rzpOrder = await createPaymentOrder({
        amountRupees: order.totalAmount,
        receipt: String(order._id),
        notes: { orderId: String(order._id), userId: String(req.user._id) },
      });
    } catch (err) {
      if (err.code === 'PAYMENT_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, message: 'Online payment is temporarily unavailable. Please try again shortly.' });
      }
      console.error('[payment] Razorpay create order error:', err);
      return res.status(503).json({
        success: false,
        message: 'Online payment gateway is temporarily unreachable. Please select Cash on Delivery or try again.',
      });
    }

    order.payment.provider = 'razorpay';
    order.payment.razorpayOrderId = rzpOrder.id;
    order.payment.amount = order.totalAmount;
    order.payment.status = 'created';
    await order.save();

    res.json({
      success: true,
      razorpayOrderId: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      hotelName: process.env.HOTEL_NAME || 'Hotel Little Jappan',
      userName: req.user.username,
      userPhone: req.user.phone,
    });
  })
);

// ---------- Cash on Delivery (COD) payment ----------
router.post(
  '/api/payment/cod',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required.' });
    }

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ success: false, message: 'This order is not awaiting payment.' });
    }

    // Re-use existing Order document; totals were validated server-side at creation time
    order.payment.provider = 'cod';
    order.payment.status = 'pending';
    order.payment.amount = order.totalAmount;
    order.status = 'PLACED';
    order.ownerNotified = true;

    await order.save();

    // Send order confirmation email asynchronously
    sendOrderNotificationEmail({ order, user: req.user, type: 'ORDER_PLACED' }).catch(() => {});

    res.json({
      success: true,
      orderId: String(order._id),
      paymentMethod: 'cod',
      status: 'PLACED',
      redirect: `/order/${order._id}/confirmation`,
    });
  })
);

// ---------- UPI details & QR code generation ----------
router.post(
  '/api/payment/upi/details',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required.' });
    }

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ success: false, message: 'This order is not awaiting payment.' });
    }

    const upiId = (process.env.UPI_ID || '').trim();
    const upiName = (process.env.UPI_NAME || process.env.HOTEL_NAME || 'Hotel Little Jappan').trim();

    if (!upiId) {
      return res.status(503).json({
        success: false,
        upiAvailable: false,
        message: 'UPI payment is currently unavailable.',
      });
    }

    // Build standard UPI URL with proper parameter encoding
    const amount = Number(order.totalAmount).toFixed(2);
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${encodeURIComponent(amount)}&cu=INR`;

    try {
      const qrCode = await QRCode.toDataURL(upiUri, {
        margin: 2,
        width: 220,
        color: {
          dark: '#17130F',
          light: '#FFFFFF',
        },
      });

      res.json({
        success: true,
        upiAvailable: true,
        upiId,
        upiName,
        amount: order.totalAmount,
        upiUri,
        qrCode,
      });
    } catch (err) {
      console.error('[payment] UPI QR generation error:', err);
      res.status(500).json({ success: false, message: 'Failed to generate UPI QR code.' });
    }
  })
);

// ---------- UPI manual payment confirmation ----------
router.post(
  '/api/payment/upi/confirm',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ success: false, message: 'Order ID is required.' });
    }

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    if (order.status !== 'PENDING_PAYMENT') {
      return res.status(409).json({ success: false, message: 'This order is not awaiting payment.' });
    }

    // Read amount from MongoDB, do NOT trust client amount
    order.payment.provider = 'upi';
    order.payment.status = 'pending_verification';
    order.payment.amount = order.totalAmount;
    order.status = 'PAYMENT_VERIFICATION_PENDING';
    order.ownerNotified = true;

    await order.save();

    // Send order confirmation email asynchronously
    sendOrderNotificationEmail({
      order,
      user: req.user,
      type: 'ORDER_PLACED',
      customMessage: 'We received your UPI payment confirmation request. Our kitchen will verify and start preparing your meal.'
    }).catch(() => {});

    res.json({
      success: true,
      orderId: String(order._id),
      paymentMethod: 'upi',
      paymentStatus: 'pending_verification',
      status: 'PAYMENT_VERIFICATION_PENDING',
      redirect: `/order/${order._id}/confirmation`,
    });
  })
);

// ---------- Step 2: verify payment signature server-side, mark PAID ----------
router.post(
  '/api/payment/verify',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const order = await Order.findOne({ _id: orderId, user: req.user._id });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.payment.razorpayOrderId !== razorpay_order_id) {
      return res.status(400).json({ success: false, message: 'Payment/order mismatch.' });
    }

    let valid;
    try {
      valid = verifyPaymentSignature({
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
      });
    } catch (err) {
      if (err.code === 'PAYMENT_NOT_CONFIGURED') {
        return res.status(503).json({ success: false, message: 'Payment verification is temporarily unavailable.' });
      }
      throw err;
    }

    if (!valid) {
      order.payment.status = 'failed';
      await order.save();
      return res.status(400).json({ success: false, message: 'Payment verification failed. If money was deducted, it will be refunded automatically.' });
    }

    // Guard against double-processing (e.g. duplicate verify calls)
    if (order.status === 'PENDING_PAYMENT') {
      order.payment.razorpayPaymentId = razorpay_payment_id;
      order.payment.razorpaySignature = razorpay_signature;
      order.payment.status = 'paid';
      order.payment.paidAt = new Date();
      order.status = 'PAID';
      await order.save();

      // Owner notification (in-app/order-queue record). A real deployment
      // would also push this via SMS/WhatsApp/websocket to the admin panel.
      order.ownerNotified = true;
      await order.save();

      // Send payment confirmation email asynchronously
      sendOrderNotificationEmail({ order, user: req.user, type: 'PAYMENT_CONFIRMED' }).catch(() => {});
    }

    res.json({
      success: true,
      orderId: order._id,
      amount: order.totalAmount,
      ownerPhone: process.env.OWNER_PHONE || '',
      redirect: `/order/${order._id}/confirmation`,
    });
  })
);

module.exports = router;
