#!/bin/bash
# Deployment Verification Script for OpenPaint Vercel Deployment
# Usage: ./verify-deployment.sh <your-vercel-domain>

if [ -z "$1" ]; then
    echo "Usage: $0 <vercel-domain>"
    echo "Example: $0 openpaint-xyz.vercel.app"
    exit 1
fi

DOMAIN="$1"
BASE_URL="https://${DOMAIN}"

echo "===================================="
echo "Verifying OpenPaint Deployment"
echo "Domain: $DOMAIN"
echo "===================================="
echo ""

# Test 1: Health Check
echo "📊 Test 1: Basic Health Check"
echo "GET ${BASE_URL}/health"
HEALTH=$(curl -s "${BASE_URL}/health")
echo "Response: $HEALTH"
if echo "$HEALTH" | grep -q '"ok":true'; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
fi
echo ""

# Test 2: Environment Configuration Check
echo "📊 Test 2: Environment Configuration (/api/healthz)"
echo "GET ${BASE_URL}/api/healthz"
HEALTHZ=$(curl -s "${BASE_URL}/api/healthz")
echo "Response: $HEALTHZ"
if echo "$HEALTHZ" | grep -q '"REMBG_ORIGIN":true'; then
    echo "✅ REMBG_ORIGIN is configured"
else
    echo "❌ REMBG_ORIGIN is NOT configured - please set it in Vercel"
fi
if echo "$HEALTHZ" | grep -q '"CF_API_KEY":true'; then
    echo "✅ CF_API_KEY is configured"
else
    echo "⚠️  CF_API_KEY is NOT configured (optional)"
fi
echo ""

# Test 3: Direct Upload Endpoint
echo "📊 Test 3: Direct Upload Endpoint"
echo "POST ${BASE_URL}/api/images/direct-upload"
UPLOAD_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/images/direct-upload" -H "x-api-key: dev-secret")
echo "Response (first 300 chars): ${UPLOAD_RESPONSE:0:300}"
if echo "$UPLOAD_RESPONSE" | grep -q '"uploadURL"'; then
    echo "✅ Direct upload endpoint working correctly"
    echo "   Found uploadURL in response"
elif echo "$UPLOAD_RESPONSE" | grep -q '"error":"REMBG_ORIGIN not configured"'; then
    echo "❌ REMBG_ORIGIN environment variable not set"
    echo "   Action needed: Set REMBG_ORIGIN in Vercel project settings"
elif echo "$UPLOAD_RESPONSE" | grep -q 'upstream_non_json'; then
    echo "⚠️  Worker returned non-JSON response"
    echo "   Check Cloudflare Worker logs"
else
    echo "⚠️  Unexpected response"
fi
echo ""

# Test 4: Full Headers Check
echo "📊 Test 4: Response Headers"
echo "Checking /api/images/direct-upload headers..."
curl -si -X POST "${BASE_URL}/api/images/direct-upload" -H "x-api-key: dev-secret" 2>&1 | head -n 15
echo ""

# Summary
echo "===================================="
echo "Verification Complete"
echo "===================================="
echo ""
echo "If all tests passed, your deployment is ready!"
echo ""
echo "If REMBG_ORIGIN is not configured:"
echo "1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables"
echo "2. Add: REMBG_ORIGIN = https://sofapaint-api.sofapaint-api.workers.dev"
echo "3. Select all environments (Production, Preview, Development)"
echo "4. Redeploy: vercel deploy --prod"
echo ""
