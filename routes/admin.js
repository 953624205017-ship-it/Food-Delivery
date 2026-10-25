const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Admin = require('../models/Admin');
const Food = require('../models/Food');
const Order = require('../models/Order');
const Review = require('../models/Review');
const DeliveryZone = require('../models/DeliveryZone');
const { requireAdmin } = require('../middleware/adminAuth');
const { authLimiter } = require('../middleware/rateLimiter');
const { sendOrderNotificationEmail } = require('../utils/emailService');

const router = express.Router();

// ---------- Image upload config ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, '-')}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|webp/.test(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only JPG, PNG, or WEBP images are allowed.'), ok);
  },
});

function issueAdminToken(res, admin) {
  const token = jwt.sign({ id: admin._id }, process.env.JWT_SECRET, {
    expiresIn: '12h',
    audience: 'admin',
  });
  res.cookie('admin_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 12 * 60 * 60 * 1000,
  });
}

// ---------- Admin auth ----------
router.get('/admin/login', (req, res) => res.render('admin/login', { title: 'Admin Login' }));

router.post(
  '/api/admin/login',
  authLimiter,
  asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const admin = await Admin.findOne({ username });
    if (!admin || !(await admin.verifyPassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid admin credentials.' });
    }
    issueAdminToken(res, admin);
    res.json({ success: true, redirect: '/admin' });
  })
);

router.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_token');
  res.json({ success: true, redirect: '/admin/login' });
});

// ---------- Feature 3: Admin Analytics Dashboard ----------
router.get(
  '/admin',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;

    // Optional date range filter
    const dateMatch = {};
    if (startDate) {
      dateMatch.createdAt = dateMatch.createdAt || {};
      dateMatch.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      dateMatch.createdAt = dateMatch.createdAt || {};
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      dateMatch.createdAt.$lte = end;
    }

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    // Parallel metric queries
    const [
      foodCount,
      totalOrders,
      paidOrdersCount,
      pendingOrdersCount,
      cancelledOrdersCount,
      totalRevenueAgg,
      todayOrdersCount,
      todayRevenueAgg,
      monthOrdersCount,
      monthRevenueAgg,
      bestSellers,
      recentOrders,
      dailySalesAgg,
      totalReviewsCount,
    ] = await Promise.all([
      Food.countDocuments(),
      Order.countDocuments(dateMatch),
      Order.countDocuments({ ...dateMatch, 'payment.status': 'paid' }),
      Order.countDocuments({ ...dateMatch, status: { $in: ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING'] } }),
      Order.countDocuments({ ...dateMatch, status: 'CANCELLED' }),
      Order.aggregate([
        { $match: { ...dateMatch, 'payment.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.countDocuments({ createdAt: { $gte: startOfToday } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfToday }, 'payment.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Order.aggregate([
        { $match: { createdAt: { $gte: startOfMonth }, 'payment.status': 'paid' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } },
      ]),
      Order.aggregate([
        { $match: { 'payment.status': 'paid' } },
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
      ]),
      Order.find(dateMatch)
        .populate('user', 'username phone email')
        .sort({ createdAt: -1 })
        .limit(6),
      Order.aggregate([
        { $match: { createdAt: { $gte: sevenDaysAgo }, 'payment.status': 'paid' } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            sales: { $sum: '$totalAmount' },
            orders: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      Review.countDocuments(),
    ]);

    const totalRevenue = totalRevenueAgg[0] ? totalRevenueAgg[0].total : 0;
    const todayRevenue = todayRevenueAgg[0] ? todayRevenueAgg[0].total : 0;
    const monthlyRevenue = monthRevenueAgg[0] ? monthRevenueAgg[0].total : 0;

    // Fill last 7 days chart array
    const chartDays = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' });
      const found = dailySalesAgg.find((s) => s._id === dateStr);
      chartDays.push({
        date: dateStr,
        label: dayLabel,
        sales: found ? found.sales : 0,
        orders: found ? found.orders : 0,
      });
    }

    const maxChartSales = Math.max(1, ...chartDays.map((d) => d.sales));

    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: {
        foodCount,
        totalOrders,
        paidOrdersCount,
        pendingOrdersCount,
        cancelledOrdersCount,
        totalRevenue,
        todayOrdersCount,
        todayRevenue,
        monthOrdersCount,
        monthlyRevenue,
        totalReviewsCount,
      },
      bestSellers,
      recentOrders,
      chartDays,
      maxChartSales,
      dateFilter: {
        startDate: startDate || '',
        endDate: endDate || '',
      },
    });
  })
);

// ---------- Food management ----------
router.get(
  '/admin/foods',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const foods = await Food.find().sort({ createdAt: -1 });
    res.render('admin/foods', { title: 'Manage Foods', foods });
  })
);

router.post(
  '/api/admin/foods',
  requireAdmin,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const { name, description, price, category, isVeg } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Name and price are required.' });
    }
    const food = await Food.create({
      name,
      description,
      category: category || 'General',
      isVeg: isVeg === 'true' || isVeg === true,
      price: Number(price),
      image: req.file ? `/uploads/${req.file.filename}` : undefined,
      createdBy: req.admin._id,
    });
    res.json({ success: true, food });
  })
);

router.put(
  '/api/admin/foods/:id',
  requireAdmin,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ success: false, message: 'Food not found.' });

    const { name, description, price, category, available, isVeg } = req.body;
    if (name !== undefined) food.name = name;
    if (description !== undefined) food.description = description;
    if (category !== undefined) food.category = category;
    if (price !== undefined) food.price = Number(price);
    if (available !== undefined) food.available = available === 'true' || available === true;
    if (isVeg !== undefined) food.isVeg = isVeg === 'true' || isVeg === true;
    if (req.file) food.image = `/uploads/${req.file.filename}`;

    await food.save();
    res.json({ success: true, food });
  })
);

