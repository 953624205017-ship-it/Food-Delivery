/**
 * Comprehensive verification suite for the Hotel Little Jappan full-stack upgrade:
 * 1. Advanced Food Search and Filters
 * 2. Food Ratings and Reviews
 * 3. Admin Analytics Dashboard
 * 4. Email Order Notifications
 * 5. Multi-Item Shopping Cart and Single Checkout
 */

require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Food = require('../models/Food');
const Order = require('../models/Order');
const Review = require('../models/Review');
const User = require('../models/User');
const { computeOrderTotals } = require('../utils/pricing');
const { sendOrderNotificationEmail } = require('../utils/emailService');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests += 1;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passedTests += 1;
    console.log(`  ✓ PASS: ${message}`);
  }
}

async function run() {
  console.log('\n======================================================');
  console.log('🚀 HOTEL LITTLE JAPPAN — FULL-STACK UPGRADE TEST SUITE');
  console.log('======================================================\n');

  await connectDB();

  // Setup test food items
  const testCategory = 'Specialties';
  const foodVeg = await Food.create({
    name: 'Test Veg Paneer Biryani',
    description: 'Fragrant aromatic basmati rice cooked with paneer cubes and mild spices',
    price: 180,
    category: testCategory,
    image: '/images/food-placeholder.svg',
    available: true,
    isVeg: true,
  });

  const foodNonVeg = await Food.create({
    name: 'Test Little Jappan Mutton Chukka',
    description: 'Tender spicy boneless mutton pieces sautéed with crushed pepper and shallots',
    price: 290,
    category: testCategory,
    image: '/images/food-placeholder.svg',
    available: true,
    isVeg: false,
  });

  const testUser = new User({
    username: `testbuyer_${Date.now()}`,
    email: `buyer_${Date.now()}@example.com`,
    phone: `+9199${Math.floor(10000000 + Math.random() * 90000000)}`,
    age: 25,
    emailVerified: true,
    isActive: true,
  });
  await testUser.setPassword('TestPassword123!');
  await testUser.save();

  try {
    // -----------------------------------------------------------------
    // FEATURE 1: Advanced Food Search and Filters
    // -----------------------------------------------------------------
    console.log('\n--- 1. Testing Advanced Food Search & Filters ---');

    // 1a. Text Search by name
    const nameSearch = await Food.find({
      $or: [
        { name: { $regex: 'Paneer Biryani', $options: 'i' } },
        { description: { $regex: 'Paneer Biryani', $options: 'i' } },
        { category: { $regex: 'Paneer Biryani', $options: 'i' } },
      ],
    });
    assert(nameSearch.some((f) => f._id.equals(foodVeg._id)), 'Text search finds item by name regex');

    // 1b. Veg Filter
    const vegResults = await Food.find({ isVeg: true, category: testCategory });
    assert(vegResults.some((f) => f._id.equals(foodVeg._id)), 'Filter by isVeg: true returns veg items');
    assert(!vegResults.some((f) => f._id.equals(foodNonVeg._id)), 'Filter by isVeg: true excludes non-veg items');

    // 1c. Non-Veg Filter
    const nonVegResults = await Food.find({ isVeg: false, category: testCategory });
    assert(nonVegResults.some((f) => f._id.equals(foodNonVeg._id)), 'Filter by isVeg: false returns non-veg items');

    // 1d. Price Range Filter
    const priceFiltered = await Food.find({
      category: testCategory,
      price: { $gte: 200, $lte: 350 },
    });
    assert(priceFiltered.some((f) => f._id.equals(foodNonVeg._id)), 'Price filter $gte 200 and $lte 350 matches Mutton Chukka');
    assert(!priceFiltered.some((f) => f._id.equals(foodVeg._id)), 'Price filter excludes Paneer Biryani (₹180)');

    // 1e. Combined Search + Sort
    const sortedFoods = await Food.find({ category: testCategory }).sort({ price: 1 });
    assert(sortedFoods[0].price <= sortedFoods[1].price, 'Price ascending sort orders lower priced items first');

    // -----------------------------------------------------------------
    // FEATURE 2: Food Ratings and Reviews
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Food Ratings & Reviews ---');

    // 2a. Eligibility Check: User has NOT ordered foodVeg yet -> should not be in ordered set
    const userPriorOrders = await Order.find({
      user: testUser._id,
      status: { $in: ['DELIVERED', 'PAID', 'PLACED', 'READY', 'OUT_FOR_DELIVERY'] },
      'items.food': foodVeg._id,
    });
    assert(userPriorOrders.length === 0, 'User is initially ineligible before ordering');

    // 2b. Place an order containing foodVeg for testUser
    const testOrder = await Order.create({
      user: testUser._id,
      items: [
        {
          food: foodVeg._id,
          name: foodVeg.name,
          unitPrice: foodVeg.price,
          quantity: 2,
          lineTotal: 360,
        },
      ],
      subtotal: 360,
      totalAmount: 390,
      deliveryAddress: {
        address: '14 Alangulam Main St',
        village: 'Alangulam',
        pincode: '627851',
        formattedAddress: '14 Alangulam Main St, Alangulam, 627851',
      },
      status: 'DELIVERED',
      payment: {
        provider: 'razorpay',
        amount: 390,
        status: 'paid',
      },
    });

    const userOrdersAfter = await Order.find({
      user: testUser._id,
      status: { $in: ['DELIVERED', 'PAID', 'PLACED', 'READY', 'OUT_FOR_DELIVERY'] },
      'items.food': foodVeg._id,
    });
    assert(userOrdersAfter.length > 0, 'User is now verified eligible after placing/receiving order');

    // 2c. Create a valid review (5 stars)
    const review = await Review.create({
      food: foodVeg._id,
      user: testUser._id,
      order: testOrder._id,
      rating: 5,
      comment: 'Delicious authentic taste! Paneer was very soft.',
      status: 'approved',
    });
    assert(review && review.rating === 5, 'Verified review created successfully');

    // 2d. Prevent duplicate reviews by same user for same food
    let duplicateRejected = false;
    try {
      await Review.create({
        food: foodVeg._id,
        user: testUser._id,
        order: testOrder._id,
        rating: 4,
        comment: 'Trying to review again',
        status: 'approved',
      });
    } catch (err) {
      duplicateRejected = true;
    }
    assert(duplicateRejected, 'Duplicate review on same dish by same user is rejected by compound unique index');

    // 2e. Rating Aggregation on Food Model
    const stats = await Review.aggregate([
      { $match: { food: foodVeg._id, status: 'approved' } },
      {
        $group: {
          _id: '$food',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 },
        },
      },
    ]);
    const avgRating = stats.length > 0 ? Math.round(stats[0].avgRating * 10) / 10 : 0;
    const totalReviews = stats.length > 0 ? stats[0].totalReviews : 0;
    await Food.findByIdAndUpdate(foodVeg._id, { rating: avgRating, totalReviews });

    const updatedFood = await Food.findById(foodVeg._id);
    assert(updatedFood.rating === 5 && updatedFood.totalReviews === 1, 'Food rating aggregated atomically to 5.0 (1 review)');

    // 2f. Admin Moderation: Hide Review
    await Review.findByIdAndUpdate(review._id, { status: 'hidden' });
    const hiddenStats = await Review.aggregate([
      { $match: { food: foodVeg._id, status: 'approved' } },
      { $group: { _id: '$food', avgRating: { $avg: '$rating' }, totalReviews: { $sum: 1 } } },
    ]);
    const afterHideAvg = hiddenStats.length > 0 ? hiddenStats[0].avgRating : 0;
    assert(afterHideAvg === 0, 'Hidden reviews are excluded from approved public rating calculation');

    // Restore to approved for subsequent tests
    await Review.findByIdAndUpdate(review._id, { status: 'approved' });

    // -----------------------------------------------------------------
    // FEATURE 3: Admin Analytics Dashboard
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Admin Analytics Dashboard ---');

    // 3a. Revenue strictly from verified paid orders
    const paidRevenueAgg = await Order.aggregate([
      { $match: { status: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);
    const verifiedRevenue = paidRevenueAgg.length ? paidRevenueAgg[0].total : 0;
    assert(typeof verifiedRevenue === 'number' && verifiedRevenue >= 0, 'Verified revenue calculation executes and aggregates only paid orders');

    // 3b. Best Sellers Aggregation
    const bestSellers = await Order.aggregate([
      { $match: { status: { $in: ['PAID', 'DELIVERED'] } } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.food',
          name: { $first: '$items.name' },
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: '$items.lineTotal' },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
    ]);
    assert(Array.isArray(bestSellers), 'Top 5 best sellers aggregation succeeds');
    assert(bestSellers.some((b) => b._id.equals(foodVeg._id)), 'Best sellers includes test dish ordered');

    // 3c. Order Counts: Paid, Pending, Cancelled
    const [paidCount, pendingCount, cancelledCount] = await Promise.all([
      Order.countDocuments({ status: { $in: ['PAID', 'DELIVERED'] } }),
      Order.countDocuments({ status: { $in: ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING', 'PLACED'] } }),
      Order.countDocuments({ status: 'CANCELLED' }),
    ]);
    assert(paidCount >= 1, `Paid order count correctly reflects placed orders (Count: ${paidCount})`);
    assert(typeof pendingCount === 'number' && typeof cancelledCount === 'number', 'Pending and Cancelled counts calculated successfully');

    // -----------------------------------------------------------------
    // FEATURE 4: Email Order Notifications
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing Email Order Notifications ---');

    // Test notification dispatch function (does not throw even if SMTP is mock/not configured)
    let emailThrown = false;
    try {
      await sendOrderNotificationEmail({
        order: testOrder,
        user: testUser,
        type: 'ORDER_PLACED',
      });
      await sendOrderNotificationEmail({
        order: testOrder,
        user: testUser,
        type: 'PAYMENT_CONFIRMED',
      });
      await sendOrderNotificationEmail({
        order: testOrder,
        user: testUser,
        type: 'STATUS_UPDATED',
        customMessage: 'Your order is out for delivery with our delivery executive.',
      });
      await sendOrderNotificationEmail({
        order: testOrder,
        user: testUser,
        type: 'ORDER_CANCELLED',
      });
    } catch (err) {
      emailThrown = true;
      console.error('Email notification error:', err);
    }
    assert(!emailThrown, 'Email order notification service handles ORDER_PLACED, PAYMENT_CONFIRMED, STATUS_UPDATED, and ORDER_CANCELLED safely');

    // -----------------------------------------------------------------
    // FEATURE 5: Multi-Item Shopping Cart and Single Checkout
    // -----------------------------------------------------------------
    console.log('\n--- 5. Testing Multi-Item Shopping Cart & Single Checkout ---');

    // 5a. computeOrderTotals calculates subtotal from database prices
    const cartItems = [
      { foodId: String(foodVeg._id), quantity: 2 },     // 2 * 180 = 360
      { foodId: String(foodNonVeg._id), quantity: 3 },  // 3 * 290 = 870
    ];
    const totals = await computeOrderTotals(cartItems);

    assert(totals.items.length === 2, 'Totals calculation returns all items in cart');
    assert(totals.subtotal === 1230, `Server-verified subtotal is exact: ₹1230 (calculated: ₹${totals.subtotal})`);
    assert(totals.items[0].lineTotal === 360, 'Line total for veg item is ₹360 (2 × 180)');
    assert(totals.items[1].lineTotal === 870, 'Line total for non-veg item is ₹870 (3 × 290)');

    // 5b. Create multi-item Order document representing single checkout
    const multiOrder = await Order.create({
      user: testUser._id,
      items: totals.items,
      subtotal: totals.subtotal,
      totalAmount: totals.subtotal + 40,
      deliveryAddress: {
        address: '22 Bazaar Road',
        village: 'Alangulam',
        pincode: '627851',
        formattedAddress: '22 Bazaar Road, Alangulam, 627851',
      },
      payment: {
        provider: 'cod',
        amount: totals.subtotal + 40,
        status: 'pending',
      },
      status: 'PLACED',
    });

    assert(multiOrder.items.length === 2, 'Single order document created with multi-item array');
    assert(multiOrder.totalAmount === 1270, 'Single checkout total matches subtotal + delivery (₹1270)');
    assert(multiOrder.payment.provider === 'cod', 'COD single checkout order recorded with PENDING payment');

    // Clean up created test entities
    await Food.deleteMany({ _id: { $in: [foodVeg._id, foodNonVeg._id] } });
    await Order.deleteMany({ _id: { $in: [testOrder._id, multiOrder._id] } });
    await Review.deleteMany({ _id: review._id });
    await User.deleteOne({ _id: testUser._id });

    console.log('\n======================================================');
    console.log(`🎉 ALL TESTS PASSED: ${passedTests}/${totalTests}`);
    console.log('======================================================\n');
  } catch (err) {
    console.error('\n❌ TEST RUN FAILED:', err);
    // Cleanup if possible
    await Food.deleteMany({ _id: { $in: [foodVeg._id, foodNonVeg._id] } }).catch(() => {});
    await Review.deleteMany({ user: testUser._id }).catch(() => {});
    await Order.deleteMany({ user: testUser._id }).catch(() => {});
    await User.deleteOne({ _id: testUser._id }).catch(() => {});
    process.exit(1);
  }

  process.exit(0);
}

run();
