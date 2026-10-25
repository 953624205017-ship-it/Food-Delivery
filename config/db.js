const mongoose = require('mongoose');

let cachedPromise = null;

async function connectDB() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('Neither MONGO_URI nor MONGODB_URI is set in the environment.');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (cachedPromise) {
    return cachedPromise;
  }

  mongoose.set('strictQuery', true);

  cachedPromise = mongoose
    .connect(uri, {
      serverSelectionTimeoutMS: 8000,
    })
    .then((conn) => {
      console.log(`[db] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
      return conn.connection;
    })
    .catch((err) => {
      cachedPromise = null;
      console.error('[db] MongoDB connection error:', err.message);
      throw err;
    });

  return cachedPromise;
}

module.exports = connectDB;
