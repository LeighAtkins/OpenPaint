# OpenPaint

A web-based drawing and annotation tool for creating measurement documents, annotated images, and professional PDF exports.

## What It Does

- **Draw and annotate** on images: freehand, straight lines, curves, arrows, shapes, text
- **Measure and label** with drag-to-reposition labels and normalized positioning
- **Manage multiple images** with folder organization and tagging
- **Export**: PNG/JPEG image, ZIP project bundle, or PDF measurement report
- **Share**: Generate shareable links for customer review and measurement submission
- **AI-powered**: Automatic furniture dimensioning, silhouette detection, smart label placement

## Quick Start

```bash
npm install
npm start         # Express server on http://localhost:3000
# or
npm run dev       # Vite dev server with HMR
```

## Architecture

```
src/                    ← Canonical source (TypeScript + legacy JS being migrated)
  main.ts               ← Single runtime entrypoint
  modules/              ← Core managers (CanvasManager, ProjectManager, etc.)
  features/             ← Feature modules (canvas, drawing, gallery, transform)
  types/                ← TypeScript type definitions
  services/             ← Business logic services
  config/               ← Configuration (Supabase, etc.)

public/                 ← Static assets only (images, icons, fonts — no app logic)

app.js                  ← Express server (local dev + Vercel serverless)
api/                    ← Vercel serverless function entry points
worker/                 ← Cloudflare Worker for AI features
supabase/               ← Database schema and migrations

tests/                  ← Unit, integration, and visual regression tests
```

### Build Pipeline

Vite bundles from `src/main.ts`. All application code lives in `src/`. Legacy JavaScript modules are imported through the build and are gradually being converted to TypeScript.

### Save Modes

| Mode | Auth | Persistence | Output |
|---|---|---|---|
| **Guest Quick Use** | None | None | PNG/JPEG image download |
| **Customer Export** | None | Optional | PDF report + ZIP bundle |
| **Power User** | Supabase (planned) | Cloud | Project library with sharing controls |

Auth is behind the `ENABLE_AUTH` feature flag and is not yet implemented.

### Tech Stack

- **Frontend**: Vanilla JS/TS, Fabric.js (canvas), JSZip, FileSaver.js
- **Backend**: Node.js, Express
- **Database**: Supabase/PostgreSQL (optional)
- **Build**: Vite, TypeScript
- **Deployment**: Vercel
- **AI**: Cloudflare Workers
- **Testing**: Vitest, Playwright (visual regression)

## Development

```bash
npm run lint          # Lint src/
npm run lint:fix      # Auto-fix lint issues
npm test              # Run tests (Vitest)
npm run type-check    # TypeScript checking
npm run validate      # type-check + lint + test
npm run build         # Production build
```

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment instructions and environment variable setup.

## Environment Variables

Copy `.env.example` to `.env.development` and fill in your values. See [DEPLOYMENT.md](DEPLOYMENT.md) for the complete list.

**Required for AI features**: `AI_WORKER_URL`, `AI_WORKER_KEY`
**Required for cloud storage**: Supabase and Cloudflare credentials (see `.env.example`)

## License

ISC
