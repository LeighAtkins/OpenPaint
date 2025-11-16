# AI Drawing Bot Setup Guide

This guide explains how to set up and use the AI Drawing Bot feature in OpenPaint.

## Overview

The AI Drawing Bot consists of:
1. **Cloudflare Workers** - Backend services for classification and stroke suggestions
2. **Frontend Integration** - UI controls and drawing integration
3. **Data Storage** - KV namespaces and R2 buckets for exemplar data

## Architecture

```
┌─────────────┐
│   Browser   │
│  (OpenPaint)│
└──────┬──────┘
       │ HTTP POST
       ▼
┌─────────────────────────────────┐
│   Cloudflare Workers             │
│  ┌───────────────────────────┐  │
│  │  sofa-classify.js         │  │
│  │  /api/sofa-classify       │  │
│  └───────────────────────────┘  │
│  ┌───────────────────────────┐  │
│  │  draw-bot.js              │  │
│  │  /api/draw-bot            │  │
│  └───────────────────────────┘  │
└──────┬───────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   Cloudflare Storage            │
│  ┌──────────┐  ┌─────────────┐ │
│  │ KV Store │  │ R2 Bucket  │ │
│  │ (Metadata│  │ (Images)   │ │
│  │  & Strokes)│              │ │
│  └──────────┘  └─────────────┘ │
└─────────────────────────────────┘
```

## Setup Steps

### 1. Deploy Cloudflare Workers

```bash
# Deploy classifier worker
wrangler deploy workers/sofa-classify.js

# Deploy draw-bot worker
wrangler deploy workers/draw-bot.js
```

Note the Worker URLs from the deployment output. You'll need these for the frontend configuration.

### 2. Configure Frontend

Update the Worker URLs in `public/js/ai-draw-bot.js`:

```javascript
config: {
    classifierWorkerUrl: 'https://sofa-classify.YOUR_ACCOUNT.workers.dev/api/sofa-classify',
    drawBotWorkerUrl: 'https://sofa-classify.YOUR_ACCOUNT.workers.dev/api/draw-bot',
    authToken: null // Optional: add if you implement auth
}
```

Or set via meta tag in `index.html`:

```html
<meta name="worker-config" content='{"workerBaseUrl":"https://sofa-classify.YOUR_ACCOUNT.workers.dev","workerAuthToken":null}'>
```

### 3. Populate Initial Data

Run the helper script to add exemplar strokes:

```bash
node scripts/populate-kv.js
```

Or manually add strokes using Wrangler:

```bash
wrangler kv key put --binding=SOFA_TAGS "stroke:A1:front-center" '{"points":[...],"width":2}'
```

### 4. Test the Integration

1. Open OpenPaint in your browser
2. Click the "AI Assistant" button (top right)
3. Upload an image
4. Click "Auto-Classify Image" to classify the viewpoint
5. Select a measurement code (e.g., "A1")
6. Click "Get Suggestion" to see a ghost stroke
7. Click "Accept" to add it as a real stroke

## Usage Workflow

### Classifying Images

1. **Manual Classification**: Select viewpoint from dropdown
2. **Auto Classification**: Click "Auto-Classify Image" button
   - Captures image snapshot (JPEG compressed) for better classification
   - Generates SHA-256 hash for deduplication
   - Sends image data to classifier Worker
   - Updates viewpoint dropdown automatically
   - Stores result in `window.imageTags[label]`
   - Auto-triggers measurement prediction after classification
3. **Automatic Classification**: When switching images, if no tags exist, auto-classification runs automatically

### Getting Stroke Suggestions

**Method 1: Manual Selection**
1. Ensure both viewpoint and measurement code are selected
2. Click "Get Suggestion"
3. Ghost stroke appears on canvas (semi-transparent blue, dashed)
4. Review the suggestion
5. Either:
   - **Accept**: Converts ghost stroke to real stroke
   - **Dismiss**: Removes ghost stroke

**Method 2: Automatic Prediction (NEW)**
1. After auto-classification, measurements are automatically predicted
2. Top prediction (highest confidence) is automatically selected and rendered
3. Measurement dropdown is auto-populated with predicted codes
4. Ghost stroke appears automatically for the top prediction
5. Accept or dismiss as needed

### Adding Your Own Exemplars

To improve suggestions, add your own stroke exemplars:

1. Draw a stroke manually in OpenPaint
2. Export the stroke data (points, width, etc.)
3. Normalize coordinates to 0-1 range
4. Add to KV using the populate script or Wrangler CLI

Example stroke format:
```json
{
  "id": "custom-stroke-1",
  "measurementCode": "A1",
  "viewpoint": "front-center",
  "points": [
    { "x": 0.1, "y": 0.2, "t": 0 },
    { "x": 0.9, "y": 0.2, "t": 400 }
  ],
  "width": 0.002,
  "confidence": 0.9
}
```

## API Reference

### Classifier API

**Endpoint:** `POST /api/sofa-classify`

**Request:**
```json
{
  "imageUrl": "https://example.com/image.jpg",
  "imageBase64": "base64-encoded-jpeg-data",
  "imageHash": "sha256-hash-of-image",
  "imageLabel": "front_1"
}
```

**Response:**
```json
{
  "tags": ["front-center", "round-arm"],
  "confidence": 0.75,
  "viewpoint": "front-center"
}
```

**Notes:**
- `imageBase64`: Compressed JPEG (quality 0.7) for better classification
- `imageHash`: SHA-256 hash for caching and deduplication
- Results are cached by hash for 30 days

