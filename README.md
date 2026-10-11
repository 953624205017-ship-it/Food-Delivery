# Hotel Little Jappan — Food Delivery Web App

A full-stack, production-ready food ordering application for **Hotel Little Jappan**
(Owner: Ashok Kumar S). Premium gold + charcoal UI, real OTP verification, real
map-based delivery-distance checks, Razorpay online payment with server-side
verification, an admin panel, and PDF bill generation.

---

## 1. Project structure

```
hotel-little-jappan/
├── server.js                 # App entry point
├── config/db.js              # MongoDB connection
├── models/                   # Mongoose schemas (User, Admin, Food, Order, Otp, DeliveryZone)
├── middleware/                # auth, adminAuth, rateLimiter
├── utils/                     # otpService, mapService, paymentService, eligibility, pricing, billGenerator
├── routes/                    # auth, food, order, payment, admin
├── views/                     # EJS templates (customer + admin/)
├── public/                    # css, js, placeholder images
├── uploads/                   # admin-uploaded food images (created at runtime)
├── scripts/createAdmin.js     # bootstraps the first admin + default delivery zones
└── .env.example                # copy to .env and fill in
```

## 2. Requirements

- Node.js 18+
- A MongoDB database (local, or a free MongoDB Atlas cluster)
- Accounts/API keys for:
  - **Twilio** (OTP SMS) — https://www.twilio.com/console
  - **Google Maps Platform** (Geocoding API + Distance Matrix API enabled) — https://console.cloud.google.com/google/maps-apis
  - **Razorpay** (online payments) — https://dashboard.razorpay.com/app/keys

## 3. Local setup

```bash
cd hotel-little-jappan
npm install
cp .env.example .env
```

Edit `.env` and fill in:
- `MONGO_URI` — e.g. `mongodb://127.0.0.1:27017/hotel_little_jappan` or your Atlas URI
- `SESSION_SECRET`, `JWT_SECRET` — any long random strings
- `OWNER_PHONE`, `HOTEL_LATITUDE`, `HOTEL_LONGITUDE` — the hotel's real phone & coordinates
- `TWILIO_*` — your Twilio credentials (leave blank during early dev — OTPs will
  print to the server console instead of sending real SMS)
- `GOOGLE_MAPS_API_KEY` — required for real distance checks (no fallback — the
  app refuses to guess a distance)
- `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`
- `ADMIN_BOOTSTRAP_*` — used once to create your first admin login

Then create the admin account and default delivery zones:

```bash
npm run seed:admin
```

Start the app:

```bash
npm run dev      # with nodemon, auto-restarts on changes
# or
npm start
```

Visit:
- Customer site: http://localhost:3000
- Admin panel: http://localhost:3000/admin/login

## 4. How the money-critical logic works

- **Prices**: the frontend never sends a trusted price. `utils/pricing.js`
  recomputes every order total from the `Food` collection at both quote-time
  and order-creation time.
- **Distance**: `utils/mapService.js` geocodes the submitted address with
  Google Geocoding, then calls the Distance Matrix API for real road distance
  from the hotel's configured coordinates. A customer-entered distance is
  never trusted or even accepted.
- **Delivery eligibility**: `utils/eligibility.js` reads active `DeliveryZone`
  documents (editable at `/admin/settings/delivery-zones`) instead of
  hard-coded numbers, so the owner can change radii/areas any time.
- **Payment**: `utils/paymentService.js` verifies Razorpay's HMAC signature
  server-side after checkout. An order is marked `PAID` **only** after that
  verification succeeds — never from the frontend's success callback alone.
- **OTP**: hashed (SHA-256) and stored with a Mongo TTL index so it
  auto-expires and is never kept in plain text; resend is rate-limited
  per phone number.

## 5. Admin workflow

1. Log in at `/admin/login` with the bootstrap credentials.
2. **Manage Foods**: add/edit/delete items, upload images, toggle
   Available/Sold Out — changes appear on the customer dashboard immediately.
3. **Orders**: filter by status, update status through the pipeline
   (Pending → Paid → Preparing → Ready → Out for Delivery → Delivered /
   Cancelled).
4. **Delivery Zones**: add/edit/deactivate the amount-based delivery tiers
   without touching code.

## 6. Deployment notes

- Set `NODE_ENV=production` and use real, secret values for
  `SESSION_SECRET` / `JWT_SECRET` / `RAZORPAY_KEY_SECRET` / `TWILIO_AUTH_TOKEN`.
- Put the app behind HTTPS (cookies are `secure` in production, so plain HTTP
  logins will silently fail).
- Use MongoDB Atlas or a managed Mongo instance; whitelist your server's IP.
- `helmet`'s CSP is currently relaxed to let the Razorpay checkout script and
  Google Maps calls load easily in development — tighten
  `contentSecurityPolicy` in `server.js` for production hardening once you've
  finalized which external script/style/image hosts you use.
- Uploaded food images are stored on local disk (`/uploads`) — on most PaaS
  hosts (Render, Railway, Heroku) local disk is ephemeral, so for production
  swap `multer`'s disk storage in `routes/admin.js` for an S3/Cloudinary
  adapter if you deploy somewhere without persistent storage.
- Run `npm run seed:admin` once against your production database to create
  the real admin login and default delivery zones, then change the admin
  password.

## 7. What's stubbed vs. real

Every integration point (OTP, maps, payment) calls the real third-party API —
there is no fake/demo mode baked into the business logic. The only thing
required to go live is filling in real API keys in `.env`:

| Feature | Provider | Falls back to (only if key missing) |
|---|---|---|
| OTP SMS | Twilio | Logs the code to the server console (dev only) |
| Geocoding + distance | Google Maps Platform | Throws a clear "not configured" error — never guesses |
| Payment | Razorpay | Throws a clear "not configured" error — never marks an order paid |

## 8. Order flow (as implemented)

```
Register → OTP verify → Login → Dashboard (menu) → Select qty → Buy Now
  → Order page → Enter address → Check eligibility (real geocode + distance)
  → Confirm & Pay (Razorpay) → Server verifies signature → Payment success
  animation → Order Confirmation (with a tap-to-call button for the hotel)
  → Bill (view / download PDF / print)
```
