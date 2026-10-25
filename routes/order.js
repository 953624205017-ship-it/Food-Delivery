const express = require('express');
const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');

const Food = require('../models/Food');
const Order = require('../models/Order');
const { requireAuth } = require('../middleware/auth');
const { computeOrderTotals } = require('../utils/pricing');
const { checkDeliveryEligibility } = require('../utils/eligibility');
const { streamBillPdf } = require('../utils/billGenerator');
const { getDeliveryCharge, normalizeAddress } = require('../utils/mapService');

const router = express.Router();


// ============================================================
// ADDRESS-BASED DELIVERY CALCULATION
// Keeps the order flow deterministic without trusting the client.
// ============================================================

function calculateDeliveryByArea({
  address,
  street,
  village,
  pincode
}) {
  const fullAddress = [
    address,
    street,
    village,
    pincode
  ].filter(Boolean);

  const normalized = normalizeAddress(fullAddress);
  const formattedAddress = fullAddress.join(', ');
  const delivery = getDeliveryCharge(fullAddress);

  return {
    area: delivery.success ? delivery.area : 'Other',
    deliveryCharge: delivery.success ? delivery.deliveryCharge : 60,
    distanceKm: normalized ? 0 : 0,
    district: 'Virudhunagar',
    formattedAddress
  };
}



// ============================================================
// SHOPPING CART PAGE
// Multi-item cart & single checkout flow
// ============================================================

router.get(
  '/cart',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.render('cart', {
      title: 'Shopping Cart',
      user: req.user,
    });
  })
);

// ============================================================
// ORDER PAGE
// Single-item "Buy Now" flow
// ============================================================

router.get(
  '/order',
  requireAuth,
  asyncHandler(async (req, res) => {

    const { foodId, qty } = req.query;

    const food = await Food.findById(foodId);

    if (!food || !food.available) {
      return res.status(404).render('error', {
        title: 'Item unavailable',
        message: 'This item is no longer available.'
      });
    }

    const quantity = Math.max(
      1,
      Math.min(
        50,
        parseInt(qty, 10) || 1
      )
    );

    res.render('order', {
      title: 'Your Order',
      food,
      quantity,
      user: req.user,

      // Google Maps is no longer required
      googleMapsKey: false
    });
  })
);



// ============================================================
// ORDER QUOTE
// Area-based delivery calculation
// ============================================================

router.post(
  '/api/orders/quote',
  requireAuth,
  asyncHandler(async (req, res) => {

    const {
      items,
      address,
      street,
      village,
      pincode
    } = req.body;


    // --------------------------------------------------------
    // Calculate food totals
    // --------------------------------------------------------

    let totals;

    try {

      totals = await computeOrderTotals(items);

    } catch (err) {

      return res.status(400).json({
        success: false,
        message: err.message
      });

    }


    // --------------------------------------------------------
    // Validate address
    // --------------------------------------------------------

    if (!address || !pincode) {

      return res.status(400).json({
        success: false,
        message: 'Address and pincode are required.'
      });

    }


    // --------------------------------------------------------
    // Calculate delivery charge based on area
    // --------------------------------------------------------

    const delivery = calculateDeliveryByArea({
      address,
      street,
      village,
      pincode
    });


    // --------------------------------------------------------
    // Check delivery eligibility
    // --------------------------------------------------------

    const eligibility = await checkDeliveryEligibility({
      totalAmount: totals.totalAmount,
      distanceKm: delivery.distanceKm,
      district: delivery.district
    });


    // --------------------------------------------------------
    // Final total
    // --------------------------------------------------------

    const finalTotal =
      totals.totalAmount +
      delivery.deliveryCharge;


    // --------------------------------------------------------
    // Send quote
    // --------------------------------------------------------

    return res.json({

      success: true,

      subtotal: totals.subtotal,

      totalAmount: finalTotal,

      deliveryCharge: delivery.deliveryCharge,

      distanceKm: delivery.distanceKm,

      formattedAddress: delivery.formattedAddress,

      eligible: eligibility.eligible,

      reason: eligibility.reason,

      zoneLabel: delivery.area

    });

  })
);



// ============================================================
// CREATE ORDER
// Re-validates everything server-side
// ============================================================

