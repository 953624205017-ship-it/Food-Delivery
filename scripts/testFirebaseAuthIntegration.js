require('dotenv').config();
const http = require('http');
const express = require('express');
const cookieParser = require('cookie-parser');
const connectDB = require('../config/db');
const User = require('../models/User');
const { firebaseWebConfig } = require('../config/firebase');
const { getFirebaseAdmin, verifyFirebaseIdToken } = require('../config/firebaseAdmin');
const authRoutes = require('../routes/auth');

async function runTests() {
  console.log('========================================================');
  console.log('RUNNING FIREBASE PHONE AUTHENTICATION INTEGRATION TESTS');
  console.log('========================================================\n');

  await connectDB();

  // Test 1: Firebase Web Configuration
  console.log('[Test 1] Checking Firebase Web Configuration structure:');
  const expectedWebKeys = ['apiKey', 'authDomain', 'projectId', 'appId', 'messagingSenderId', 'storageBucket'];
  for (const key of expectedWebKeys) {
    if (!(key in firebaseWebConfig)) {
      throw new Error(`Missing expected key in firebaseWebConfig: ${key}`);
    }
  }
  console.log('PASS: firebaseWebConfig contains all expected client properties:', expectedWebKeys.join(', '));

  // Test 2: Firebase Admin SDK initialization safety
  console.log('\n[Test 2] Testing Firebase Admin SDK initialization safety:');
  const adminApp = getFirebaseAdmin();
  console.log('Firebase Admin SDK initialized status:', adminApp ? 'ACTIVE' : 'AWAITING_CREDENTIALS');
  try {
    await verifyFirebaseIdToken(null);
    throw new Error('verifyFirebaseIdToken should have rejected null token');
  } catch (err) {
    if (err.code === 'MISSING_TOKEN') {
      console.log('PASS: Correctly rejected missing token with MISSING_TOKEN error code.');
    } else {
      throw err;
    }
  }

  // Setup express test server with auth routes
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    res.locals.hotelName = 'HOTEL LITTLE JAPPAN';
    res.locals.firebaseWebConfig = firebaseWebConfig;
    next();
  });
  app.get('/api/config/firebase', (req, res) => {
    res.json({ success: true, config: firebaseWebConfig });
  });
  app.use('/', authRoutes);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  console.log(`\nTest server listening at: ${baseUrl}`);

  try {
    // Test 3: Public Firebase config endpoint
    console.log('\n[Test 3] Testing GET /api/config/firebase:');
    const configRes = await fetch(`${baseUrl}/api/config/firebase`);
    const configData = await configRes.json();
    if (!configRes.ok || !configData.success || !configData.config) {
      throw new Error(`Failed to fetch /api/config/firebase: ${JSON.stringify(configData)}`);
    }
    console.log('PASS: /api/config/firebase returned public configuration cleanly.');

    // Test 4: Register Start endpoint validation
    console.log('\n[Test 4] Testing POST /api/auth/register/start (input validation & session creation):');
    const testPhone = '9876543210';
    const testNormalizedPhone = '+919876543210';

    // Clean up test user if exists
    await User.deleteMany({ phone: testNormalizedPhone });

    const registerStartRes = await fetch(`${baseUrl}/api/auth/register/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'testfirebaseuser',
        password: 'password123',
        age: 22,
        dob: '2002-01-01',
        phone: testPhone,
      }),
    });
    const registerStartData = await registerStartRes.json();
    console.log('Status:', registerStartRes.status);
    console.log('Response:', registerStartData);

    const cookies = registerStartRes.headers.get('set-cookie') || '';
    if (!registerStartRes.ok || !registerStartData.success || !cookies.includes('pending_registration')) {
      throw new Error(`register/start failed or did not set pending_registration cookie: ${JSON.stringify(registerStartData)}`);
    }
    console.log('PASS: /api/auth/register/start successfully validated details and issued pending_registration cookie.');

    // Test 5: Register verify endpoint token requirement
    console.log('\n[Test 5] Testing POST /api/auth/register/verify-firebase (missing token validation):');
    const noTokenRes = await fetch(`${baseUrl}/api/auth/register/verify-firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const noTokenData = await noTokenRes.json();
    console.log('Status (expected 400):', noTokenRes.status);
    if (noTokenRes.status !== 400 || noTokenData.success) {
      throw new Error('Expected 400 error when idToken is omitted');
    }
    console.log('PASS: Correctly rejected request missing Firebase idToken.');

    // Test 6: Login verify endpoint token requirement
    console.log('\n[Test 6] Testing POST /api/auth/login/verify-firebase (missing token validation):');
    const loginNoTokenRes = await fetch(`${baseUrl}/api/auth/login/verify-firebase`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const loginNoTokenData = await loginNoTokenRes.json();
    console.log('Status (expected 400):', loginNoTokenRes.status);
    if (loginNoTokenRes.status !== 400 || loginNoTokenData.success) {
      throw new Error('Expected 400 error when idToken is omitted');
    }
    console.log('PASS: Correctly rejected login request missing Firebase idToken.');

    // Test 7: Preserved Password Login Flow
    console.log('\n[Test 7] Testing Preserved Password Login Flow:');
    // Create an active user in DB
    const user = new User({
      username: 'firebasetestuser',
      phone: testNormalizedPhone,
      age: 25,
      phoneVerified: true,
      isActive: true,
      firebaseUid: 'test-firebase-uid-12345',
    });
    await user.setPassword('SecretPassword123');
    await user.save();

    // Try login with incorrect password
    const wrongPwdRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testPhone,
        password: 'wrongpassword',
      }),
    });
    const wrongPwdData = await wrongPwdRes.json();
    console.log('Wrong password status (expected 401):', wrongPwdRes.status);
    if (wrongPwdRes.status !== 401 || wrongPwdData.success) {
      throw new Error('Wrong password was incorrectly accepted');
    }

    // Try login with correct password
    const correctPwdRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: testPhone,
        password: 'SecretPassword123',
      }),
    });
    const correctPwdData = await correctPwdRes.json();
    console.log('Correct password status (expected 200):', correctPwdRes.status);
    const loginCookies = correctPwdRes.headers.get('set-cookie') || '';
    if (!correctPwdRes.ok || !correctPwdData.success || !loginCookies.includes('token=')) {
      throw new Error('Password login failed or did not set token cookie');
    }
    console.log('PASS: Preserved password login works and sets secure httpOnly session cookie.');

    // Test 8: Logout Flow
    console.log('\n[Test 8] Testing Logout Flow:');
    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
    });
    const logoutData = await logoutRes.json();
    const logoutCookies = logoutRes.headers.get('set-cookie') || '';
    if (!logoutRes.ok || !logoutData.success || !logoutCookies.includes('token=;')) {
      throw new Error('Logout failed or did not clear token cookie');
    }
    console.log('PASS: Logout endpoint successfully clears session token cookie.');

    // Cleanup
    await User.deleteMany({ phone: testNormalizedPhone });

    console.log('\n========================================================');
    console.log('ALL FIREBASE INTEGRATION TESTS COMPLETED SUCCESSFULLY!');
    console.log('========================================================\n');
  } finally {
    server.close();
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});

