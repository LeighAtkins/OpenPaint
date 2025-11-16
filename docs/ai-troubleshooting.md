# AI Draw Bot Troubleshooting Guide

## Common Issues

### "No matching strokes found" Error

**Symptom:** When clicking "Get Suggestion" or using auto-prediction, you get a 404 error with message "No matching strokes found".

**Cause:** This is expected if no exemplar strokes exist in KV storage yet. The prediction system needs exemplar data to work.

**Solution:**
1. **Draw strokes manually** - Draw A1, A2, A3, A4 strokes manually on your images
2. **Enable AI Learning** - Make sure the "AI Learning" toggle is ON in the AI panel
3. **Sync Feedback** - Click "Sync Feedback Now" to send your strokes to the server
4. **Wait for Promotion** - The promotion worker runs daily at 2 AM UTC to convert feedback into exemplars
5. **Manual Promotion** - Or manually trigger promotion: `curl https://promote-feedback.sofapaint-api.workers.dev/api/promote-feedback`

**Verification:**
- Check browser console for `[aiDrawBot] Feedback sent successfully` messages
- Check feedback status shows "Sent: X" after syncing
- Verify feedback worker is deployed and accessible

### Feedback Not Being Stored

**Symptom:** Drawing strokes and clicking "Sync Feedback Now" but status shows "Sent: 0" or errors.

**Checklist:**
1. **AI Learning Enabled?** - Check the toggle switch in AI panel is ON
2. **Feedback Worker Deployed?** - Verify `https://feedback.sofapaint-api.workers.dev/api/feedback` is accessible
3. **Console Errors?** - Check browser console for detailed error messages
4. **Network Tab?** - Check Network tab to see if POST requests are being made and their responses

**Debug Steps:**
```javascript
// In browser console:
console.log('Queue size:', window.aiFeedbackQueue?.length);
console.log('Queue contents:', window.aiFeedbackQueue);
window.aiDrawBot.flushFeedbackQueue().then(console.log);
```

### Draw-Bot Worker 404 Error

**Symptom:** POST to `/api/draw-bot` returns 404 Not Found.

**Possible Causes:**
1. Worker not deployed
2. Wrong URL in config
3. Routing issue in worker

**Solution:**
1. Verify worker is deployed: `wrangler deployments list`
2. Check worker URL in `js/ai-draw-bot.js` matches deployment
3. Test worker directly: `curl -X POST https://draw-bot.sofapaint-api.workers.dev/api/draw-bot -H "Content-Type: application/json" -d '{"action":"suggest","measurementCode":"A1","viewpointTag":"front-center","viewport":{"width":800,"height":600}}'`

### Predictions Not Appearing

**Symptom:** Auto-classification works but no predictions appear.

**Cause:** No exemplar strokes exist for the predicted viewpoint/measurement combination.

**Solution:**
1. Draw strokes manually for the viewpoint you're testing
2. Sync feedback to store them
3. Wait for promotion or manually trigger it
4. Try prediction again

### Image Classification Not Working

**Symptom:** "Auto-Classify Image" button doesn't set viewpoint.

**Checklist:**
1. Is classifier worker deployed?
2. Check browser console for classification errors
3. Verify image is loaded (check `window.originalImages[label]`)
4. Check CORS headers if using external image URLs

**Debug:**
```javascript
// In browser console:
const label = window.currentImageLabel;
const imageUrl = window.originalImages[label];
console.log('Image URL:', imageUrl);
window.aiDrawBot.classifyImage(imageUrl, label).then(console.log).catch(console.error);
```

## Verification Commands

### Check Feedback Queue
```javascript
// In browser console
JSON.parse(localStorage.getItem('aiFeedbackQueue') || '[]')
```

### Check Feedback Worker
```bash
curl -X POST https://feedback.sofapaint-api.workers.dev/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"imageLabel":"test","measurementCode":"A1","stroke":{"points":[{"x":0.1,"y":0.2,"t":0}],"width":2}}'
```

### Check Draw-Bot Worker
```bash
curl -X POST https://draw-bot.sofapaint-api.workers.dev/api/draw-bot \
  -H "Content-Type: application/json" \
  -d '{"action":"predict","viewpointTag":"front-center","viewport":{"width":800,"height":600}}'
```

### Check KV Storage (requires wrangler)
```bash
wrangler kv key list --binding=SOFA_TAGS | grep stroke:
wrangler kv key list --binding=SOFA_TAGS | grep feedback:
```

## Expected Workflow

1. **First Time Setup:**
   - Draw strokes manually (A1, A2, A3, A4)
   - Sync feedback
   - Wait for promotion (or trigger manually)
   - Now predictions will work

2. **Subsequent Use:**
   - Upload image
   - Auto-classify (sets viewpoint)
   - Auto-predict (shows A1-A4 suggestions)
   - Accept suggestions or draw manually
   - Feedback automatically queued
   - Sync periodically

## Still Having Issues?

1. Check all workers are deployed and accessible
2. Verify KV namespace bindings are correct
3. Check R2 bucket exists if using image storage
4. Review worker logs: `wrangler tail`
5. Check browser console for detailed error messages

