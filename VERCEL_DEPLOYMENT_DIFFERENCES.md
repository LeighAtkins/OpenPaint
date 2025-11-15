# Vercel vs Local Deployment Differences

## Key Differences

### 1. **Runtime Environment**
- **Local**: Traditional Express server running continuously on port 3000
- **Vercel**: Serverless functions - each route becomes a separate function invocation

### 2. **Static File Serving**
- **Local**: Express serves static files via `app.use(express.static(...))`
- **Vercel**: Static files are served by Vercel's CDN (configured in `vercel.json` builds)

### 3. **File Storage**
- **Local**: Files stored in `./uploads` directory (persistent)
- **Vercel**: Files stored in `/tmp/uploads` (temporary, cleared between invocations)
  - **Note**: Uploaded files won't persist across function invocations on Vercel
  - Consider using external storage (S3, Cloudflare R2) for production

### 4. **Build Process**
- **Local**: `npm start` → runs `node app.js` directly
- **Vercel**: 
  1. Runs `npm run vercel-build` (builds CSS)
  2. Installs npm dependencies
  3. Packages Express app as serverless function
  4. Serves static files via CDN

### 5. **Environment Variables**
- **Local**: Set in `.env` file or shell environment
- **Vercel**: Set in Vercel Dashboard → Project Settings → Environment Variables
  - Required: `AI_WORKER_URL`, `AI_WORKER_KEY` (if using AI features)
  - Optional: `CF_ACCOUNT_ID`, `CF_IMAGES_API_TOKEN`, `CF_ACCOUNT_HASH` (for Cloudflare Images)

### 6. **Python Dependencies**
- **Local**: Python packages installed via `pip install -r requirements.local.txt`
- **Vercel**: Python not available (renamed `requirements.txt` to prevent installation)
  - Background removal feature won't work on Vercel unless using external service

## Configuration Files

### `vercel.json`
- Defines which files are static vs serverless functions
- Routes API calls to `app.js`
- Routes static assets to CDN
- Routes SPA routes to `index.html`

### `package.json`
- `vercel-build`: Runs CSS build (only build step needed)
- `start`: Used for local development only

## What Works the Same

✅ Express routes and middleware  
✅ API endpoints (`/api/*`, `/ai/*`)  
✅ Database connections (if configured)  
✅ Static file paths (served differently but URLs work the same)  
✅ Frontend JavaScript and CSS  

## What's Different

⚠️ File uploads: Temporary storage only on Vercel  
⚠️ Python features: Not available on Vercel  
⚠️ Long-running processes: Not supported (serverless timeout limits)  
⚠️ WebSocket connections: May need different configuration  

## Testing Locally vs Vercel

To test Vercel behavior locally:
```bash
vercel dev
```

This runs a local Vercel environment that mimics production behavior.

