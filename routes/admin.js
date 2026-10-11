const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const asyncHandler = require('express-async-handler');

const Admin = require('../models/Admin');
const Food = require('../models/Food');
const Order = require('../models/Order');
const DeliveryZone = require('../models/DeliveryZone');
const { requireAdmin } = require('../middleware/adminAuth');
const { authLimiter } = require('../middleware/rateLimiter');

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

// ---------- Admin dashboard ----------
router.get(
  '/admin',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const [foodCount, pendingCount, paidCount, totalOrders] = await Promise.all([
      Food.countDocuments(),
      Order.countDocuments({ status: 'PENDING_PAYMENT' }),
      Order.countDocuments({ status: { $in: ['PAID', 'PLACED', 'PAYMENT_VERIFICATION_PENDING', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'] } }),
      Order.countDocuments(),
    ]);
    res.render('admin/dashboard', { title: 'Admin Dashboard', stats: { foodCount, pendingCount, paidCount, totalOrders } });
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
    const { name, description, price, category } = req.body;
    if (!name || price === undefined) {
      return res.status(400).json({ success: false, message: 'Name and price are required.' });
    }
    const food = await Food.create({
      name,
      description,
      category,
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

    const { name, description, price, category, available } = req.body;
    if (name !== undefined) food.name = name;
    if (description !== undefined) food.description = description;
    if (category !== undefined) food.category = category;
    if (price !== undefined) food.price = Number(price);
    if (available !== undefined) food.available = available === 'true' || available === true;
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
        .populate('user', 'username phone')
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

const VALID_STATUSES = ['PENDING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING', 'PLACED', 'PAID', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

router.patch(
  '/api/admin/orders/:id/status',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    order.status = status;
    await order.save();
    res.json({ success: true, order });
  })
);

router.patch(
  '/api/admin/orders/:id/verify-payment',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    order.payment.status = 'paid';
    order.payment.paidAt = new Date();
    if (['PENDING_PAYMENT', 'PAYMENT_VERIFICATION_PENDING', 'PLACED'].includes(order.status)) {
      order.status = 'PAID';
    }
    await order.save();
    res.json({ success: true, order });
  })
);

// ---------- Delivery zone settings (configurable business rules) ----------
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
