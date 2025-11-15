# Cloudflare Workers for OpenPaint AI Drawing Bot

This directory contains Cloudflare Workers for the AI drawing bot functionality.

## Workers

### 1. `sofa-classify.js` - Viewpoint Classifier
Classifies sofa images by viewpoint (front-center, front-arm, side-arm, etc.)

**Endpoint:** `/api/sofa-classify`  
**Method:** POST  
**Request Body:**
```json
{
  "imageUrl": "https://example.com/image.jpg",
  "imageLabel": "front_1"
}
```

**Response:**
```json
{
  "tags": ["front-center", "round-arm", "high-back"],
  "confidence": 0.75,
  "viewpoint": "front-center"
}
```

### 2. `draw-bot.js` - Stroke Suggestion Service
Suggests drawing strokes based on measurement codes and viewpoints.

**Endpoint:** `/api/draw-bot`  
**Method:** POST  
**Request Body:**
```json
{
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

## Deployment

### Prerequisites
1. Install Wrangler CLI: `npm install -g wrangler`
2. Login to Cloudflare: `wrangler login`
3. Ensure KV namespaces and R2 bucket are created (see main README)

### Deploy Individual Workers

```bash
# Deploy classifier
wrangler deploy workers/sofa-classify.js

# Deploy draw-bot
wrangler deploy workers/draw-bot.js
```

### Deploy All Workers

```bash
# From project root
wrangler deploy workers/sofa-classify.js --name sofa-classify
wrangler deploy workers/draw-bot.js --name draw-bot
```

## Configuration

Update `wrangler.toml` with your namespace IDs and bucket names. The configuration should already be set up from the initial setup.

## Testing

### Test Classifier
```bash
curl -X POST https://sofa-classify.<account>.workers.dev/api/sofa-classify \
  -H "Content-Type: application/json" \
  -d '{"imageUrl":"https://example.com/sofa.jpg","imageLabel":"test"}'
```

### Test Draw Bot
```bash
curl -X POST https://sofa-classify.<account>.workers.dev/api/draw-bot \
  -H "Content-Type: application/json" \
  -d '{"measurementCode":"A1","viewpointTag":"front-center","imageLabel":"test","viewport":{"width":800,"height":600}}'
```

## Environment Variables

Set these in Vercel for the frontend:
- `WORKER_BASE_URL` - Base URL of your Workers (e.g., `https://sofa-classify.<account>.workers.dev`)
- `WORKER_AUTH_TOKEN` - Optional auth token if you add authentication to Workers

## Data Management

### Adding Exemplar Data

Use the helper script `scripts/populate-kv.js` to add reference strokes to KV:

```bash
node scripts/populate-kv.js
```

### Manual KV Operations

```bash
# List namespaces
wrangler kv namespace list

# Put a key-value pair
wrangler kv key put --binding=SOFA_TAGS "stroke:A1:front-center" '{"points":[...],"width":2}'

# Get a key-value pair
wrangler kv key get --binding=SOFA_TAGS "stroke:A1:front-center"
```

## Development

### Local Development

```bash
# Start local dev server
wrangler dev workers/sofa-classify.js

# Or for draw-bot
wrangler dev workers/draw-bot.js
```

### Adding New Features

1. Update the Worker code in `workers/`
2. Test locally with `wrangler dev`
3. Deploy with `wrangler deploy`
4. Update frontend integration if API changes

