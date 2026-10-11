const mongoose = require('mongoose');

const foodSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    image: { type: String, default: '/images/food-placeholder.svg' },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative'],
    },
    available: { type: Boolean, default: true },
    category: { type: String, trim: true, default: 'General' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

// Never trust a client-sent price — always re-fetch from this collection
// server-side when computing an order total (see utils/pricing.js).
module.exports = mongoose.model('Food', foodSchema);
