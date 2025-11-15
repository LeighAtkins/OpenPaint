#!/bin/bash

# Deploy AI Worker Integration to Vercel
# This script handles the complete deployment process

echo "🚀 Deploying AI Worker Integration to Vercel"
echo "============================================="

# Step 1: Add and commit vercel.json
echo "📝 Adding vercel.json configuration..."
git add vercel.json
git add app.js

# Step 2: Commit changes
echo "💾 Committing changes..."
git commit -m "Add Vercel routing for AI endpoints

- Add vercel.json to route /ai/* to Express app
- Add module.exports to app.js for Vercel compatibility
- Configure AI Worker relay endpoints"

# Step 3: Deploy to Vercel
echo "🌐 Deploying to Vercel..."
vercel --prod

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Next steps:"
echo "1. Set environment variables in Vercel dashboard:"
echo "   - AI_WORKER_URL = https://openpaint-ai-worker.sofapaint-api.workers.dev"
echo "   - AI_WORKER_KEY = your-secret-key-here"
echo ""
echo "2. Test the endpoints:"
echo "   - Health: curl https://your-app.vercel.app/health"
echo "   - AI SVG: curl -X POST https://your-app.vercel.app/ai/generate-svg ..."
echo ""
echo "3. Test frontend integration:"
echo "   - Open your app in browser"
echo "   - Draw strokes and click 'AI SVG Export'"
echo "   - Verify preview modal appears"
