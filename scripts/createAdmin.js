require('dotenv').config();
const connectDB = require('../config/db');
const Admin = require('../models/Admin');
const DeliveryZone = require('../models/DeliveryZone');

async function run() {
  await connectDB();

  const username = process.env.ADMIN_BOOTSTRAP_USERNAME || 'admin';
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const phone = process.env.ADMIN_BOOTSTRAP_PHONE || '';

  if (!password) {
    console.error('Set ADMIN_BOOTSTRAP_PASSWORD in .env before running this script.');
    process.exit(1);
  }

  let admin = await Admin.findOne({ username });
  if (admin) {
    console.log(`Admin "${username}" already exists.`);
  } else {
    admin = new Admin({ username, phone, role: 'owner' });
    await admin.setPassword(password);
    await admin.save();
    console.log(`Admin "${username}" created.`);
  }

  const zoneCount = await DeliveryZone.countDocuments();
  if (zoneCount === 0) {
    await DeliveryZone.insertMany([
      {
        label: 'Tier 1 — Alangulam surrounding area',
        minAmount: 1000,
        maxDistanceKm: 3,
        districtRestriction: '',
        order: 1,
      },
      {
        label: 'Tier 2 — Extended surrounding area',
        minAmount: 5000,
        maxDistanceKm: 7,
        districtRestriction: '',
        order: 2,
      },
      {
        label: 'Tier 3 — Virudhunagar District',
        minAmount: 10000,
        maxDistanceKm: 100,
        districtRestriction: 'Virudhunagar',
        order: 3,
      },
    ]);
    console.log('Default delivery zones seeded (editable at /admin/settings/delivery-zones).');
  } else {
    console.log('Delivery zones already exist — skipping seed.');
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
