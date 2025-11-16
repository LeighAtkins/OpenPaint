# AI Feedback Queue Debugging Guide

## Quick Debug Commands

### Check Queue State
```javascript
// In browser console
window.aiDrawBot.debugQueue()
```

This will show:
- In-memory queue (`window.aiFeedbackQueue`)
- LocalStorage queue
- Feedback toggle state
- Summary of queued items

### Enable Verbose Debugging
```javascript
// Enable detailed logging
window.DEBUG_AI_FEEDBACK = true

// Then draw a stroke - you'll see detailed condition checks
```

### Manual Queue Inspection
```javascript
// Check in-memory queue
window.aiFeedbackQueue

// Check localStorage
JSON.parse(localStorage.getItem('aiFeedbackQueue') || '[]')

// Check feedback toggle
document.getElementById('aiFeedbackEnabled')?.checked
```

## Common Issues & Solutions

### Issue: Queue is empty after drawing

**Check 1: Verify paint.js has feedback block**
```javascript
fetch('js/paint.js?v=20251116180000')
  .then(r => r.text())
  .then(text => console.log('Has AI FEEDBACK block:', text.includes('AI FEEDBACK')))
```

**Check 2: Enable debug mode and draw**
```javascript
window.DEBUG_AI_FEEDBACK = true
// Then draw a stroke and check console for condition warnings
```

**Check 3: Verify all conditions**
```javascript
// After drawing, check:
console.log({
  hasAiDrawBot: typeof window.aiDrawBot !== 'undefined',
  hasQueueFeedback: typeof window.aiDrawBot?.queueFeedback === 'function',
  toggleExists: !!document.getElementById('aiFeedbackEnabled'),
  toggleChecked: document.getElementById('aiFeedbackEnabled')?.checked
})
```

### Issue: Queue exists but sync shows "Sent: 0"

**Check: Network tab**
- Open DevTools → Network tab
- Click "Sync Feedback Now"
- Look for POST to `feedback.sofapaint-api.workers.dev`
- Check response status and body

**Check: Console logs**
- Should see `[aiDrawBot][DEBUG] Sending feedback request...`
- Should see `[aiDrawBot][DEBUG] Response received...`
- If errors, check the detailed error logs

### Issue: Feedback sent but KV is empty

**Verify worker is deployed:**
```bash
curl -X POST https://feedback.sofapaint-api.workers.dev/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"imageLabel":"test","measurementCode":"A1","stroke":{"points":[{"x":0.1,"y":0.2,"t":0}],"width":2}}'
```

**Check worker logs:**
```bash
wrangler tail --config wrangler.feedback.toml
```

## Debug Workflow

1. **Enable debug mode:**
   ```javascript
   window.DEBUG_AI_FEEDBACK = true
   ```

2. **Draw a stroke** and watch console for:
   - `[Paint.js][AI Feedback][DEBUG] Condition check:` - Shows all conditions
   - `[Paint.js][AI Feedback] Queueing stroke...` - Confirms block executed
   - `[aiDrawBot] queueFeedback invoked` - Confirms function called
   - `[aiDrawBot] Feedback queued. Queue length: X` - Confirms queue updated

3. **Check queue state:**
   ```javascript
   window.aiDrawBot.debugQueue()
   ```

4. **Sync feedback:**
   - Click "Sync Feedback Now" button
   - Watch Network tab for POST requests
   - Check console for `[aiDrawBot][DEBUG]` logs

5. **Verify in KV:**
   ```bash
   npx wrangler kv key list --binding=SOFA_TAGS --config wrangler.feedback.toml | grep feedback:
   ```

## Expected Console Output (Success)

```
[Paint.js][AI Feedback] Queueing stroke for AI learning: {imageLabel: "front_1", measurementCode: "A1", points: 42}
[aiDrawBot] queueFeedback invoked {imageLabel: "front_1", measurementCode: "A1", source: "manual"}
[aiDrawBot] Snapshot result {hasImage: true, capturedBase64: true, hash: "abc123..."}
[aiDrawBot] Feedback queued. Queue length: 1
[aiDrawBot] LocalStorage updated with queue size: 1
[Paint.js][AI Feedback] queueFeedback resolved. Current queue size: 1
```

Then after sync:
```
[aiDrawBot][DEBUG] Sending feedback request: {url: "...", measurementCode: "A1", ...}
[aiDrawBot][DEBUG] Response received: {status: 200, ok: true, ...}
[aiDrawBot] Feedback sent successfully: {measurementCode: "A1", feedbackId: "feedback-...", ...}
```

## Troubleshooting Checklist

- [ ] `paint.js` contains `// **AI FEEDBACK**` block
- [ ] `window.aiDrawBot` exists and has `queueFeedback` method
- [ ] Feedback toggle exists and is checked
- [ ] `drawnVectorData` exists after drawing
- [ ] Queue increments after each stroke
- [ ] LocalStorage persists queue
- [ ] Network POST succeeds (200 OK)
- [ ] Worker logs show feedback received
- [ ] KV contains `feedback:*` keys after sync

