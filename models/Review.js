const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    food: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Food',
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
    },
    rating: {
      type: Number,
      required: [true, 'Rating is required (1-5)'],
      min: [1, 'Minimum rating is 1'],
      max: [5, 'Maximum rating is 5'],
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, 'Review comment cannot exceed 500 characters'],
      default: '',
    },
    status: {
      type: String,
      enum: ['approved', 'hidden'],
      default: 'approved',
      index: true,
    },
  },
  { timestamps: true }
);

// One review per user per food item
reviewSchema.index({ food: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);

