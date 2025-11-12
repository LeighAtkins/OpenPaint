const app = require('../app');

// Vercel serverless function handler
module.exports = (req, res) => {
    return app(req, res);
};