router.post(
  '/api/orders/create',
  requireAuth,
  asyncHandler(async (req, res) => {

    const {
      items,
      address,
      street,
      village,
      pincode
    } = req.body;


    // --------------------------------------------------------
    // Calculate food totals
    // --------------------------------------------------------

    let totals;

    try {

      totals = await computeOrderTotals(items);

    } catch (err) {

      return res.status(400).json({
        success: false,
        message: err.message
      });

    }


    // --------------------------------------------------------
    // Validate address
    // --------------------------------------------------------

    if (!address || !pincode) {

      return res.status(400).json({
        success: false,
        message: 'Address and pincode are required.'
      });

    }


    // --------------------------------------------------------
    // Calculate delivery
    // --------------------------------------------------------

    const delivery = calculateDeliveryByArea({
      address,
      street,
      village,
      pincode
    });


    // --------------------------------------------------------
    // Check eligibility
    // --------------------------------------------------------

    const eligibility = await checkDeliveryEligibility({
      totalAmount: totals.totalAmount,
      distanceKm: delivery.distanceKm,
      district: delivery.district
    });


    if (!eligibility.eligible) {

      return res.status(422).json({
        success: false,
        message: eligibility.reason
      });

    }


    // --------------------------------------------------------
    // Final order total
    // --------------------------------------------------------

    const finalTotal =
      totals.totalAmount +
      delivery.deliveryCharge;


    // --------------------------------------------------------
    // Create order
    // --------------------------------------------------------

    const order = await Order.create({

      user: req.user._id,

      items: totals.items,

      subtotal: totals.subtotal,

      totalAmount: finalTotal,

      deliveryAddress: {

        address,

        street,

        village,

        pincode,

        // Google Maps is no longer used
        latitude: null,

        longitude: null,

        formattedAddress:
          delivery.formattedAddress,

        district:
          delivery.district

      },

      distanceKm:
        delivery.distanceKm,

      eligibilityZoneLabel:
        delivery.area,

      status:
        'PENDING_PAYMENT'

    });


    // --------------------------------------------------------
    // Response
    // --------------------------------------------------------

    return res.json({

      success: true,

      orderId: order._id

    });

  })
);



// ============================================================
// ORDER CONFIRMATION PAGE
// ============================================================

router.get(
  '/order/:id/confirmation',
  requireAuth,
  asyncHandler(async (req, res) => {

    if (
      !mongoose.isValidObjectId(req.params.id)
    ) {
      return res.redirect('/dashboard');
    }


    const order =
      await Order.findOne({
        _id: req.params.id,
        user: req.user._id
      });


    if (!order) {
      return res.redirect('/dashboard');
    }


    res.render('confirmation', {

      title: 'Order Confirmation',

      order,

      ownerPhone:
        process.env.OWNER_PHONE

    });

  })
);



// ============================================================
// MY ORDERS
// ============================================================

router.get(
  '/orders',
  requireAuth,
  asyncHandler(async (req, res) => {

    const page = Math.max(
      1,
      parseInt(req.query.page, 10) || 1
    );

    const perPage = 10;


    const [
      orders,
      total
    ] = await Promise.all([

      Order.find({
        user: req.user._id
      })
        .sort({
          createdAt: -1
        })
        .skip(
          (page - 1) * perPage
        )
        .limit(perPage),

      Order.countDocuments({
        user: req.user._id
      })

    ]);


    res.render('orders', {

      title: 'My Orders',

      orders,

      page,

      totalPages:
        Math.ceil(
          total / perPage
        )

    });

  })
);



// ============================================================
// BILL VIEW
// ============================================================

router.get(
  '/bill/:id',
  requireAuth,
  asyncHandler(async (req, res) => {

    const order =
      await Order.findOne({
        _id: req.params.id,
        user: req.user._id
      });


    if (
      !order ||
      order.status === 'PENDING_PAYMENT'
    ) {

      return res.status(404).render(
        'error',
        {
          title: 'Bill unavailable',

          message:
            'Bill is available only after an order has been placed.'
        }
      );

    }


    res.render('bill', {

      title: 'Bill',

      order,

      user: req.user

    });

  })
);



// ============================================================
// BILL DOWNLOAD
// ============================================================

router.get(
  '/bill/:id/download',
  requireAuth,
  asyncHandler(async (req, res) => {

    const order =
      await Order.findOne({
        _id: req.params.id,
        user: req.user._id
      });


    if (
      !order ||
      order.status === 'PENDING_PAYMENT'
    ) {

      return res
        .status(404)
        .send(
          'Bill is available only after an order has been placed.'
        );

    }


    res.setHeader(
      'Content-Type',
      'application/pdf'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bill-${order._id}.pdf"`
    );


    streamBillPdf(
      order,
      req.user,
      res
    );

  })
);



// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;