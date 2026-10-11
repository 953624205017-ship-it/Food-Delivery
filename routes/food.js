const express = require('express');
const asyncHandler = require('express-async-handler');
const Food = require('../models/Food');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get(
  '/dashboard',
  requireAuth,
  asyncHandler(async (req, res) => {
    const foods = await Food.find().sort({ available: -1, createdAt: -1 });
    res.render('dashboard', { title: 'Dashboard', foods });
  })
);

router.get(
  '/api/foods',
  asyncHandler(async (req, res) => {
    const foods = await Food.find().sort({ available: -1, createdAt: -1 });
    res.json({ success: true, foods });
  })
);

module.exports = router;
