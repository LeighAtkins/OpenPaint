/**
 * Vercel serverless function entry point
 * Wraps the clean Express app from server/app.js
 */

const app = require('../server/app');

// Export the Express app as a Vercel serverless function
module.exports = app;
