const DeliveryZone = require('../models/DeliveryZone');

const MIN_ORDER_VALUE = 1000; // ₹1,000 — hard floor regardless of zones

/**
 * Decides whether an order (given its server-computed total, the real
 * calculated distance, and the geocoded district) is eligible for delivery.
 *
 * Zones are read from the database (admin-editable), never hard-coded, so
 * the owner can change radii/areas without a code deploy.
 *
 * Rule: pick the highest-value zone whose minAmount <= totalAmount, then
 * check the distance (and district, if the zone restricts one) against it.
 */
async function checkDeliveryEligibility({ totalAmount, distanceKm, district }) {
  if (totalAmount < MIN_ORDER_VALUE) {
    return {
      eligible: false,
      reason: `Minimum order value is ₹${MIN_ORDER_VALUE.toLocaleString('en-IN')}.`,
    };
  }

  const zones = await DeliveryZone.find({ active: true, minAmount: { $lte: totalAmount } }).sort({
    minAmount: -1,
  });

  if (!zones.length) {
    return {
      eligible: false,
      reason: 'No delivery zone is configured for this order amount. Please contact the hotel.',
    };
  }

  // Highest-qualifying zone for this order amount
  const zone = zones[0];

  if (distanceKm > zone.maxDistanceKm) {
    return {
      eligible: false,
      reason: `Delivery is only available within ${zone.maxDistanceKm} KM for orders in this range (your address is ${distanceKm} KM away).`,
      zone,
    };
  }

  if (zone.districtRestriction) {
    const districtMatches =
      district && district.toLowerCase().includes(zone.districtRestriction.toLowerCase());
    if (!districtMatches) {
      return {
        eligible: false,
        reason: `Delivery for this order amount is only available within ${zone.districtRestriction}.`,
        zone,
      };
    }
  }

  return { eligible: true, reason: null, zone };
}

module.exports = { checkDeliveryEligibility, MIN_ORDER_VALUE };