router.patch(
  '/api/admin/foods/:id/availability',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const food = await Food.findById(req.params.id);
    if (!food) return res.status(404).json({ success: false, message: 'Food not found.' });
    food.available = !!req.body.available;
    await food.save();
    res.json({ success: true, food });
  })
);

router.delete(
  '/api/admin/foods/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await Food.findByIdAndDelete(req.params.id);
    await Review.deleteMany({ food: req.params.id });
    res.json({ success: true });
  })
);

// ---------- Order management ----------
router.get(
  '/admin/orders',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const statusFilter = req.query.status;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 20;
    const query = statusFilter ? { status: statusFilter } : {};

    const [orders, total] = await Promise.all([
      Order.find(query)
        .populate('user', 'username phone email')
        .sort({ createdAt: -1 })
        .skip((page - 1) * perPage)
        .limit(perPage),
      Order.countDocuments(query),
    ]);

    res.render('admin/orders', {
      title: 'Orders',
      orders,
      statusFilter: statusFilter || '',
      page,
      totalPages: Math.ceil(total / perPage),
    });
  })
);

const VALID_STATUSES = [
  'PENDING_PAYMENT',
  'PAYMENT_VERIFICATION_PENDING',
  'PLACED',
  'PAID',
  'PREPARING',
  'READY',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
];

router.patch(
  '/api/admin/orders/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }
    const order = await Order.findById(req.params.id).populate('user');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    order.status = status;
    await order.save();

    // Trigger customer email notification asynchronously
    if (order.user) {
      const notifType = status === 'CANCELLED' ? 'ORDER_CANCELLED' : 'STATUS_UPDATED';
      sendOrderNotificationEmail({ order, user: order.user, type: notifType }).catch(() => {});
    }

    res.json({ success: true, order });
  })
);

router.patch(
  '/api/admin/orders/:id/verify-payment',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id).populate('user');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    order.payment.status = 'paid';
    order.payment.paidAt = new Date();
    if (['PENDING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING', 'PLACED'].includes(order.status)) {
      order.status = 'PAID';
    }
    await order.save();

    // Trigger payment confirmation email asynchronously
    if (order.user) {
      sendOrderNotificationEmail({ order, user: order.user, type: 'PAYMENT_CONFIRMED' }).catch(() => {});
    }

    res.json({ success: true, order });
  })
);

// ---------- Feature 2: Review Moderation ----------
router.get(
  '/admin/reviews',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const statusFilter = req.query.status;
    const query = statusFilter ? { status: statusFilter } : {};

    const reviews = await Review.find(query)
      .populate('user', 'username email phone')
      .populate('food', 'name image price')
      .sort({ createdAt: -1 });

    res.render('admin/reviews', {
      title: 'Review Moderation',
      reviews,
      statusFilter: statusFilter || 'all',
    });
  })
);

router.patch(
  '/api/admin/reviews/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['approved', 'hidden'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be approved or hidden.' });
    }

    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found.' });

    review.status = status;
    await review.save();

    // Recalculate average rating & review count for the food item
    const stats = await Review.aggregate([
      { $match: { food: review.food, status: 'approved' } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const food = await Food.findById(review.food);
    if (food) {
      food.rating = stats[0] ? Math.round(stats[0].avgRating * 10) / 10 : 0;
      food.totalReviews = stats[0] ? stats[0].count : 0;
      await food.save();
    }

    res.json({ success: true, review, updatedRating: food?.rating, updatedTotalReviews: food?.totalReviews });
  })
);

router.delete(
  '/api/admin/reviews/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const review = await Review.findById(req.params.id);
    if (!review) return res.status(404).json({ success: false, message: 'Review not found.' });

    const foodId = review.food;
    await Review.findByIdAndDelete(req.params.id);

    // Recalculate average rating & review count
    const stats = await Review.aggregate([
      { $match: { food: foodId, status: 'approved' } },
      { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);

    const food = await Food.findById(foodId);
    if (food) {
      food.rating = stats[0] ? Math.round(stats[0].avgRating * 10) / 10 : 0;
      food.totalReviews = stats[0] ? stats[0].count : 0;
      await food.save();
    }

    res.json({ success: true });
  })
);

// ---------- Delivery zone settings ----------
router.get(
  '/admin/settings/delivery-zones',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const zones = await DeliveryZone.find().sort({ minAmount: 1 });
    res.render('admin/delivery-zones', { title: 'Delivery Zones', zones });
  })
);

router.post(
  '/api/admin/delivery-zones',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { label, minAmount, maxDistanceKm, districtRestriction } = req.body;
    const zone = await DeliveryZone.create({
      label,
      minAmount: Number(minAmount),
      maxDistanceKm: Number(maxDistanceKm),
      districtRestriction: districtRestriction || '',
    });
    res.json({ success: true, zone });
  })
);

router.put(
  '/api/admin/delivery-zones/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const zone = await DeliveryZone.findById(req.params.id);
    if (!zone) return res.status(404).json({ success: false, message: 'Zone not found.' });
    const { label, minAmount, maxDistanceKm, districtRestriction, active } = req.body;
    if (label !== undefined) zone.label = label;
    if (minAmount !== undefined) zone.minAmount = Number(minAmount);
    if (maxDistanceKm !== undefined) zone.maxDistanceKm = Number(maxDistanceKm);
    if (districtRestriction !== undefined) zone.districtRestriction = districtRestriction;
    if (active !== undefined) zone.active = active === 'true' || active === true;
    await zone.save();
    res.json({ success: true, zone });
  })
);

router.delete(
  '/api/admin/delivery-zones/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    await DeliveryZone.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  })
);

module.exports = router;
