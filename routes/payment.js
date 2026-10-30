const express = require('express');
const asyncHandler = require('express-async-handler');
const QRCode = require('qrcode');

const Order = require('../models/Order');
const { requireAuth } = require('../middleware/auth');
const { sendOrderNotificationEmail } = require('../utils/emailService');

const router = express.Router();

// ============================================================
// UPI — get QR code & payment details
// Changed to GET so cart.ejs can use apiGet()
// ============================================================
router.get(
  '/api/payment/upi/details',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { orderId } = req.query;
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
        message: 'UPI payment is currently unavailable. Please choose Cash on Delivery.',
      });
    }

    const amount = Number(order.totalAmount).toFixed(2);
    const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(upiName)}&am=${encodeURIComponent(amount)}&cu=INR`;

    try {
      const qrCodeDataUrl = await QRCode.toDataURL(upiUri, {
        margin: 2,
        width: 220,
        color: { dark: '#17130F', light: '#FFFFFF' },
      });

      return res.json({
        success: true,
        upiAvailable: true,
        upiId,
        upiName,
        amount: order.totalAmount,
        upiUri,
        qrCodeDataUrl,
      });
    } catch (err) {
      console.error('[payment] UPI QR generation error:', err.name, err.message);
      return res.status(500).json({ success: false, message: 'Failed to generate UPI QR code.' });
    }
  })
);

// ============================================================
// UPI — customer confirms they have paid (manual verification)
// ============================================================
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

    order.payment.provider = 'upi';
    order.payment.status = 'pending_verification';
    order.payment.amount = order.totalAmount;
    order.status = 'PAYMENT_VERIFICATION_PENDING';
    order.ownerNotified = true;
    await order.save();

    sendOrderNotificationEmail({ order, user: req.user, type: 'ORDER_PLACED' }).catch(() => {});

    return res.json({
      success: true,
      orderId: String(order._id),
      paymentMethod: 'upi',
      status: 'PAYMENT_VERIFICATION_PENDING',
      redirect: `/order/${order._id}/confirmation`,
    });
  })
);

// ============================================================
// COD — place order with cash on delivery
// ============================================================
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

    order.payment.provider = 'cod';
    order.payment.status = 'pending';
    order.payment.amount = order.totalAmount;
    order.status = 'PLACED';
    order.ownerNotified = true;
    await order.save();

    sendOrderNotificationEmail({ order, user: req.user, type: 'ORDER_PLACED' }).catch(() => {});

    return res.json({
      success: true,
      orderId: String(order._id),
      paymentMethod: 'cod',
      status: 'PLACED',
      redirect: `/order/${order._id}/confirmation`,
    });
  })
);

module.exports = router;
