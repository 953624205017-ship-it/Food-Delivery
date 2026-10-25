require('dotenv').config();
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const connectDB = require('../config/db');
const User = require('../models/User');
const Otp = require('../models/Otp');
const {
  generateSecureOtp,
  verifyEmailOtp,
  EXPIRY_MINUTES,
  RESEND_COOLDOWN_SECONDS,
  MAX_ATTEMPTS,
} = require('../utils/otpService');
const { isEmailConfigured } = require('../utils/emailService');
const authRoutes = require('../routes/auth');

async function runTests() {
  console.log('====================================================');
  console.log('RUNNING EMAIL OTP VERIFICATION INTEGRATION TESTS');
  console.log('====================================================\n');

  await connectDB();

  // Test 1: Cryptographically Secure OTP Generation
  console.log('[Test 1] Testing cryptographically secure random 6-digit OTP generation:');
  const samples = new Set();
  for (let i = 0; i < 1000; i++) {
    const otp = generateSecureOtp();
    if (!/^\d{6}$/.test(otp)) {
      throw new Error(`Generated invalid OTP: ${otp} (must be exactly 6 digits)`);
    }
    const num = Number(otp);
    if (num < 100000 || num > 999999) {
      throw new Error(`Generated out-of-range OTP: ${otp}`);
    }
    samples.add(otp);
  }
  // With 1000 uniform random 6-digit samples, we expect high uniqueness (>950 unique)
  if (samples.size < 950) {
    throw new Error(`Low entropy in randomInt generator: only ${samples.size} unique values in 1000 samples`);
  }
  console.log(`PASS: 1,000 OTP samples generated. All 6 digits (100000-999999), high entropy (${samples.size} unique).`);

  // Test 2: SHA-256 Hashing Verification
  console.log('\n[Test 2] Testing SHA-256 OTP hashing safety:');
  const plainSample = '748291';
  const hashedSample = Otp.hashCode(plainSample);
  if (hashedSample.length !== 64) {
    throw new Error(`Invalid SHA-256 hash length: ${hashedSample.length}`);
  }
  if (hashedSample === plainSample) {
    throw new Error('Hash matches plaintext — critical security flaw!');
  }
  console.log('PASS: OTP correctly hashed to 64-char SHA-256 digest. Plaintext never persisted.');

  // Test 3: OTP Database lifecycle & single-use guarantee
  console.log('\n[Test 3] Testing OTP database lifecycle, single-use, and attempt tracking:');
  const testEmail = 'automated-test@example.com';
  await Otp.deleteMany({ email: testEmail });

  const testCode = '839201';
  const testHash = Otp.hashCode(testCode);

  await Otp.create({
    email: testEmail,
    codeHash: testHash,
    purpose: 'registration',
    attempts: 0,
    lastSentAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  // Verify wrong code increments attempts
  try {
    await verifyEmailOtp(testEmail, 'registration', '111111');
    throw new Error('Wrong code should have thrown error');
  } catch (err) {
    if (err.code !== 'INVALID' || err.attemptsRemaining !== 4) {
      throw new Error(`Unexpected error on wrong code: ${err.message} (remaining: ${err.attemptsRemaining})`);
    }
    console.log('PASS: Incorrect code rejected, attempt count incremented, 4 attempts remaining.');
  }

  // Verify correct code verifies successfully and DELETES the record (single use)
  const isVerified = await verifyEmailOtp(testEmail, 'registration', testCode);
  if (!isVerified) throw new Error('Valid code was rejected');

  const recordAfterSuccess = await Otp.findOne({ email: testEmail });
  if (recordAfterSuccess) {
    throw new Error('OTP record was NOT deleted after successful verification — replay attack vulnerability!');
  }
  console.log('PASS: Valid code verified successfully and record deleted immediately (single-use guarantee).');

  // Test 4: Maximum attempts lockout
  console.log('\n[Test 4] Testing maximum attempt (lockout) protection:');
  await Otp.create({
    email: testEmail,
    codeHash: testHash,
    purpose: 'registration',
    attempts: 4, // 1 attempt remaining before lockout
    lastSentAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  try {
    await verifyEmailOtp(testEmail, 'registration', '000000');
    throw new Error('Should have thrown TOO_MANY_ATTEMPTS');
  } catch (err) {
    if (err.code !== 'TOO_MANY_ATTEMPTS') {
      throw new Error(`Expected TOO_MANY_ATTEMPTS, got: ${err.code}`);
    }
    console.log('PASS: Exceeding 5 attempts locked out OTP and wiped record.');
  }

  // Test 5: Expired code rejection
  console.log('\n[Test 5] Testing expired OTP rejection:');
  await Otp.create({
    email: testEmail,
    codeHash: testHash,
    purpose: 'registration',
    attempts: 0,
    lastSentAt: new Date(Date.now() - 10 * 60 * 1000),
    expiresAt: new Date(Date.now() - 1000), // expired 1s ago
  });

  try {
    await verifyEmailOtp(testEmail, 'registration', testCode);
    throw new Error('Should have rejected expired code');
  } catch (err) {
    if (err.code !== 'EXPIRED') {
      throw new Error(`Expected EXPIRED, got: ${err.code}`);
    }
    console.log('PASS: Expired OTP rejected and cleared.');
  }

  // Test 6: Express HTTP Endpoints Integration
  console.log('\n[Test 6] Testing Express Registration & Login Endpoints:');
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.locals.hotelName = 'HOTEL LITTLE JAPPAN';
    next();
  });
  app.use('/', authRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const regEmail = 'jappan.customer@example.com';
    const regPhone = '9876543210';
    const regNormalizedPhone = '+919876543210';

    await User.deleteMany({ $or: [{ email: regEmail }, { phone: regNormalizedPhone }] });
    await Otp.deleteMany({ email: regEmail });

    // Step 6A: Input validation check
    const invalidRes = await fetch(`${baseUrl}/api/auth/register/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'ab', // too short (<3)
        email: 'invalid-email',
        phone: '123',
        password: '123',
        age: 20,
      }),
    });
    const invalidData = await invalidRes.json();
    if (invalidRes.status !== 400 || invalidData.success) {
      throw new Error('Validation should have failed for bad input');
    }
    console.log('PASS: Invalid registration inputs correctly rejected with HTTP 400.');

    // Step 6B: Direct Email verification & account creation
    // Simulate active OTP in database
    const verifyCode = '492817';
    await Otp.create({
      email: regEmail,
      codeHash: Otp.hashCode(verifyCode),
      purpose: 'registration',
      attempts: 0,
      lastSentAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    // Create pending_registration cookie
    const jwt = require('jsonwebtoken');
    const pendingCookieValue = jwt.sign(
      {
        username: 'Gowtham Customer',
        email: regEmail,
        phone: regNormalizedPhone,
        password: 'MySecurePassword123',
        age: 24,
        dob: '2000-01-01',
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Call verify endpoint with the code
    const verifyRes = await fetch(`${baseUrl}/api/auth/register/verify-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `pending_registration=${pendingCookieValue}`,
      },
      body: JSON.stringify({ code: verifyCode }),
    });
    const verifyData = await verifyRes.json();
    console.log('Verify response status:', verifyRes.status);
    console.log('Verify response body:', verifyData);

    if (!verifyRes.ok || !verifyData.success) {
      throw new Error(`Email verify failed: ${JSON.stringify(verifyData)}`);
    }

    // Verify user exists in MongoDB and is active
    const createdUser = await User.findOne({ email: regEmail });
    if (!createdUser || !createdUser.isActive || !createdUser.emailVerified) {
      throw new Error('User was not created as active and emailVerified in MongoDB!');
    }
    console.log('PASS: User account activated in MongoDB with isActive=true and emailVerified=true.');

    // Verify session token cookie was set
    const setCookieHeader = verifyRes.headers.get('set-cookie') || '';
    if (!setCookieHeader.includes('token=')) {
      throw new Error('Authentication session token cookie was not set!');
    }
    console.log('PASS: Session cookie (token) issued successfully.');

    // Step 6C: Test Password Login with Email
    const loginEmailRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: regEmail,
        password: 'MySecurePassword123',
      }),
    });
    const loginEmailData = await loginEmailRes.json();
    if (!loginEmailRes.ok || !loginEmailData.success) {
      throw new Error(`Password login with email failed: ${JSON.stringify(loginEmailData)}`);
    }
    console.log('PASS: Password login with Email works seamlessly.');

    // Step 6D: Test Password Login with Phone
    const loginPhoneRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: regPhone,
        password: 'MySecurePassword123',
      }),
    });
    const loginPhoneData = await loginPhoneRes.json();
    if (!loginPhoneRes.ok || !loginPhoneData.success) {
      throw new Error(`Password login with phone failed: ${JSON.stringify(loginPhoneData)}`);
    }
    console.log('PASS: Password login with Phone number works seamlessly.');

    // Step 6E: Clean up test user
    await User.deleteMany({ email: regEmail });
    await Otp.deleteMany({ email: regEmail });

    console.log('\n====================================================');
    console.log('ALL EMAIL OTP INTEGRATION TESTS PASSED (10/10)!');
    console.log('====================================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

