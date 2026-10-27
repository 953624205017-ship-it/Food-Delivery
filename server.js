
require('dotenv').config();

const express = require('express');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const methodOverride = require('method-override');
const mongoSanitize = require('express-mongo-sanitize');

const connectDB = require('./config/db');
const { apiLimiter } = require('./middleware/rateLimiter');
const { attachUserIfPresent } = require('./middleware/auth');


const authRoutes = require('./routes/auth');
const foodRoutes = require('./routes/food');
const orderRoutes = require('./routes/order');
const paymentRoutes = require('./routes/payment');
const adminRoutes = require('./routes/admin');

const app = express();

// ---------- View engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Core middleware ----------
app.use(
  helmet({
    contentSecurityPolicy: false, // relaxed for inline Razorpay checkout / map scripts in dev; tighten in production
  })
);
app.use(compression());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(mongoSanitize());

// Allow CORS for React and external clients
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use('/api', apiLimiter);

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use((req, res, next) => {
  res.locals.hotelName = process.env.HOTEL_NAME || 'HOTEL LITTLE JAPPAN';
  res.locals.ownerName = process.env.OWNER_NAME || 'Ashok Kumar S';
  res.locals.currentUser = null;
  res.locals.currentAdmin = null;
  next();
});

app.use(async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (err) {
    const errorName = err.name || 'DatabaseConnectionError';
    let safeMessage = err.message || 'Unable to connect to database.';

    // Sanitize any potential connection credentials in error message
    safeMessage = safeMessage.replace(/:\/\/([^:]+):([^@]+)@/g, '://***:***@');

    console.error(`[server] Database connection error [${errorName}]: ${safeMessage}`);

    let hint = '';
    if (
      errorName === 'MongooseServerSelectionError' ||
      safeMessage.includes('IP') ||
      safeMessage.includes('whitelist')
    ) {
      hint = ' (Check MongoDB Atlas: Go to Atlas Dashboard > Network Access > Add IP Address > Allow Access From Anywhere "0.0.0.0/0")';
    } else if (errorName === 'MissingMongoUriError') {
      hint = ' (Check Vercel: Set MONGODB_URI in Project Settings > Environment Variables)';
    }

    const fullDiagnostic = `${safeMessage}${hint}`;

    if (req.originalUrl.startsWith('/api/')) {
      return res.status(500).json({
        success: false,
        error: errorName,
        message: fullDiagnostic,
      });
    }

    return res.status(500).render('error', {
      title: 'Database connection error',
      message: fullDiagnostic,
    });
  }
});

app.use(attachUserIfPresent);


// ---------- Routes ----------
app.get('/', (req, res) =>
  res.redirect(res.locals.currentUser ? '/dashboard' : '/login')
);

app.use('/', authRoutes);
app.use('/', foodRoutes);
app.use('/', orderRoutes);
app.use('/', paymentRoutes);
app.use('/', adminRoutes);

// ---------- 404 ----------
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Not found',
    message: 'Page not found.',
  });
});

// ---------- Central error handler ----------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);

  if (req.originalUrl.startsWith('/api/')) {
    return res.status(err.status || 500).json({
      success: false,
      message: err.message || 'Server error.',
    });
  }

  res.status(err.status || 500).render('error', {
    title: 'Something went wrong',
    message:
      process.env.NODE_ENV === 'production'
        ? 'Something went wrong. Please try again.'
        : err.message,
  });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  connectDB()
    .then(() => {
      app.listen(PORT, () =>
        console.log(
          `[server] Hotel Little Jappan running on http://localhost:${PORT}`
        )
      );
    })
    .catch((err) => {
      console.error('[server] Failed to connect to database:', err.message);
      process.exit(1);
    });
}

module.exports = app;
