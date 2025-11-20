#!/bin/bash
# Script to show conflict sections in files

echo "=== Showing conflicts in app.js ==="
grep -n "^<<<<<<< " app.js -A 20 | head -40
echo ""
echo "=== Showing conflicts in css/styles.css ==="
grep -n "^<<<<<<< " css/styles.css -A 20 | head -40
echo ""
echo "=== Showing conflicts in js/project-manager.js ==="
grep -n "^<<<<<<< " js/project-manager.js -A 20 | head -60
echo ""
echo "=== Showing conflicts in package.json ==="
grep -n "^<<<<<<< " package.json -A 20 | head -40

