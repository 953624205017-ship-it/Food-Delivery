const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema(
  {
    food: { type: mongoose.Schema.Types.ObjectId, ref: 'Food', required: true },
    name: { type: String, required: true }, // snapshot at order time
    image: { type: String },
    unitPrice: { type: Number, required: true }, // snapshot, server-computed
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true },
  },
  { _id: false }
);

const addressSnapshotSchema = new mongoose.Schema(
  {
    address: String,
    street: String,
    village: String,
    pincode: String,
    latitude: Number,
    longitude: Number,
    formattedAddress: String,
    district: String,
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    provider: { type: String, default: 'cod' },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    razorpaySignature: String,
    amount: Number,
    status: {
      type: String,
      enum: ['created', 'paid', 'failed', 'refunded', 'pending', 'pending_verification'],
      default: 'created',
    },
    paidAt: Date,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    totalAmount: { type: Number, required: true },

    deliveryAddress: { type: addressSnapshotSchema, required: true },
    distanceKm: { type: Number },
    eligibilityZoneLabel: { type: String },

    payment: { type: paymentSchema, default: () => ({}) },

    status: {
      type: String,
      enum: [
        'PENDING_PAYMENT',
        'PAYMENT_VERIFICATION_PENDING',
        'PLACED',
        'PAID',
        'ACCEPTED',
        'REJECTED',
        'PREPARING',
        'READY',
        'OUT_FOR_DELIVERY',
        'DELIVERED',
        'CANCELLED',
      ],
      default: 'PENDING_PAYMENT',
    },

    rejectionReason: { type: String, default: '' },
    ownerNotified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ status: 1 });

module.exports = mongoose.model('Order', orderSchema);
