import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('======================================================');
console.log('🛡️ TESTING ALL ADMIN PANEL PAGES & CSS STYLING');
console.log('======================================================\n');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passedTests++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// 1. Admin Login
console.log('--- 1. Testing views/admin/login.ejs ---');
try {
  const loginPath = path.join(rootDir, 'views', 'admin', 'login.ejs');
  const renderedLogin = ejs.render(
    fs.readFileSync(loginPath, 'utf8'),
    { title: 'Admin Login', hotelName: 'HOTEL LITTLE JAPPAN' },
    { filename: loginPath }
  );
  assert(renderedLogin.includes('id="adminLoginForm"'), 'Admin login contains id="adminLoginForm"');
  assert(renderedLogin.includes('id="username"') && renderedLogin.includes('name="username"'), 'Admin login preserves username input');
  assert(renderedLogin.includes('id="password"') && renderedLogin.includes('name="password"'), 'Admin login preserves password input');
  assert(renderedLogin.includes('/api/admin/login'), 'Admin login preserves login API endpoint');
} catch (err) {
  assert(false, `views/admin/login.ejs render error: ${err.message}`);
}

// 2. Admin Dashboard & Analytics
console.log('\n--- 2. Testing views/admin/dashboard.ejs ---');
try {
  const dashboardPath = path.join(rootDir, 'views', 'admin', 'dashboard.ejs');
  const mockDashboardData = {
    title: 'Admin Dashboard',
    hotelName: 'HOTEL LITTLE JAPPAN',
    dateFilter: { startDate: '2026-10-01', endDate: '2026-10-28' },
    stats: {
      totalRevenue: 154200,
      todayRevenue: 14200,
      todayOrdersCount: 18,
      monthlyRevenue: 385000,
      monthOrdersCount: 420,
      totalOrders: 1540,
      paidOrdersCount: 1480,
      pendingOrdersCount: 12,
      cancelledOrdersCount: 48,
      totalReviewsCount: 86,
      foodCount: 34
    },
    maxChartSales: 25000,
    chartDays: [
      { date: '2026-10-22', label: 'Wed', sales: 12000, orders: 15 },
      { date: '2026-10-23', label: 'Thu', sales: 15500, orders: 19 },
      { date: '2026-10-24', label: 'Fri', sales: 18900, orders: 24 },
      { date: '2026-10-25', label: 'Sat', sales: 24000, orders: 32 },
      { date: '2026-10-26', label: 'Sun', sales: 22500, orders: 29 },
      { date: '2026-10-27', label: 'Mon', sales: 14000, orders: 18 },
      { date: '2026-10-28', label: 'Tue', sales: 16800, orders: 21 }
    ],
    bestSellers: [
      { name: 'Special Chicken Biryani', totalQuantity: 120, totalRevenue: 21600 },
      { name: 'Paneer Butter Masala', totalQuantity: 85, totalRevenue: 12750 }
    ],
    recentOrders: [
      {
        _id: '670000000000000000000099',
        createdAt: new Date(),
        user: { username: 'Gowtham', phone: '9876543210' },
        items: [{ name: 'Chicken Biryani', quantity: 2 }],
        totalAmount: 360,
        payment: { provider: 'upi', status: 'paid' },
        status: 'DELIVERED'
      }
    ]
  };
  const renderedDashboard = ejs.render(
    fs.readFileSync(dashboardPath, 'utf8'),
    mockDashboardData,
    { filename: dashboardPath }
  );
  assert(renderedDashboard.includes('Analytics Dashboard'), 'Admin dashboard renders title');
  assert(renderedDashboard.includes('Verified Revenue') && renderedDashboard.includes('1,54,200'), 'Admin dashboard renders KPI cards');
  assert(renderedDashboard.includes('chart-bars'), 'Admin dashboard renders 7-day revenue chart');
  assert(renderedDashboard.includes('Special Chicken Biryani'), 'Admin dashboard renders best sellers table');
} catch (err) {
  assert(false, `views/admin/dashboard.ejs render error: ${err.message}`);
}

// 3. Manage Foods (Add & Edit Food Items)
console.log('\n--- 3. Testing views/admin/foods.ejs ---');
try {
  const foodsPath = path.join(rootDir, 'views', 'admin', 'foods.ejs');
  const mockFoodsData = {
    title: 'Manage Foods',
    hotelName: 'HOTEL LITTLE JAPPAN',
    foods: [
      {
        _id: '670000000000000000000001',
        name: 'Mutton Chukka',
        price: 240,
        category: 'Starters',
        isVeg: false,
        available: true,
        image: '/images/mutton-chukka.jpg',
        description: 'Spicy pan-seared mutton cubes with curry leaves.'
      }
    ]
  };
  const renderedFoods = ejs.render(
    fs.readFileSync(foodsPath, 'utf8'),
    mockFoodsData,
    { filename: foodsPath }
  );
  assert(renderedFoods.includes('id="addFoodForm"'), 'Manage Foods preserves id="addFoodForm"');
  assert(renderedFoods.includes('id="addFoodPreview"'), 'Manage Foods includes instant image preview container');
  assert(renderedFoods.includes('id="editFoodModal"'), 'Manage Foods includes Edit Food modal');
  assert(renderedFoods.includes('class="btn btn-sm btn-outline toggle-btn"'), 'Manage Foods preserves availability toggle button');
  assert(renderedFoods.includes('class="btn btn-sm btn-danger delete-btn"'), 'Manage Foods preserves delete button');
} catch (err) {
  assert(false, `views/admin/foods.ejs render error: ${err.message}`);
}

