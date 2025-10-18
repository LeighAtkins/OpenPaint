# OpenPaint AI Worker

Cloudflare Worker for AI-enhanced SVG generation from canvas strokes.

## Features

- **Rule-based SVG Generation**: Converts stroke data to professional SVG markup
- **Douglas-Peucker Simplification**: Optimizes paths while preserving fidelity
- **Measurement Calculation**: Automatic length computation with unit conversion
- **Greedy Label Placement**: Avoids overlaps and keeps labels in bounds
- **SVG Sanitization**: Ensures safe output without malicious content

## Setup

### 1. Install Dependencies

```bash
cd worker
npm install
```

### 2. Configure Wrangler

Edit `wrangler.toml` to set your worker name and compatibility date.

### 3. Set API Key Secret

```bash
wrangler secret put AI_WORKER_KEY
# Enter your secret key when prompted
```

### 4. Test Locally

```bash
npm run dev
```

The worker will be available at `http://localhost:8787`.

### 5. Deploy to Cloudflare

```bash
npm run deploy
```

## API Endpoints

### POST /generate-svg

Generate SVG from stroke data.

**Request Body:**
```json
{
  "image": { "width": 800, "height": 600, "rotation": 0 },
  "units": { "name": "cm", "pxPerUnit": 37.8 },
  "strokes": [
    {
      "id": "A1",
      "type": "straight",
      "points": [{"x": 0, "y": 0}, {"x": 100, "y": 100}],
      "color": "#000000",
      "width": 2
    }
  ],
  "prompt": "",
  "styleGuide": null
}
```

**Response:**
```json
{
  "svg": "<svg>...</svg>",
  "vectors": [...],
  "summary": {
    "measurements": [...],
    "counts": { "lines": 1, "arrows": 0, "labels": 0 }
  }
}
```

### POST /assist-measurement

Calculate measurement for a single stroke.

**Request Body:**
```json
{
  "units": { "name": "cm", "pxPerUnit": 37.8 },
  "stroke": {
    "id": "A1",
    "type": "straight",
    "points": [{"x": 0, "y": 0}, {"x": 100, "y": 0}],
    "color": "#000",
    "width": 2
  }
}
```

**Response:**
```json
{
  "value": 2.65,
  "formatted": "2.65 cm",
  "labelPos": { "x": 50, "y": -10 },
  "fontSize": 14,
  "color": "#0B84F3"
}
```

### POST /enhance-placement

Optimize label and annotation placement.

**Request Body:**
```json
{
  "image": { "width": 800, "height": 600 },
  "strokes": [...]
}
```

**Response:**
```json
{
  "vectorsUpdated": [...]
}
```

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

## Authentication

All endpoints (except `/health`) require the `X-API-Key` header:

```
X-API-Key: your-secret-key
```

## Environment Variables

Set these in Cloudflare Workers dashboard or via `wrangler secret`:

- `AI_WORKER_KEY`: Secret key for API authentication

## Rate Limiting

Rate limiting is handled by the Express relay server, not the Worker itself.

## Development

### Project Structure

```
worker/
├── src/
│   ├── index.js          # Main entry point
│   ├── svg-generator.js  # SVG generation logic
│   ├── geometry.js       # Geometric utilities
│   ├── placement.js      # Label placement
│   └── sanitizer.js      # SVG sanitization
├── package.json
├── wrangler.toml
└── README.md
```

### Testing

Test endpoints locally:

```bash
curl -X POST http://localhost:8787/generate-svg \
  -H "Content-Type: application/json" \
  -H "X-API-Key: dev-key" \
  -d '{"image":{"width":800,"height":600},"strokes":[...]}'
```

## Deployment Checklist

- [ ] Set `AI_WORKER_KEY` secret
- [ ] Update `wrangler.toml` with your account details
- [ ] Test locally with `npm run dev`
- [ ] Deploy with `npm run deploy`
- [ ] Update `AI_WORKER_URL` in Express backend `.env`
- [ ] Test from frontend

## Troubleshooting

### "Unauthorized" Error

- Check that `X-API-Key` header matches the secret
- Verify secret is set: `wrangler secret list`

### Timeout Errors

- Check Worker logs: `wrangler tail`
- Increase timeout in Express relay (default: 2000ms)

### Invalid SVG Output

- Check input validation in Worker logs
- Verify stroke data format matches schema

## Future Enhancements

- [ ] LLM intent parsing (Phase 2)
- [ ] Force-directed placement (Phase 3)
- [ ] Image-aware snapping (Phase 5)
- [ ] Orthogonal leader routing
- [ ] Advanced collision avoidance

## License

MIT

