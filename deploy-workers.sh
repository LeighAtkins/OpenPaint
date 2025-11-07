#!/bin/bash

# Deploy Cloudflare Workers for OpenPaint
# This script deploys both the REMBG and AI SVG workers

set -e

echo "🚀 Deploying OpenPaint Cloudflare Workers"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo -e "${RED}❌ Error: wrangler CLI not found${NC}"
    echo "Install it with: npm install -g wrangler"
    exit 1
fi

# Check if logged in
if ! wrangler whoami &> /dev/null; then
    echo -e "${YELLOW}⚠️  Not logged in to Cloudflare${NC}"
    echo "Please run: wrangler login"
    exit 1
fi

echo -e "${BLUE}🔑 Checking secrets...${NC}"

# Function to check if secret exists
check_secret() {
    local worker_dir=$1
    local secret_name=$2

    cd "$worker_dir"
    if wrangler secret list 2>/dev/null | grep -q "$secret_name"; then
        echo -e "${GREEN}✅ ${secret_name} is set${NC}"
        cd - > /dev/null
        return 0
    else
        echo -e "${YELLOW}⚠️  ${secret_name} not set${NC}"
        cd - > /dev/null
        return 1
    fi
}

# Check sofapaint-api secrets
echo ""
echo "Checking sofapaint-api secrets..."
if ! check_secret "sofapaint-api" "IMAGES_API_TOKEN"; then
    echo -e "${YELLOW}Please set IMAGES_API_TOKEN:${NC}"
    echo "cd sofapaint-api && wrangler secret put IMAGES_API_TOKEN"
    echo ""
    read -p "Do you want to set it now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        cd sofapaint-api
        wrangler secret put IMAGES_API_TOKEN
        cd ..
    else
        echo -e "${RED}Skipping sofapaint-api deployment (missing secret)${NC}"
        SKIP_REMBG=true
    fi
fi

# Check AI worker secrets
echo ""
echo "Checking openpaint-ai-worker secrets..."
if ! check_secret "worker" "AI_WORKER_KEY"; then
    echo -e "${YELLOW}Please set AI_WORKER_KEY:${NC}"
    echo "You can generate one with: openssl rand -hex 32"
    echo ""
    read -p "Do you want to set it now? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Generating random key..."
        RANDOM_KEY=$(openssl rand -hex 32)
        echo "Generated key: $RANDOM_KEY"
        echo "Save this key! You'll need to set it in Vercel env vars too."
        echo "$RANDOM_KEY" | pbcopy 2>/dev/null && echo "(Key copied to clipboard)" || true
        cd worker
        echo "$RANDOM_KEY" | wrangler secret put AI_WORKER_KEY
        cd ..
    else
        echo -e "${RED}Skipping AI worker deployment (missing secret)${NC}"
        SKIP_AI=true
    fi
fi

echo ""
echo -e "${BLUE}📦 Deploying workers...${NC}"
echo ""

# Deploy sofapaint-api (REMBG)
if [ "$SKIP_REMBG" != true ]; then
    echo -e "${BLUE}Deploying sofapaint-api (REMBG & Images)...${NC}"
    cd sofapaint-api
    wrangler deploy
    REMBG_WORKER_URL=$(wrangler deployments list --name sofapaint-api 2>/dev/null | grep -o 'https://[^ ]*' | head -1)
    cd ..
    echo -e "${GREEN}✅ sofapaint-api deployed${NC}"
    echo "   URL: $REMBG_WORKER_URL"
else
    echo -e "${YELLOW}⏭️  Skipped sofapaint-api${NC}"
fi

echo ""

# Deploy openpaint-ai-worker (AI SVG)
if [ "$SKIP_AI" != true ]; then
    echo -e "${BLUE}Deploying openpaint-ai-worker (AI SVG)...${NC}"
    cd worker
    wrangler deploy
    AI_WORKER_URL=$(wrangler deployments list --name openpaint-ai-worker 2>/dev/null | grep -o 'https://[^ ]*' | head -1)
    cd ..
    echo -e "${GREEN}✅ openpaint-ai-worker deployed${NC}"
    echo "   URL: $AI_WORKER_URL"
else
    echo -e "${YELLOW}⏭️  Skipped openpaint-ai-worker${NC}"
fi

echo ""
echo -e "${GREEN}================================${NC}"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo -e "${GREEN}================================${NC}"
echo ""

# Summary
echo -e "${BLUE}📋 Vercel Environment Variables${NC}"
echo "Set these in your Vercel dashboard:"
echo ""
if [ "$SKIP_REMBG" != true ]; then
    echo "REMBG_URL=${REMBG_WORKER_URL}/remove-background"
    echo "CF_ACCOUNT_ID=665aca072a7cddbc216be6b25a6fd951"
    echo "CF_ACCOUNT_HASH=tJVRdWyUXVZJRoGHy-ATBQ"
    echo "CF_IMAGES_API_TOKEN=(your Cloudflare Images API token)"
fi
if [ "$SKIP_AI" != true ]; then
    echo "AI_WORKER_URL=${AI_WORKER_URL}"
    echo "AI_WORKER_KEY=(the secret you just set)"
fi
echo ""

# Test endpoints
echo -e "${BLUE}🧪 Testing endpoints...${NC}"
echo ""

if [ "$SKIP_REMBG" != true ]; then
    echo "Testing sofapaint-api health..."
    if curl -s "${REMBG_WORKER_URL}/health" | grep -q '"ok"'; then
        echo -e "${GREEN}✅ sofapaint-api health check passed${NC}"
    else
        echo -e "${RED}❌ sofapaint-api health check failed${NC}"
    fi
fi

if [ "$SKIP_AI" != true ]; then
    echo "Testing openpaint-ai-worker health..."
    if curl -s "${AI_WORKER_URL}/health" | grep -q '"status"'; then
        echo -e "${GREEN}✅ openpaint-ai-worker health check passed${NC}"
    else
        echo -e "${RED}❌ openpaint-ai-worker health check failed${NC}"
    fi
fi

echo ""
echo -e "${BLUE}📖 Next Steps:${NC}"
echo "1. Go to Vercel Dashboard: https://vercel.com/dashboard"
echo "2. Navigate to your project settings"
echo "3. Add the environment variables listed above"
echo "4. Redeploy your Vercel app"
echo ""
echo "For detailed instructions, see WORKER_DEPLOYMENT_GUIDE.md"
echo ""
