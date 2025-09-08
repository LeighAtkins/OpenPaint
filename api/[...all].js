const app = require('../server/app');

module.exports = (req, res) => {
    // Vercel calls this at /api/*; Express should see the path WITHOUT /api
    if (req.url.startsWith('/api')) {
        req.url = req.url.slice(4) || '/';
    }
    return app(req, res);
};