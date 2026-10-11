/**
 * Creates (or updates) a fully-active customer account directly in the
 * database — skips OTP entirely. For LOCAL TESTING ONLY; never expose this
 * script or run it against a production database.
 *
 * Usage (edit the values below, or pass as CLI args):
 *   node scripts/createTestUser.js <username> <password> <10-digit-phone> <age> [dob YYYY-MM-DD]
 *
 * Example:
 *   node scripts/createTestUser.js kani mypassword123 9876543210 22
 */
require('dotenv').config();
const connectDB = require('../config/db');
const User = require('../models/User');

async function run() {
  await connectDB();

  const [, , usernameArg, passwordArg, phoneArg, ageArg, dobArg] = process.argv;

  const username = usernameArg || 'testuser';
  const password = passwordArg || 'test1234';
  const phoneDigits = (phoneArg || '9999999999').replace(/\D/g, '').slice(-10);
  const phone = `+91${phoneDigits}`;
  const age = Number(ageArg || 22);
  const dob = age >= 18 ? new Date(dobArg || '2003-01-01') : undefined;

  if (!/^[6-9]\d{9}$/.test(phoneDigits)) {
    console.error('Phone number must be a valid 10-digit Indian mobile number (starts with 6-9).');
    process.exit(1);
  }

  let user = await User.findOne({ phone });
  if (user) {
    console.log(`User with phone ${phone} already exists (username: "${user.username}"). No changes made.`);
  } else {
    user = new User({ username, phone, age, dob, phoneVerified: true, isActive: true });
    await user.setPassword(password);
    await user.save();
    console.log(`User created — username: "${username}", phone: ${phone}, password: "${password}"`);
    console.log(`Log in at /login with the phone number's last 10 digits (${phoneDigits}) and this password.`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
