/**
 * Security Middleware for OpenPaint
 * Provides comprehensive security hardening for Express applications
 */

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

/**
 * Helmet.js security middleware
 * Sets various HTTP headers to protect against well-known web vulnerabilities
 */
export function applyHelmet(app) {
  // Apply basic helmet middleware
  app.use(helmet());

  // Configure Content Security Policy
  app.use(
    helmet.contentSecurityPolicy({
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          '*.cloudflare.com',
          '*.cloudflareinsights.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", '*.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'blob:', '*.cloudinary.com', '*.imagedelivery.net'],
        connectSrc: ["'self'", '*.cloudflare.com', '*.cloudflareinsights.com'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    })
  );

  // Configure HSTS (HTTP Strict Transport Security)
  app.use(
    helmet.hsts({
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    })
  );

  // Remove X-Powered-By header
  app.use(helmet.hidePoweredBy());

  // Prevent clickjacking
  app.use(helmet.frameguard({ action: 'deny' }));

  // Prevent MIME type sniffing
  app.use(helmet.noSniff());

  // Enable XSS filter
  app.use(helmet.xssFilter());

  // Referrer policy
  app.use(helmet.referrerPolicy({ policy: 'strict-origin-when-cross-origin' }));

  console.log('[Security] Helmet middleware applied');
}

/**
 * Rate limiting middleware
 * Protects against brute force attacks and DDoS
 */
export function applyRateLimit(app) {
  // General rate limit for all endpoints
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.warn(`[Security] Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        success: false,
        message: 'Too many requests from this IP, please try again later.',
      });
    },
  });

  // Stricter limit for API endpoints
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 50, // Limit each IP to 50 API requests per windowMs
    message: 'Too many API requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.warn(`[Security] API rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        success: false,
        message: 'Too many API requests from this IP, please try again later.',
      });
    },
  });

  // Even stricter limit for AI endpoints
  const aiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Limit each IP to 10 AI requests per minute
    message: 'Too many AI requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      console.warn(`[Security] AI rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        success: false,
        message: 'Too many AI requests from this IP, please try again later.',
      });
    },
  });

  // Apply limiters to routes
  app.use('/api/', apiLimiter);
  app.use('/ai/', aiLimiter);
  app.use(limiter);

  console.log('[Security] Rate limiting middleware applied');
}

/**
 * HTTPS enforcement middleware
 * Redirects HTTP to HTTPS in production
 */
export function applyHttpsEnforcement(app) {
  if (process.env.NODE_ENV === 'production') {
    app.use((req, res, next) => {
      if (req.secure) {
        return next();
      }
      res.redirect(301, `https://${req.headers.host}${req.url}`);
    });
    console.log('[Security] HTTPS enforcement enabled (production)');
  } else {
    console.log('[Security] HTTPS enforcement disabled (development)');
  }
}

/**
 * Sanitize console logs
 * Removes sensitive data before logging
 */
export function sanitizeLogData(data) {
  const sensitiveKeys = ['password', 'token', 'secret', 'api_key', 'private_key', 'editToken'];
  const sanitized = { ...data };

  for (const key of Object.keys(sanitized)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some(sensitive => lowerKey.includes(sensitive))) {
      sanitized[key] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Safe console logger with sanitization
 */
export const safeLog = {
  log: (message, data) => {
    const sanitizedData = data ? sanitizeLogData(data) : undefined;
    console.log(message, sanitizedData || '');
  },
  warn: (message, data) => {
    const sanitizedData = data ? sanitizeLogData(data) : undefined;
    console.warn(message, sanitizedData || '');
  },
  error: (message, data) => {
    const sanitizedData = data ? sanitizeLogData(data) : undefined;
    console.error(message, sanitizedData || '');
  },
  info: (message, data) => {
    const sanitizedData = data ? sanitizeLogData(data) : undefined;
    console.info(message, sanitizedData || '');
  },
};

/**
 * Input sanitization for shared projects
 * Prevents XSS and injection attacks
 */
export function sanitizeProjectData(projectData) {
  if (!projectData || typeof projectData !== 'object') {
    return projectData;
  }

  const sanitized = {};

  for (const [key, value] of Object.entries(projectData)) {
    if (typeof value === 'string') {
      // Basic HTML escaping to prevent XSS
      sanitized[key] = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeProjectData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Validate share ID format
 */
export function isValidShareId(shareId) {
  // Share IDs should be 24 hex characters
  return /^[a-f0-9]{24}$/i.test(shareId);
}

/**
 * Production guard for debug endpoints
 */
export function applyProductionGuards(app) {
  const isProduction = process.env.NODE_ENV === 'production';

  // Wrap debug endpoints with production guard
  app.get('/env-check', (req, res) => {
    if (isProduction) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({
      AI_WORKER_URL: (process.env.AI_WORKER_URL || '').trim(),
      HAS_AI_WORKER_KEY: Boolean((process.env.AI_WORKER_KEY || '').trim()),
      ROUTES_MOUNTED: true,
    });
  });

  app.get('/version', (req, res) => {
    if (isProduction) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ commit: process.env.VERCEL_GIT_COMMIT_SHA || null, ts: Date.now() });
  });

  console.log(
    `[Security] Production guards applied (${isProduction ? 'production mode' : 'development mode'})`
  );
}
