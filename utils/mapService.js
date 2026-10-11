// services/mapService.js

const DELIVERY_CHARGES = {
  narikulam: 20,
  alangulam: 30,
};

function normalizeAddress(address = "") {
  return address
    .toLowerCase()
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getDeliveryCharge(address) {
  const normalized = normalizeAddress(address);

  if (!normalized) {
    return {
      success: false,
      message: "Delivery address is required",
    };
  }

  // Specific areas
  if (normalized.includes("narikulam")) {
    return {
      success: true,
      area: "Narikulam",
      deliveryCharge: DELIVERY_CHARGES.narikulam,
    };
  }

  if (normalized.includes("alangulam")) {
    return {
      success: true,
      area: "Alangulam",
      deliveryCharge: DELIVERY_CHARGES.alangulam,
    };
  }

  // Other locations
  return {
    success: true,
    area: "Other",
    deliveryCharge: 60,
  };
}

module.exports = {
  getDeliveryCharge,
};