### Draw Bot API

**Endpoint:** `POST /api/draw-bot`

**Action: `suggest` (Get single stroke suggestion)**
```json
{
  "action": "suggest",
  "measurementCode": "A1",
  "viewpointTag": "front-center",
  "imageLabel": "front_1",
  "viewport": { "width": 800, "height": 600 }
}
```

**Response:**
```json
{
  "strokeId": "suggested-1234567890",
  "measurementCode": "A1",
  "viewpoint": "front-center",
  "confidence": 0.8,
  "points": [
    { "x": 100, "y": 200, "t": 0 },
    { "x": 300, "y": 200, "t": 100 }
  ],
  "width": 2
}
```

**Action: `predict` (Predict multiple measurements)**
```json
{
  "action": "predict",
  "viewpointTag": "front-center",
  "imageLabel": "front_1",
  "imageHash": "sha256-hash",
  "imageBase64": "base64-data",
  "viewport": { "width": 800, "height": 600 }
}
```

**Response:**
```json
{
  "predictions": [
    {
      "code": "A1",
      "stroke": {
        "points": [{ "x": 100, "y": 200, "t": 0 }],
        "width": 2
      },
      "confidence": 0.9
    },
    {
      "code": "A2",
      "stroke": { ... },
      "confidence": 0.85
    }
  ]
}
```

## Troubleshooting

### Workers Not Responding

1. Check Worker URLs are correct in `ai-draw-bot.js`
2. Verify Workers are deployed: `wrangler deployments list`
3. Check Worker logs: `wrangler tail`

### No Suggestions Found

1. Ensure exemplar data exists in KV: `wrangler kv key list --binding=SOFA_TAGS`
2. Check measurement code and viewpoint match existing exemplars
3. Verify key format: `stroke:<measurementCode>:<viewpointTag>`

### Classification Not Working

1. Check image URL is accessible
2. Verify classifier Worker is deployed and running
3. Check browser console for errors

## Feedback System

The AI Draw Bot includes a feedback loop that automatically learns from your drawings:

### How It Works

1. **Automatic Capture**: When you draw strokes manually or accept AI suggestions, they're automatically queued for feedback
2. **Local Queue**: Feedback is stored locally in `localStorage` and sent in batches
3. **Background Sync**: Feedback is automatically sent when idle, or manually via "Sync Feedback Now" button
4. **Promotion**: A daily cron job aggregates feedback and promotes it into production stroke suggestions

### Feedback Data Schema

```json
{
  "projectId": "project-name",
  "imageLabel": "front_1",
  "viewpoint": "front-center",
  "measurementCode": "A1",
  "stroke": {
    "points": [
      { "x": 0.125, "y": 0.333, "t": 0 },
      { "x": 0.375, "y": 0.333, "t": 100 }
    ],
    "width": 0.002,
    "source": "manual|accepted|modified"
  },
  "labels": [],
  "imageHash": "sha256-hash-of-image",
  "imageBase64": "compressed-jpeg-base64",
  "meta": {
    "canvas": { "width": 800, "height": 600 },
    "confidence": 0.8,
    "originalDimensions": { "width": 1920, "height": 1080 }
  }
}
```

**Notes:**
- Stroke points are normalized to 0-1 range for consistent storage
- Image data is included for visual context in training
- Images are stored in R2 bucket with key format: `images/<hash>.jpg`
- Image hash enables deduplication and visual validation during promotion

### Deploying Feedback Workers

```bash
# Deploy feedback worker
wrangler deploy --config wrangler.feedback.toml

# Deploy promotion worker (with cron trigger)
wrangler deploy --config wrangler.promote.toml
```

### Privacy Controls

- Toggle "AI Learning" switch in the AI panel to enable/disable feedback collection
- Feedback queue is stored locally and only sent when you click "Sync Feedback Now" or when idle
- Image data is compressed (JPEG quality 0.7) and only sent if feedback is enabled
- Images are stored in R2 for training purposes but can be deleted if needed

### Promotion Process

The promotion worker runs daily at 2 AM UTC and:
1. Reads feedback entries from KV storage
2. Prioritizes entries with image data for better quality
3. Aggregates strokes by (measurementCode, viewpoint) combination
4. Requires minimum 3 samples before promoting
5. Creates production stroke keys used by `draw-bot.js`
6. Updates confidence scores based on sample count
7. Uses image hash/storage keys for visual validation (future enhancement)

## Next Steps

1. **Enhance Classifier**: Add Cloudflare AI Vision for better classification
2. **Expand Dataset**: Add more exemplar strokes for different combinations
3. **Improve Matching**: Add similarity scoring for better stroke selection
4. **Add Authentication**: Secure Workers with API keys if needed
5. **Analytics Dashboard**: View feedback statistics and promotion results

## Files Created

- `workers/sofa-classify.js` - Viewpoint classifier Worker
- `workers/draw-bot.js` - Stroke suggestion Worker
- `workers/feedback.js` - Feedback collection Worker
- `workers/promote-feedback.js` - Feedback promotion Worker (cron)
- `workers/README.md` - Worker documentation
- `js/ai-draw-bot.js` - Frontend API client with feedback queueing
- `js/ai-draw-bot-integration.js` - UI integration with sync controls
- `data/measurement-strokes.json` - Dataset schema
- `scripts/populate-kv.js` - Data population script
- `wrangler.toml` - Main Worker configuration
- `wrangler.feedback.toml` - Feedback worker configuration
- `wrangler.promote.toml` - Promotion worker configuration