// 4. View and Manage Orders & Order Details
console.log('\n--- 4. Testing views/admin/orders.ejs ---');
try {
  const ordersPath = path.join(rootDir, 'views', 'admin', 'orders.ejs');
  const mockOrdersData = {
    title: 'Orders',
    hotelName: 'HOTEL LITTLE JAPPAN',
    statusFilter: '',
    orders: [
      {
        _id: '670000000000000000000002',
        createdAt: new Date(),
        user: { username: 'Ashok', phone: '9123456789' },
        items: [{ name: 'Chicken Fried Rice', quantity: 1, price: 160 }],
        totalAmount: 160,
        payment: { provider: 'upi', status: 'pending' },
        distanceKm: 4.2,
        status: 'PAYMENT_VERIFICATION_PENDING'
      }
    ],
    page: 1,
    totalPages: 3
  };
  const renderedOrders = ejs.render(
    fs.readFileSync(ordersPath, 'utf8'),
    mockOrdersData,
    { filename: ordersPath }
  );
  assert(renderedOrders.includes('btn-verify-upi'), 'Orders page includes UPI verification button');
  assert(renderedOrders.includes('class="status-select"'), 'Orders page preserves status update select');
  assert(renderedOrders.includes('id="orderDetailsModal"'), 'Orders page includes Order Details modal');
  assert(renderedOrders.includes('view-order-btn'), 'Orders page includes view order details buttons');
} catch (err) {
  assert(false, `views/admin/orders.ejs render error: ${err.message}`);
}

// 5. Customer Reviews Moderation
console.log('\n--- 5. Testing views/admin/reviews.ejs ---');
try {
  const reviewsPath = path.join(rootDir, 'views', 'admin', 'reviews.ejs');
  const mockReviewsData = {
    title: 'Customer Reviews',
    hotelName: 'HOTEL LITTLE JAPPAN',
    statusFilter: 'all',
    reviews: [
      {
        _id: '670000000000000000000003',
        createdAt: new Date(),
        food: { name: 'Mutton Biryani', image: '/images/mutton-biryani.jpg' },
        user: { username: 'Suresh', email: 'suresh@example.com' },
        rating: 5,
        comment: 'Authentic Alangulam taste! Highly recommended.',
        status: 'approved'
      }
    ]
  };
  const renderedReviews = ejs.render(
    fs.readFileSync(reviewsPath, 'utf8'),
    mockReviewsData,
    { filename: reviewsPath }
  );
  assert(renderedReviews.includes('toggle-status-btn'), 'Reviews moderation includes approve/hide toggle button');
  assert(renderedReviews.includes('delete-review-btn'), 'Reviews moderation includes delete review button');
  assert(renderedReviews.includes('Authentic Alangulam taste!'), 'Reviews moderation displays review text');
} catch (err) {
  assert(false, `views/admin/reviews.ejs render error: ${err.message}`);
}

// 6. Delivery Zones Management
console.log('\n--- 6. Testing views/admin/delivery-zones.ejs ---');
try {
  const zonesPath = path.join(rootDir, 'views', 'admin', 'delivery-zones.ejs');
  const mockZonesData = {
    title: 'Delivery Zones',
    hotelName: 'HOTEL LITTLE JAPPAN',
    zones: [
      {
        _id: '670000000000000000000004',
        label: 'Zone 1 - Alangulam Town',
        minAmount: 1000,
        maxDistanceKm: 6,
        districtRestriction: 'Tenkasi',
        active: true
      }
    ]
  };
  const renderedZones = ejs.render(
    fs.readFileSync(zonesPath, 'utf8'),
    mockZonesData,
    { filename: zonesPath }
  );
  assert(renderedZones.includes('id="addZoneForm"'), 'Delivery zones preserves id="addZoneForm"');
  assert(renderedZones.includes('toggle-zone-btn'), 'Delivery zones preserves activate/deactivate button');
  assert(renderedZones.includes('delete-zone-btn'), 'Delivery zones preserves delete zone button');
} catch (err) {
  assert(false, `views/admin/delivery-zones.ejs render error: ${err.message}`);
}

// 7. Verify Customer Facing pages remain 100% UNTOUCHED
console.log('\n--- 7. Verifying Customer Pages are completely isolated ---');
const customerPages = ['views/login.ejs', 'views/register.ejs', 'views/dashboard.ejs', 'views/cart.ejs', 'views/orders.ejs'];
for (const cp of customerPages) {
  const content = fs.readFileSync(path.join(rootDir, cp), 'utf8');
  assert(!content.includes('admin.css'), `${cp} does not reference admin.css (100% isolated)`);
}

console.log(`\n======================================================`);
console.log(`SUMMARY: ${passedTests} / ${totalTests} tests passed`);
console.log(`======================================================\n`);

if (passedTests === totalTests) {
  console.log('🎉 ALL ADMIN PANEL PAGES TESTED & PASSED 100%!');
  process.exit(0);
} else {
  console.error('💥 SOME TESTS FAILED');
  process.exit(1);
}

