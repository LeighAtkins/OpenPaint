#!/usr/bin/env bash
set -euo pipefail

echo "📦 Building Vercel Output Directory bundle..."

# 0) Clean previous output
rm -rf .vercel/output
mkdir -p .vercel/output/{functions,static}

# 1) Build CSS assets
echo "🎨 Building Tailwind CSS..."
npx --yes @tailwindcss/cli -i "./css/tailwind.css" -o "./css/tailwind.build.css" --minify || true

# 2) Copy static assets
echo "📁 Copying static assets..."

# Use cp instead of rsync for portability (rsync not available in Vercel)
if [ -d public ]; then
  mkdir -p .vercel/output/static
  cp -R public/. .vercel/output/static/ 2>/dev/null || true
fi

# Copy root-level static files
cp -f index.html .vercel/output/static/ 2>/dev/null || true
cp -f shared.html .vercel/output/static/ 2>/dev/null || true

# Copy CSS, JS, and other directories
if [ -d css ]; then
  mkdir -p .vercel/output/static/css
  cp -R css/. .vercel/output/static/css/ 2>/dev/null || true
fi

if [ -d js ]; then
  mkdir -p .vercel/output/static/js
  cp -R js/. .vercel/output/static/js/ 2>/dev/null || true
fi

if [ -d src ]; then
  mkdir -p .vercel/output/static/src
  cp -R src/. .vercel/output/static/src/ 2>/dev/null || true
fi

# 3) Build API serverless function
echo "⚡ Creating API serverless function..."
FUNC_DIR=".vercel/output/functions/api__app.func"
mkdir -p "$FUNC_DIR"
mkdir -p ".vercel/output/config"

# 3a) Copy the API app file directly into the function directory
cp api/app.js "$FUNC_DIR/app.js"

# 3b) Create function entry point wrapper
cat > "$FUNC_DIR/index.js" <<'EOF'
// Vercel serverless function entry point (ESM)
import app from './app.js';

export default app;
EOF

# 3b) Function configuration - MUST be .vc-config.json for Output API v3
cat > "$FUNC_DIR/.vc-config.json" <<'EOF'
{
  "runtime": "nodejs20.x",
  "handler": "index.js",
  "launcherType": "Nodejs"
}
EOF

echo "✅ Created function at $FUNC_DIR"
echo "   - Runtime: nodejs20.x"
echo "   - Handler: index.js"
echo "   - Config: .vc-config.json"

# 4) Create routes in config/routes.json (Output API v3 format)
echo "🔀 Creating routes manifest..."
cat > ".vercel/output/config/routes.json" <<'EOF'
[
  {
    "src": "^/api/(.*)$",
    "dest": "api__app.func"
  },
  {
    "src": "^/health$",
    "dest": "api__app.func"
  },
  {
    "src": "^/version$",
    "dest": "api__app.func"
  },
  {
    "handle": "filesystem"
  },
  {
    "src": "/(.*)",
    "dest": "/static/$1"
  }
]
EOF

# 5) Create config.json for the output
cat > ".vercel/output/config.json" <<'EOF'
{
  "version": 3
}
EOF

# 6) Verify the structure
echo ""
echo "✅ Build complete! Output structure:"
echo ""
tree -L 3 .vercel/output 2>/dev/null || find .vercel/output -type f | head -20
echo ""
echo "🔍 Verifying nodejs20.x runtime..."
grep -r "nodejs20.x" .vercel/output/functions || echo "⚠️  Warning: nodejs20.x not found!"
echo ""
echo "🚀 Ready for deployment!"
