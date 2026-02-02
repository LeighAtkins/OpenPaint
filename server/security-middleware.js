/**
 * Security Middleware for OpenPaint (CommonJS)
 * Provides comprehensive security hardening for Express applications
 */

const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

/**
 * Apply Helmet.js security middleware
 */
function applyHelmet(app) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", '*.cloudflare.com'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', '*'],
          connectSrc: ["'self'", '*'],
          fontSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
}

/**
 * Apply rate limiting
 */
function applyRateLimiting(app) {
  // General API rate limit
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: { success: false, message: 'Too many requests, slow down' },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Strict limit for auth/upload endpoints
  const strictLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    message: { success: false, message: 'Rate limit exceeded' },
  });

  app.use('/api/', apiLimiter);
  app.use('/upload', strictLimiter);
  app.use('/share', strictLimiter);
}

/**
 * Input sanitization middleware
 */
function sanitizeInput(req, res, next) {
  const sanitize = obj => {
    if (typeof obj === 'string') {
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+=/gi, '');
    }
    if (typeof obj === 'object' && obj !== null) {
      for (const key in obj) {
        obj[key] = sanitize(obj[key]);
      }
    }
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.query) req.query = sanitize(req.query);
  next();
}

/**
 * Apply all security middleware
 */
function applySecurityMiddleware(app) {
  applyHelmet(app);
  applyRateLimiting(app);
  app.use(sanitizeInput);
  console.log('[Security] All security middleware applied');
}

module.exports = {
  applyHelmet,
  applyRateLimiting,
  sanitizeInput,
  applySecurityMiddleware,
};
