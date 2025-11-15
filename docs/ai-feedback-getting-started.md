# AI Feedback Loop - Getting Started Guide

This guide will help you deploy and start using the AI feedback system that learns from your drawings.

## Prerequisites

1. **Cloudflare Account** with Workers enabled
2. **Wrangler CLI** installed: `npm install -g wrangler`
3. **Wrangler authenticated**: `wrangler login`

## Step 1: Deploy Feedback Worker

The feedback worker receives stroke data from the frontend:

```bash
# Deploy feedback worker
wrangler deploy --config wrangler.feedback.toml
```

**Note the Worker URL** from the output (e.g., `https://feedback.YOUR_ACCOUNT.workers.dev`)

## Step 2: Deploy Promotion Worker (Optional)

The promotion worker aggregates feedback daily. Deploy it if you want automatic promotion:

```bash
# Deploy promotion worker with cron trigger
wrangler deploy --config wrangler.promote.toml
```

This will run daily at 2 AM UTC to promote feedback into production strokes.

## Step 3: Update Frontend Configuration

Update the feedback worker URL in `js/ai-draw-bot.js`:

```javascript
config: {
    classifierWorkerUrl: 'https://sofa-classify.sofapaint-api.workers.dev/api/sofa-classify',
    drawBotWorkerUrl: 'https://draw-bot.sofapaint-api.workers.dev/api/draw-bot',
    feedbackWorkerUrl: 'https://feedback.YOUR_ACCOUNT.workers.dev/api/feedback', // ← Update this
    authToken: null
}
```

Or set via meta tag in `index.html`:

```html
<meta name="worker-config" content='{
    "workerBaseUrl": "https://YOUR_ACCOUNT.workers.dev",
    "workerAuthToken": null
}'>
```

## Step 4: Test the System

### 4.1 Enable Feedback Collection

1. Open OpenPaint in your browser
2. Click the **"AI Assistant"** button (top right)
3. Ensure **"AI Learning"** toggle is **ON** (enabled by default)
4. You should see "Ready to learn" status

### 4.2 Draw a Stroke

1. Upload an image or use an existing one
2. Draw a stroke manually (freehand or straight line)
3. The stroke is automatically queued for feedback
4. Check the status - it should show "1 feedback item(s) queued"

### 4.3 Accept an AI Suggestion

1. In the AI panel, select a viewpoint (e.g., "front-center")
2. Select a measurement code (e.g., "A1")
3. Click **"Get Suggestion"** to see a ghost stroke
4. Click **"Accept"** to add it
5. This also queues feedback with `source: "accepted"`

### 4.4 Sync Feedback

**Automatic**: Feedback syncs automatically when the browser is idle (after 2-5 seconds)

**Manual**: Click **"Sync Feedback Now"** button to send immediately

After syncing, you should see:
- Status: "Sent: X, Failed: 0, Queued: 0"
- Console log: `[aiDrawBot] Feedback sent successfully: A1`

## Step 5: Verify Feedback Storage

Check that feedback is being stored in KV:

```bash
# List feedback entries (will show keys)
wrangler kv key list --binding=SOFA_TAGS | grep feedback

# View a specific feedback entry
wrangler kv key get --binding=SOFA_TAGS "feedback:A1:front-center:feedback-1234567890-abc123"
```

## Step 6: Manual Promotion (Optional)

If you don't want to wait for the daily cron, trigger promotion manually:

```bash
# Call the promotion endpoint
curl -X POST https://promote-feedback.YOUR_ACCOUNT.workers.dev/api/promote-feedback
```

Or visit the URL in your browser (GET request also works).

## Step 7: Verify Promoted Strokes

After promotion, check that strokes are available:

```bash
# Check for promoted stroke
wrangler kv key get --binding=SOFA_TAGS "stroke:A1:front-center"
```

The promoted stroke should include:
- `sampleCount`: Number of feedback entries used
- `confidence`: Calculated confidence (0.5 + sampleCount/100, max 0.95)
- `promotedAt`: Timestamp of promotion

## Understanding the Flow

```
┌─────────────┐
│   You Draw  │
│   a Stroke  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Local Queue    │  ← Stored in localStorage
│  (aiFeedbackQueue)│
└──────┬──────────┘
       │
       ▼ (idle or manual sync)
┌─────────────────┐
│ Feedback Worker │  ← POST /api/feedback
│  Stores in KV   │
└──────┬──────────┘
       │
       ▼ (indexed by measurement:viewpoint)
┌─────────────────┐
│  KV Storage     │
│  feedback:*     │
└──────┬──────────┘
       │
       ▼ (daily cron or manual)
┌─────────────────┐
│ Promotion Worker│  ← Aggregates feedback
│  Creates strokes │
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│  Production KV  │
│  stroke:*       │  ← Used by draw-bot.js
└─────────────────┘
```

## Troubleshooting

### Feedback Not Queuing

1. **Check console** for errors: `[aiDrawBot] Queued feedback: ...`
2. **Verify toggle** is enabled: "AI Learning" switch should be ON
3. **Check localStorage**: Open DevTools → Application → Local Storage → Look for `aiFeedbackQueue`

### Feedback Not Sending

1. **Check worker URL** is correct in `ai-draw-bot.js`
2. **Check network tab** for failed POST requests to `/api/feedback`
3. **Verify CORS** - worker should allow `*` origin (already configured)
4. **Check worker logs**: `wrangler tail --config wrangler.feedback.toml`

### Promotion Not Working

1. **Check cron status**: `wrangler deployments list --config wrangler.promote.toml`
2. **Verify minimum samples**: Need at least 3 feedback entries per (measurement, viewpoint)
3. **Check manifest**: Promotion worker needs a manifest of index keys (currently manual)
4. **Manual trigger**: Try calling the endpoint directly to test

### No Promoted Strokes Available

1. **Check feedback count**: `wrangler kv key get --binding=SOFA_TAGS "feedback:index:A1:front-center"`
2. **Verify sample count**: Should show `count >= 3` in the index
3. **Check promotion logs**: Look for errors in worker logs

## Next Steps

1. **Draw more strokes** - The more feedback, the better the suggestions
2. **Use consistent naming** - Measurement codes like "A1", "A2" help the system learn
3. **Classify images** - Use "Auto-Classify Image" to improve viewpoint detection
4. **Monitor promotion** - Check daily to see new promoted strokes

## Privacy & Control

- **Toggle OFF**: Disables all feedback collection (no data sent)
- **Local storage**: Feedback stays on your device until you sync
- **Manual sync**: You control when data is sent
- **No images**: Only stroke coordinates and metadata are sent (no image data)

## Example Workflow

1. **Day 1**: Draw 5 strokes with measurement codes A1-A5 on a "front-center" image
   - Feedback queued: 5 items
   - Sync manually → Sent to worker
   - Check KV: `feedback:index:A1:front-center` shows `count: 1`

2. **Day 2**: Draw 2 more A1 strokes on different "front-center" images
   - Total feedback: 3 A1 strokes
   - Promotion runs → Creates `stroke:A1:front-center`
   - Future suggestions use your promoted stroke!

3. **Day 3**: Request suggestion for A1 + front-center
   - `draw-bot.js` finds your promoted stroke
   - Suggests based on your actual drawings
   - Confidence increases with more samples

## Support

- Check `docs/ai-draw-bot-setup.md` for detailed API reference
- Review worker code in `workers/feedback.js` and `workers/promote-feedback.js`
- Check browser console for detailed logging

