# OpenPaint Deployment Guide

This guide covers deploying OpenPaint to Vercel with URL sharing capabilities.

## Quick Start

### 1. Prerequisites
- Node.js 16+ installed
- Vercel CLI installed: `npm i -g vercel`
- Git repository connected to Vercel

### 2. Deploy to Vercel

```bash
# Clone/navigate to your project
cd openpaint

# Install dependencies
npm install

# Login to Vercel (first time only)
vercel login

# Deploy to production
npm run deploy

# Or deploy a preview
npm run deploy:preview
```

### 3. Environment Setup

The app works out of the box with no additional environment variables required for basic functionality.

## Features Included

✅ **Vercel Deployment Ready**
- Optimized `vercel.json` configuration
- Serverless function support
- Static file serving
- Security headers configured

✅ **URL Sharing System**
- Create shareable project links
- Customer measurement collection
- 30-day link expiration (configurable)
- Responsive customer interface

✅ **Production Optimizations**
- Efficient asset serving
- Error handling middleware
- CORS configuration
- Security headers

## How URL Sharing Works

### For Project Creators:
1. Create your project with measurements in OpenPaint
2. Click the **"Share Project"** button in the toolbar
3. Copy the generated shareable URL
4. Send the link to your customers

### For Customers:
1. Open the shared link in any browser
2. View the project with measurements
3. Fill out the measurement form
4. Submit their specific measurements
5. Data is collected for the project creator

## Configuration Options

### Share Link Expiration
Default: 30 days. Modify in `public/js/paint.js`:

```javascript
// Line ~14047 in shareProject function
expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
```

### Data Storage
Current implementation uses in-memory storage suitable for:
- Demo/prototype deployments
- Small to medium traffic
- Development environments

For production with high traffic, consider implementing:
- Database storage (PostgreSQL, MongoDB)
- Redis for caching
- File storage for project data

### Security Headers
Configured in `vercel.json`:
- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- X-XSS-Protection: 1; mode=block
- CORS headers for API endpoints

## API Endpoints

### Share Project
```
POST /api/share-project
Body: { projectData, shareOptions }
Returns: { shareUrl, shareId, expiresAt }
```

### Get Shared Project
```
GET /api/shared/:shareId
Returns: { projectData, shareInfo }
```

### Submit Measurements
```
POST /api/shared/:shareId/measurements
Body: { measurements, customerInfo }
Returns: { submissionId, success }
```

### View Shared Project
```
GET /shared/:shareId
Returns: HTML page for customer interaction
```

## File Structure

```
├── vercel.json                 # Vercel deployment configuration
├── app.js                      # Express server with sharing APIs
├── public/
│   ├── shared.html            # Customer measurement interface
│   ├── shared.js              # Customer interface logic
│   └── js/paint.js            # Main app with sharing functionality
├── DEPLOYMENT.md              # This file
└── package.json               # Updated with deployment scripts
```

## Monitoring & Analytics

### Vercel Analytics
Vercel provides built-in analytics for:
- Page views and performance
- Function invocations
- Error tracking

### Custom Logging
The application logs:
- Share link creation
- Customer access to shared links
- Measurement submissions
- API errors

### Health Checks
Monitor these endpoints:
- `GET /` - Main application
- `GET /api/shared/test-id` - API health (will return 404, but server responds)

## Scaling Considerations

### Current Limitations (In-Memory Storage)
- Data lost on server restart
- Limited concurrent users
- No data persistence
- Single server instance

### Recommended Upgrades for Production
1. **Database Integration**
   - PostgreSQL or MongoDB for persistent storage
   - Connection pooling
   - Data migrations

2. **File Storage**
   - AWS S3 or Vercel Blob for image storage
   - CDN for faster image delivery

3. **Caching**
   - Redis for session management
   - CDN for static assets

4. **Monitoring**
   - Error tracking (Sentry)
   - Performance monitoring
   - User analytics

## Troubleshooting

### Common Issues

**"Share link not working"**
- Check if link has expired (30-day default)
- Verify server is running and accessible
- Check browser console for JavaScript errors

**"Failed to create share link"**
- Check network connectivity
- Verify server is responding to API calls
- Check browser console for detailed error messages

**"Customer can't submit measurements"**
- Verify the shared link is still valid
- Check that at least one measurement field is filled
- Ensure JavaScript is enabled in customer's browser

### Debugging

Enable debug mode by opening browser console and checking:
- Network tab for API call failures
- Console logs for client-side errors
- Server logs (in Vercel dashboard) for backend issues

## Support

For issues specific to:
- **Vercel deployment**: Check Vercel documentation
- **OpenPaint functionality**: Refer to main README.md
- **URL sharing features**: Check browser console and server logs

## Next Steps

After successful deployment:
1. Test the sharing functionality with a sample project
2. Share a test link with colleagues for feedback
3. Monitor usage analytics in Vercel dashboard
4. Consider implementing database storage for production use
