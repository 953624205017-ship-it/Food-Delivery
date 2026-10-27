/**
 * Verification test suite for Admin Authentication and Token Lifecycle.
 * Tests:
 * 1. issueAdminToken generation and cookie creation.
 * 2. Audience ('admin') verification and separation from customer tokens.
 * 3. Invalid credentials rejection (401).
 * 4. Successful login (200 + redirect: '/admin').
 * 5. Protected dashboard access (/admin) via requireAdmin middleware.
 * 6. Admin logout and cookie clearing.
 */

require('dotenv').config();
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Admin = require('../models/Admin');
const app = require('../server');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests += 1;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  } else {
    passedTests += 1;
    console.log(`  ✓ PASS: ${message}`);
  }
}

async function run() {
  console.log('\n======================================================');
  console.log('🔐 HOTEL LITTLE JAPPAN — ADMIN AUTH TEST SUITE');
  console.log('======================================================\n');

  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test_jwt_secret_hotel_little_jappan_2026';
  }

  await connectDB();

  // 1. Create or retrieve test admin
  const testAdminUsername = `testadmin_${Date.now()}`;
  const testAdminPassword = 'AdminSecretPass123!';

  const admin = new Admin({
    username: testAdminUsername,
    role: 'staff',
  });
  await admin.setPassword(testAdminPassword);
  await admin.save();
  console.log(`Created test admin user: ${testAdminUsername}`);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(3009, resolve));
  const baseUrl = 'http://127.0.0.1:3009';

  try {
    // -----------------------------------------------------------------
    // TEST 1: Protected /admin without cookie redirects to /admin/login
    // -----------------------------------------------------------------
    console.log('\n--- 1. Testing Unauthenticated Access ---');
    const unauthRes = await fetch(`${baseUrl}/admin`, { redirect: 'manual' });
    assert(
      unauthRes.status === 302 && unauthRes.headers.get('location') === '/admin/login',
      'GET /admin without token redirects to /admin/login'
    );

    // -----------------------------------------------------------------
    // TEST 2: Missing credentials on /api/admin/login returns 400
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Missing Credentials ---');
    const emptyRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert(emptyRes.status === 400, 'POST /api/admin/login with empty body returns 400 Bad Request');

    // -----------------------------------------------------------------
    // TEST 3: Invalid credentials on /api/admin/login returns 401
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Invalid Credentials ---');
    const invalidRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testAdminUsername, password: 'wrongpassword' }),
    });
    const invalidData = await invalidRes.json();
    assert(invalidRes.status === 401, 'POST /api/admin/login with bad password returns 401 Unauthorized');
    assert(invalidData.message === 'Invalid admin credentials.', 'Returns exact error message');

    // -----------------------------------------------------------------
    // TEST 4: Valid credentials -> 200 OK + admin_token cookie + redirect
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing Successful Admin Login ---');
    const loginRes = await fetch(`${baseUrl}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: testAdminUsername, password: testAdminPassword }),
    });
    const loginData = await loginRes.json();
    assert(loginRes.status === 200, 'POST /api/admin/login with correct password returns 200 OK');
    assert(loginData.success === true, 'Response contains success: true');
    assert(loginData.redirect === '/admin', 'Response contains redirect: /admin');

    // Extract admin_token cookie from Set-Cookie header
    const setCookieHeader = loginRes.headers.get('set-cookie');
    assert(Boolean(setCookieHeader), 'Login response contains Set-Cookie header');
    assert(setCookieHeader.includes('admin_token='), 'Set-Cookie contains admin_token');
    assert(setCookieHeader.includes('HttpOnly'), 'admin_token has HttpOnly flag');
    assert(setCookieHeader.includes('Path=/'), 'admin_token has Path=/ flag');

    const tokenMatch = setCookieHeader.match(/admin_token=([^;]+)/);
    const adminToken = tokenMatch ? tokenMatch[1] : null;
    assert(Boolean(adminToken), 'Successfully extracted admin JWT token');

    // -----------------------------------------------------------------
    // TEST 5: Verify JWT payload and audience ('admin')
    // -----------------------------------------------------------------
    console.log('\n--- 5. Testing JWT Structure & Audience ---');
    const decoded = jwt.verify(adminToken, process.env.JWT_SECRET, { audience: 'admin' });
    assert(decoded.id === admin._id.toString(), 'JWT payload.id matches admin._id');
    assert(decoded.username === testAdminUsername, 'JWT payload.username matches admin username');
    assert(decoded.aud === 'admin', 'JWT audience matches "admin"');

    // Verify customer token without audience 'admin' is rejected by requireAdmin
    const fakeCustomerToken = jwt.sign({ id: admin._id.toString() }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });
    let customerTokenRejected = false;
    try {
      jwt.verify(fakeCustomerToken, process.env.JWT_SECRET, { audience: 'admin' });
    } catch (_) {
      customerTokenRejected = true;
    }
    assert(customerTokenRejected, 'Customer tokens lacking audience: "admin" fail verification');

    // -----------------------------------------------------------------
    // TEST 6: Protected /admin access with valid admin_token cookie
    // -----------------------------------------------------------------
    console.log('\n--- 6. Testing Protected Dashboard Access ---');
    const dashboardRes = await fetch(`${baseUrl}/admin`, {
      headers: {
        Cookie: `admin_token=${adminToken}`,
      },
    });
    const dashboardHtml = await dashboardRes.text();
    assert(dashboardRes.status === 200, 'GET /admin with valid admin_token cookie returns 200 OK');
    assert(
      dashboardHtml.includes('HOTEL LITTLE JAPPAN') || dashboardHtml.includes('Dashboard'),
      'Admin dashboard rendered successfully'
    );

    // -----------------------------------------------------------------
    // TEST 7: Admin Logout clears admin_token cookie
    // -----------------------------------------------------------------
    console.log('\n--- 7. Testing Admin Logout ---');
    const logoutRes = await fetch(`${baseUrl}/api/admin/logout`, {
      method: 'POST',
      headers: {
        Cookie: `admin_token=${adminToken}`,
      },
    });
    const logoutData = await logoutRes.json();
    assert(logoutRes.status === 200, 'POST /api/admin/logout returns 200 OK');
    assert(logoutData.redirect === '/admin/login', 'Logout returns redirect: /admin/login');

    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert(
      logoutCookie.includes('admin_token=;') || logoutCookie.includes('Expires=Thu, 01 Jan 1970'),
      'admin_token cookie is cleared upon logout'
    );

    console.log('\n======================================================');
    console.log(`🎉 ALL ADMIN AUTH TESTS PASSED: ${passedTests}/${totalTests}`);
    console.log('======================================================\n');
  } finally {
    // Cleanup test admin and stop test server
    await Admin.deleteOne({ _id: admin._id }).catch(() => {});
    await new Promise((resolve) => server.close(resolve));
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});

