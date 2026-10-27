const mongoose = require('mongoose');

/**
 * Global cache across serverless function invocations on Vercel.
 * Preserves the connection instance and active connection promise in memory.
 */
let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

async function connectDB() {
  // Confirm and prioritize MONGODB_URI (Vercel standard), fallback to MONGO_URI
  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();

  if (!uri) {
    const err = new Error(
      'MONGODB_URI environment variable is missing. Please define MONGODB_URI in your Vercel Project Settings > Environment Variables.'
    );
    err.name = 'MissingMongoUriError';
    console.error('[db] Configuration error: MONGODB_URI is not set in process.env');
    throw err;
  }

  // 1 = connected: reuse active connection
  if (mongoose.connection.readyState === 1) {
    cached.conn = mongoose.connection;
    return cached.conn;
  }

  // 2 = connecting: reuse existing in-flight promise to avoid duplicate connection attempts
  if (mongoose.connection.readyState === 2 && cached.promise) {
    return cached.promise;
  }

  // Create new connection promise if not already connecting
  if (!cached.promise) {
    mongoose.set('strictQuery', true);

    const opts = {
      bufferCommands: false, // Fail immediately if disconnected rather than hanging
      serverSelectionTimeoutMS: 5000, // 5s timeout to prevent hitting Vercel's 10s serverless limit
      connectTimeoutMS: 5000,
      maxPoolSize: 10,
    };

    // Extract sanitized host for safe diagnostic logging (no passwords/users)
    let sanitizedHost = 'Atlas Cluster';
    try {
      const atIdx = uri.indexOf('@');
      if (atIdx !== -1) {
        sanitizedHost = uri.slice(atIdx + 1).split('/')[0].split('?')[0];
      }
    } catch (_) {}

    console.log(`[db] Connecting to MongoDB host: ${sanitizedHost}...`);

    cached.promise = mongoose
      .connect(uri, opts)
      .then((mongooseInstance) => {
        cached.conn = mongooseInstance.connection;
        console.log(
          `[db] MongoDB connected successfully to: ${cached.conn.host}/${cached.conn.name || 'default'}`
        );
        return cached.conn;
      })
      .catch((err) => {
        // Reset cached promise so subsequent requests can retry instead of holding rejected promise
        cached.promise = null;
        cached.conn = null;
        console.error(`[db] MongoDB connection failed [${err.name}]: ${err.message}`);
        throw err;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (err) {
    cached.promise = null;
    cached.conn = null;
    throw err;
  }

  return cached.conn;
}

module.exports = connectDB;
