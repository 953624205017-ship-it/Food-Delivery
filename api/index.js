const app = require('../server');
const connectDB = require('../config/db');

// Initiate database connection during serverless container cold start
connectDB().catch((err) => {
  console.warn(`[serverless-init] DB pre-connection notice [${err.name}]: ${err.message}`);
});

module.exports = app;
