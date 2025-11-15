#!/bin/bash
# Step-by-step conflict resolution script
# Run this in your WSL terminal

set -e

echo "=== Resolving Git Rebase Conflicts ==="
echo ""

# Step 1: Accept incoming version of app.js (has AI Worker/Cloudflare config)
echo "Step 1: Resolving app.js (accepting incoming version with AI Worker config)..."
git checkout --theirs app.js
git add app.js
echo "  ✓ app.js resolved"

# Step 2: Accept incoming version of css/styles.css
echo ""
echo "Step 2: Resolving css/styles.css (accepting incoming version)..."
git checkout --theirs css/styles.css
git add css/styles.css
echo "  ✓ css/styles.css resolved"

# Step 3: For js/project-manager.js, we need to merge intelligently
echo ""
echo "Step 3: Resolving js/project-manager.js (merging both versions)..."
# First, get the incoming version
git checkout --theirs js/project-manager.js

# Now we need to manually fix the three conflict areas
# The script will show you what needs to be done
echo "  ⚠ js/project-manager.js needs manual merge - see instructions below"
echo "  (The file has been set to incoming version, but you may need to add HEAD's legacy sync timer clearing)"

# Step 4: For package.json, accept incoming and we'll merge dependencies manually
echo ""
echo "Step 4: Resolving package.json (accepting incoming, will merge dependencies)..."
git checkout --theirs package.json
git add package.json
echo "  ✓ package.json resolved (you may want to verify dependencies)"

# Step 5: Regenerate package-lock.json
echo ""
echo "Step 5: Regenerating package-lock.json..."
npm install
git add package-lock.json
echo "  ✓ package-lock.json regenerated"

echo ""
echo "=== Manual Steps Required ==="
echo ""
echo "1. Review js/project-manager.js around lines 663-673:"
echo "   - Ensure both legacy sync timer clearing AND imageRotationByLabel initialization are present"
echo ""
echo "2. Review js/project-manager.js around line 751-755:"
echo "   - Ensure proper indentation for imageRotationByLabel assignment"
echo ""
echo "3. Review js/project-manager.js around line 1020-1050:"
echo "   - Ensure legacy sync and migration code is present"
echo ""
echo "4. Verify package.json has all needed dependencies"
echo ""
echo "After manual review, run:"
echo "  git add js/project-manager.js"
echo "  git rebase --continue"

