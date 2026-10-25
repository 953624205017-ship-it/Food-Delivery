const DELIVERY_CHARGES = {
  narikulam: 20,
  alangulam: 30,
  other: 60,
};

function normalizeAddress(address = "") {
  if (Array.isArray(address)) {
    address = address.filter(Boolean).join(" ");
  }

  if (!address || typeof address !== "string") {
    return "";
  }

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

  return {
    success: true,
    area: "Other",
    deliveryCharge: DELIVERY_CHARGES.other,
  };
}

module.exports = {
  normalizeAddress,
  getDeliveryCharge,
};