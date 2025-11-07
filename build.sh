#!/bin/bash
set -e

echo "Building OpenPaint for Vercel..."

# Build Tailwind CSS
npm run build:css

# Create Vercel output structure
mkdir -p .vercel/output/static
mkdir -p .vercel/output/functions/api.func

# Copy static files to output root
echo "Copying static files..."
cp index.html .vercel/output/static/
cp -r css .vercel/output/static/
cp -r js .vercel/output/static/
cp -r src .vercel/output/static/
cp *.html .vercel/output/static/ 2>/dev/null || true

# Copy public/ contents to static root (flatten structure)
echo "Copying public files to root..."
cp -r public/* .vercel/output/static/ 2>/dev/null || true

# Copy API function with correct name
echo "Copying API function..."
cp api/app.js .vercel/output/functions/api.func/index.js

# Create function config
echo "Creating function config..."
cat > .vercel/output/functions/api.func/.vc-config.json <<'EOF'
{
  "runtime": "nodejs20.x",
  "handler": "index.js",
  "environment": {},
  "maxDuration": 10
}
EOF

# Create config with proper routing
echo "Creating deployment config..."
cat > .vercel/output/config.json <<'EOF'
{
  "version": 3,
  "routes": [
    {
      "src": "^/(api|ai)/(.*)$",
      "dest": "/api?path=$2"
    },
    {
      "src": "^/(health|env-check|version)$",
      "dest": "/api?path=$1"
    },
    {
      "handle": "filesystem"
    }
  ]
}
EOF

echo "Build complete!"
