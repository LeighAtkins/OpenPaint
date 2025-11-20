#!/bin/bash
# Git rebase conflict resolution script
# Run this in your WSL terminal from the OpenPaint directory

set -e

echo "=== Resolving Git Rebase Conflicts ==="
echo ""

# 1. Remove backup/temporary files (rename/delete conflicts)
echo "Step 1: Removing backup files..."
git rm js/arrow_functions.js 2>/dev/null || echo "  (arrow_functions.js already handled)"
git rm js/paint.js.backup 2>/dev/null || echo "  (paint.js.backup already handled)"
git rm js/paint.js.bak 2>/dev/null || echo "  (paint.js.bak already handled)"
git rm js/paint.js.fixed 2>/dev/null || echo "  (paint.js.fixed already handled)"
git rm js/paint.js.new 2>/dev/null || echo "  (paint.js.new already handled)"
git rm js/paint_backup_corrupted.js 2>/dev/null || echo "  (paint_backup_corrupted.js already handled)"
git rm js/paint_final.js 2>/dev/null || echo "  (paint_final.js already handled)"
git rm js/paint_refactored.js 2>/dev/null || echo "  (paint_refactored.js already handled)"
git rm js/paint_temp.js 2>/dev/null || echo "  (paint_temp.js already handled)"

# 2. Accept incoming version of public/js/paint.js (modify/delete conflict)
echo ""
echo "Step 2: Accepting incoming version of public/js/paint.js..."
git add public/js/paint.js

# 3. Remove node_modules lock file (auto-generated, not needed)
echo ""
echo "Step 3: Removing node_modules/.package-lock.json..."
git rm node_modules/.package-lock.json 2>/dev/null || echo "  (already handled)"

echo ""
echo "=== Manual Resolution Required ==="
echo ""
echo "You still need to manually resolve conflicts in:"
echo "  - app.js"
echo "  - css/styles.css"
echo "  - js/project-manager.js"
echo "  - package.json"
echo ""
echo "After resolving conflicts in those files:"
echo "  1. git add app.js css/styles.css js/project-manager.js package.json"
echo "  2. npm install  # to regenerate package-lock.json"
echo "  3. git add package-lock.json"
echo "  4. git rebase --continue"
echo ""
echo "To view conflicts: git diff --name-only --diff-filter=U"

