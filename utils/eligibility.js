/**
 * Delivery eligibility — NO minimum order, NO distance blocking.
 * Always returns eligible: true so any address/amount can check out.
 * Delivery charges are still calculated via mapService; this function
 * only gates whether the order may proceed.
 */
async function checkDeliveryEligibility({ totalAmount, distanceKm, district }) {
  return { eligible: true, reason: null, zone: null };
}

module.exports = { checkDeliveryEligibility };
