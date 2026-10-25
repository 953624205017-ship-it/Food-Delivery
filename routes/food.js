const express = require('express');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Food = require('../models/Food');
const Order = require('../models/Order');
const Review = require('../models/Review');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /dashboard
 * Displays food menu with search, category filtering, veg/non-veg filter,
 * price range filter, and sorting.
 */
router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { q, search, category, veg, minPrice, maxPrice, sortBy } = req.query;
    const searchTerm = (search || q || '').trim();

    // 1. Build safe query filter
    const filter = {};

    if (searchTerm) {
      const escaped = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { category: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (veg === 'veg') {
      filter.isVeg = true;
    } else if (veg === 'non-veg') {
      filter.isVeg = false;
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice && !isNaN(Number(minPrice))) {
        filter.price.$gte = Number(minPrice);
      }
      if (maxPrice && !isNaN(Number(maxPrice))) {
        filter.price.$lte = Number(maxPrice);
      }
    }

    // 2. Determine sort order
    let sort = { available: -1, createdAt: -1 };
    if (sortBy === 'price_asc') {
      sort = { available: -1, price: 1, name: 1 };
    } else if (sortBy === 'price_desc') {
      sort = { available: -1, price: -1, name: 1 };
    } else if (sortBy === 'rating') {
      sort = { available: -1, rating: -1, totalReviews: -1 };
    } else if (sortBy === 'popularity') {
      sort = { available: -1, totalReviews: -1, rating: -1 };
    }

    // 3. Query foods & categories in parallel
    const [foods, allCategories] = await Promise.all([
      Food.find(filter).sort(sort),
      Food.distinct('category'),
    ]);

    // Check which foods the logged in user has purchased so we can display review buttons
    let reviewedFoodIds = new Set();
    let eligibleFoodIds = new Set();

    if (req.user) {
      const [userReviews, userOrders] = await Promise.all([
        Review.find({ user: req.user._id }).select('food'),
        Order.find({
          user: req.user._id,
          status: { $in: ['DELIVERED', 'PAID', 'PLACED', 'READY', 'OUT_FOR_DELIVERY'] },
        }).select('items.food'),
      ]);

      reviewedFoodIds = new Set(userReviews.map((r) => String(r.food)));
      userOrders.forEach((o) => {
        (o.items || []).forEach((item) => eligibleFoodIds.add(String(item.food)));
      });
    }

    res.render('dashboard', {
      title: 'Dashboard',
      foods,
      categories: allCategories.filter(Boolean),
      activeFilters: {
        search: searchTerm,
        category: category || 'All',
        veg: veg || 'all',
        minPrice: minPrice || '',
        maxPrice: maxPrice || '',
        sortBy: sortBy || 'featured',
      },
      reviewedFoodIds,
      eligibleFoodIds,
    });
  })
);

/**
 * GET /api/foods
 * API endpoint returning food list with filter parameters.
 */
router.get(
  '/api/foods',
  asyncHandler(async (req, res) => {
    const { search, category, veg, minPrice, maxPrice, sortBy } = req.query;
    const filter = {};

    if (search && search.trim()) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { description: { $regex: escaped, $options: 'i' } },
        { category: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (category && category !== 'All') {
      filter.category = category;
    }

    if (veg === 'veg') {
      filter.isVeg = true;
    } else if (veg === 'non-veg') {
      filter.isVeg = false;
    }

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice && !isNaN(Number(minPrice))) filter.price.$gte = Number(minPrice);
      if (maxPrice && !isNaN(Number(maxPrice))) filter.price.$lte = Number(maxPrice);
    }

    let sort = { available: -1, createdAt: -1 };
    if (sortBy === 'price_asc') sort = { available: -1, price: 1 };
    else if (sortBy === 'price_desc') sort = { available: -1, price: -1 };
    else if (sortBy === 'rating') sort = { available: -1, rating: -1 };

    const foods = await Food.find(filter).sort(sort);
    res.json({ success: true, count: foods.length, foods });
  })
);

/**
 * GET /api/foods/:id/reviews
 * Retrieves approved customer reviews for a food item.
 */
router.get(
  '/api/foods/:id/reviews',
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid food item ID.' });
    }

    const food = await Food.findById(req.params.id);
    if (!food) {
      return res.status(404).json({ success: false, message: 'Food item not found.' });
    }

    const reviews = await Review.find({ food: food._id, status: 'approved' })
      .populate('user', 'username')
      .sort({ createdAt: -1 })
      .limit(50);

    let canReview = false;
    let hasReviewed = false;

    if (req.user) {
      const existingReview = await Review.findOne({ food: food._id, user: req.user._id });
      hasReviewed = Boolean(existingReview);

      if (!hasReviewed) {
        const order = await Order.findOne({
          user: req.user._id,
          status: { $in: ['DELIVERED', 'PAID', 'PLACED', 'READY', 'OUT_FOR_DELIVERY'] },
          'items.food': food._id,
        });
        canReview = Boolean(order);
      }
    }

    res.json({
      success: true,
      foodId: food._id,
      foodName: food.name,
      rating: food.rating || 0,
      totalReviews: food.totalReviews || 0,
      reviews,
      canReview,
      hasReviewed,
    });
  })
);

/**
 * POST /api/foods/:id/reviews
 * Creates a rating and review for an ordered food item.
 */
router.post(
  '/api/foods/:id/reviews',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid food item ID.' });
    }

    const food = await Food.findById(req.params.id);
    if (!food) {
      return res.status(404).json({ success: false, message: 'Food item not found.' });
    }

    const rating = parseInt(req.body.rating, 10);
    const comment = String(req.body.comment || '').trim();

    if (!rating || isNaN(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5 stars.' });
    }

    if (comment.length > 500) {
      return res.status(400).json({ success: false, message: 'Comment cannot exceed 500 characters.' });
    }

    // 1. Verify that user actually ordered and received this food item
    const qualifyingOrder = await Order.findOne({
      user: req.user._id,
      status: { $in: ['DELIVERED', 'PAID', 'PLACED', 'READY', 'OUT_FOR_DELIVERY'] },
      'items.food': food._id,
    });

    if (!qualifyingOrder) {
      return res.status(403).json({
        success: false,
        message: 'You can only review food items you have previously ordered and received.',
      });
    }

    // 2. Prevent duplicate reviews by the same user
    const existingReview = await Review.findOne({ food: food._id, user: req.user._id });
    if (existingReview) {
      return res.status(409).json({
        success: false,
        message: 'You have already reviewed this food item.',
      });
    }

    // 3. Create review
    const review = await Review.create({
      food: food._id,
      user: req.user._id,
      order: qualifyingOrder._id,
      rating,
      comment,
      status: 'approved',
    });

    // 4. Recalculate average rating & review count on food document
    const stats = await Review.aggregate([
      { $match: { food: food._id, status: 'approved' } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    food.rating = stats[0] ? Math.round(stats[0].avgRating * 10) / 10 : rating;
    food.totalReviews = stats[0] ? stats[0].count : 1;
    await food.save();

    res.json({
      success: true,
      message: 'Thank you! Your review has been published.',
      review: {
        id: review._id,
        rating: review.rating,
        comment: review.comment,
        createdAt: review.createdAt,
      },
      updatedRating: food.rating,
      updatedTotalReviews: food.totalReviews,
    });
  })
);

module.exports = router;
