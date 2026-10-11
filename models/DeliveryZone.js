const mongoose = require('mongoose');

/**
 * A DeliveryZone is a tier: "orders of at least `minAmount` rupees may be
 * delivered up to `maxDistanceKm` km away, PROVIDED the delivery point also
 * falls inside `districtRestriction` (if set)."
 *
 * Seeded with the three rules from the brief, but fully editable by the
 * admin at /admin/settings/delivery-zones — nothing is hard-coded in the
 * eligibility logic itself (see utils/eligibility.js).
 */
const deliveryZoneSchema = new mongoose.Schema(
  {
    label: { type: String, required: true, trim: true }, // e.g. "Tier 1"
    minAmount: { type: Number, required: true, min: 0 },
    maxDistanceKm: { type: Number, required: true, min: 0 },
    // Optional: restrict this tier to a named district/administrative area.
    // Checked against the geocoded address components returned by the map API.
    districtRestriction: { type: String, trim: true, default: '' },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 }, // display/evaluation order
  },
  { timestamps: true }
);

module.exports = mongoose.model('DeliveryZone', deliveryZoneSchema);
