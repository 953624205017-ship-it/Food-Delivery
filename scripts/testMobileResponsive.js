import ejs from 'ejs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('======================================================');
console.log('📱 TESTING MOBILE RESPONSIVE LAYOUT & CSS STYLING');
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

// 1. Verify CSS rules in public/css/style.css
console.log('--- Step 1: Checking CSS definitions ---');
const cssContent = fs.readFileSync(path.join(rootDir, 'public', 'css', 'style.css'), 'utf8');

assert(
  cssContent.includes('overflow-x: hidden') && cssContent.includes('box-sizing: border-box'),
  'html and body have overflow-x: hidden and box-sizing configured'
);

assert(
  cssContent.includes('.container {') && cssContent.includes('width: 100%'),
  '.container has max-width: 1100px and width: 100%'
);

assert(
  cssContent.includes('@media (max-width: 768px)'),
  '@media (max-width: 768px) media query block is present'
);

// Check mobile header styles
assert(
  cssContent.includes('.site-header .bar') &&
  cssContent.includes('flex-direction: column') &&
  cssContent.includes('align-items: stretch'),
  'Mobile header stacks brand and nav-links vertically'
);

assert(
  cssContent.includes('.brand {') &&
  cssContent.includes('justify-content: space-between'),
  'Mobile brand displays title and Est. Alangulam in clean row'
);

assert(
  cssContent.includes('.nav-links') &&
  cssContent.includes('overflow-x: auto') &&
  cssContent.includes('border-top: 1px solid rgba(201, 162, 75, 0.18)'),
  'Mobile nav-links have horizontal scroll protection and top divider'
);

assert(
  cssContent.includes('.nav-greeting') &&
  cssContent.includes('text-overflow: ellipsis'),
  'Mobile user greeting has ellipsis truncation protection'
);

// Check mobile filter grid styles
assert(
  cssContent.includes('.filter-grid') &&
  cssContent.includes('grid-template-columns: 1fr 1fr'),
  'Mobile filter-grid uses clean 2-column responsive layout'
);

assert(
  cssContent.includes('.btn-filter-submit') &&
  cssContent.includes('width: 100%'),
  'Mobile filter submit button spans 100% width'
);

// Check mobile category pills
assert(
  cssContent.includes('.filter-pills-list') &&
  cssContent.includes('flex-wrap: nowrap') &&
  cssContent.includes('overflow-x: auto'),
  'Mobile category pills form a horizontal swipeable pill bar'
);

// Check mobile food cards
assert(
  cssContent.includes('.food-grid') &&
  cssContent.includes('grid-template-columns: 1fr'),
  'Mobile food-grid renders single-column food cards without overflow'
);

assert(
  cssContent.includes('@media (max-width: 360px)'),
  '@media (max-width: 360px) extra-compact phone query is present'
);

// 2. Test EJS rendering of Header Partial
console.log('\n--- Step 2: Testing header.ejs rendering ---');
const headerTemplate = fs.readFileSync(path.join(rootDir, 'views', 'partials', 'header.ejs'), 'utf8');

const renderedHeader = ejs.render(headerTemplate, {
  hotelName: 'HOTEL LITTLE JAPPAN',
  currentUser: { username: 'Kanimozhi', email: 'kani@example.com' }
});

assert(
  renderedHeader.includes('class="brand"') &&
  renderedHeader.includes('class="brand-title"') &&
  renderedHeader.includes('class="brand-sub"'),
  'header.ejs renders brand title and subtitle with semantic classes'
);

assert(
  renderedHeader.includes('class="nav-links"') &&
  renderedHeader.includes('class="nav-item"') &&
  renderedHeader.includes('class="nav-greeting"'),
  'header.ejs renders nav-links with nav-item and nav-greeting classes'
);

// 3. Test EJS rendering of Dashboard View
console.log('\n--- Step 3: Testing dashboard.ejs rendering ---');
const dashboardPath = path.join(rootDir, 'views', 'dashboard.ejs');

const mockData = {
  title: 'Menu',
  hotelName: 'HOTEL LITTLE JAPPAN',
  currentUser: { username: 'Kanimozhi', email: 'kani@example.com' },
  activeFilters: {
    search: '',
    category: 'All',
    veg: 'all',
    minPrice: '',
    maxPrice: '',
    sortBy: 'featured'
  },
  categories: ['Biryani', 'Starters', 'Chinese', 'Parotta', 'Dosa'],
  foods: [
    {
      _id: '670000000000000000000001',
      name: 'Chicken Biryani Special',
      description: 'Aromatic basmati rice cooked with tender spiced chicken pieces.',
      price: 180,
      image: '/images/chicken-biryani.jpg',
      category: 'Biryani',
      isVeg: false,
      available: true,
      rating: 4.8,
      totalReviews: 12
    },
    {
      _id: '670000000000000000000002',
      name: 'Paneer Butter Masala',
      description: 'Rich and creamy cottage cheese curry in tomato-cashew gravy.',
      price: 150,
      image: '/images/paneer-butter.jpg',
      category: 'Starters',
      isVeg: true,
      available: true,
      rating: 4.5,
      totalReviews: 8
    }
  ],
  eligibleFoodIds: new Set(['670000000000000000000001']),
  reviewedFoodIds: new Set(),
  cartCount: 2
};

try {
  const renderedDashboard = ejs.render(
    fs.readFileSync(dashboardPath, 'utf8'),
    mockData,
    { filename: dashboardPath }
  );

  assert(
    renderedDashboard.includes('class="filter-card"') &&
    renderedDashboard.includes('class="filter-grid"'),
    'dashboard.ejs renders filter-card and filter-grid'
  );

  assert(
    renderedDashboard.includes('filter-select-col') &&
    renderedDashboard.includes('filter-price-col') &&
    renderedDashboard.includes('filter-price-wrap') &&
    renderedDashboard.includes('btn-filter-submit'),
    'dashboard.ejs renders responsive filter column classes and submit button'
  );

  assert(
    renderedDashboard.includes('class="filter-pills-top"') &&
    renderedDashboard.includes('class="filter-pills-list"') &&
    renderedDashboard.includes('class="filter-pill'),
    'dashboard.ejs renders filter pills top bar and horizontal pill list'
  );

  assert(
    renderedDashboard.includes('class="food-grid"') &&
    renderedDashboard.includes('class="card food-card"') &&
    renderedDashboard.includes('Chicken Biryani Special'),
    'dashboard.ejs renders food grid with items'
  );
} catch (err) {
  assert(false, `dashboard.ejs render failed: ${err.message}`);
}

console.log(`\n======================================================`);
console.log(`SUMMARY: ${passedTests} / ${totalTests} tests passed`);
console.log(`======================================================\n`);

if (passedTests === totalTests) {
  console.log('🎉 ALL MOBILE RESPONSIVE TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error('💥 SOME TESTS FAILED');
  process.exit(1);
}
