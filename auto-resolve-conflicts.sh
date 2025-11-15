#!/bin/bash
# Automated conflict resolution for rebase
# Run this in your WSL terminal from the OpenPaint directory

set -e

echo "=== Automated Conflict Resolution ==="
echo ""

# Step 1: Accept incoming versions for app.js and css/styles.css
echo "Step 1: Resolving app.js and css/styles.css..."
git checkout --theirs app.js css/styles.css
git add app.js css/styles.css
echo "  ✓ app.js and css/styles.css resolved"

# Step 2: For js/project-manager.js, accept incoming first, then we'll patch it
echo ""
echo "Step 2: Resolving js/project-manager.js..."
git checkout --theirs js/project-manager.js

# Check if HEAD version has the legacy sync timer clearing code
if git show HEAD:js/project-manager.js 2>/dev/null | grep -q "legacySyncTimer"; then
    echo "  → Found legacy sync timer code in HEAD, will merge..."
    # We'll need to manually add it back - see instructions below
    NEEDS_MANUAL_MERGE=true
else
    NEEDS_MANUAL_MERGE=false
fi

git add js/project-manager.js
echo "  ✓ js/project-manager.js base resolved (may need manual merge)"

# Step 3: Resolve package.json
echo ""
echo "Step 3: Resolving package.json..."
git checkout --theirs package.json
git add package.json
echo "  ✓ package.json resolved"

# Step 4: Regenerate package-lock.json
echo ""
echo "Step 4: Regenerating package-lock.json..."
npm install
git add package-lock.json
echo "  ✓ package-lock.json regenerated"

echo ""
echo "=== Resolution Summary ==="
echo ""
echo "Files resolved:"
echo "  ✓ app.js"
echo "  ✓ css/styles.css"
echo "  ✓ js/project-manager.js (base resolved)"
echo "  ✓ package.json"
echo "  ✓ package-lock.json"
echo ""

if [ "$NEEDS_MANUAL_MERGE" = true ]; then
    echo "⚠ Manual review needed for js/project-manager.js:"
    echo "   Check if legacy sync timer clearing code needs to be added back"
    echo "   around line 663-670"
    echo ""
fi

echo "Next steps:"
echo "  1. Review js/project-manager.js for any missing code from HEAD"
echo "  2. If satisfied: git rebase --continue"
echo "  3. If not: Edit js/project-manager.js, then git add it and git rebase --continue"

