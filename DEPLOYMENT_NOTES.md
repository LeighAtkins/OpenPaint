# Deployment Notes

## Cloudflare Workers Successfully Deployed

### Workers URLs

1. **Classifier Worker**: `https://sofa-classify.sofapaint-api.workers.dev`
   - Endpoint: `/api/sofa-classify`
   - Full URL: `https://sofa-classify.sofapaint-api.workers.dev/api/sofa-classify`

2. **Draw Bot Worker**: `https://draw-bot.sofapaint-api.workers.dev`
   - Endpoint: `/api/draw-bot`
   - Full URL: `https://draw-bot.sofapaint-api.workers.dev/api/draw-bot`

### Deployment Commands Used

```bash
# Deploy classifier
npx wrangler deploy --config wrangler.toml workers/sofa-classify.js

# Deploy draw-bot
npx wrangler deploy --config wrangler.toml workers/draw-bot.js --name draw-bot
```

### Configuration Updated

- Frontend config in `public/js/ai-draw-bot.js` has been updated with the actual Worker URLs
- Workers have access to:
  - KV Namespace: `SOFA_TAGS` (ID: 4732a4548a064b9b90e2f41eda556fc6)
  - R2 Bucket: `SOFA_REFERENCE` (sofa-reference)

### Next Steps

1. **Populate initial data**:
   ```bash
   node scripts/populate-kv.js
   ```

2. **Test the endpoints**:
   ```bash
   # Test classifier
   curl -X POST https://sofa-classify.sofapaint-api.workers.dev/api/sofa-classify \
     -H "Content-Type: application/json" \
     -d '{"imageUrl":"https://example.com/image.jpg","imageLabel":"test"}'

   # Test draw-bot
   curl -X POST https://draw-bot.sofapaint-api.workers.dev/api/draw-bot \
     -H "Content-Type: application/json" \
     -d '{"measurementCode":"A1","viewpointTag":"front-center","imageLabel":"test","viewport":{"width":800,"height":600}}'
   ```

3. **Update Vercel environment variables** (if needed):
   - `WORKER_BASE_URL` = `https://sofa-classify.sofapaint-api.workers.dev`
   - Or update the meta tag in `index.html` if using that approach

### Notes

- Both workers are deployed and accessible
- CORS is enabled for all origins (can be restricted later if needed)
- Workers are ready to receive requests from the frontend

