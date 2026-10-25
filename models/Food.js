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
    isVeg: { type: Boolean, default: false }, // Vegetarian flag
    rating: { type: Number, default: 0, min: 0, max: 5 }, // Average rating (0-5)
    totalReviews: { type: Number, default: 0, min: 0 }, // Review count
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin' },
  },
  { timestamps: true }
);

foodSchema.index({ name: 'text', description: 'text', category: 'text' });
foodSchema.index({ available: 1, price: 1 });
foodSchema.index({ isVeg: 1 });
foodSchema.index({ rating: -1 });

// Never trust a client-sent price — always re-fetch from this collection
// server-side when computing an order total (see utils/pricing.js).
module.exports = mongoose.model('Food', foodSchema);
