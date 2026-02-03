#!/bin/bash

# Quick patch script to add Supabase save endpoint to app.js
# This creates a backup and then applies the patch

echo "[Supabase Save] Creating backup..."
cp /home/node/OpenPaint/app.js /home/node/OpenPaint/app.js.backup

echo "[Supabase Save] Applying Supabase save endpoint patch..."

# Find line number 834 (before app.listen) using grep
LINE_NUM=$(grep -n "^app.listen(port," /home/node/OpenPaint/app.js | head -1)

# Insert the save endpoint code before that line
# Using sed to insert at specific line number

# Read the save endpoint code from SUPABASE_SAVE_ENDPOINT_PATCH.js
SAVE_ENDPOINT_CODE=$(cat /home/node/OpenPaint/SUPABASE_SAVE_ENDPOINT_PATCH.js)

# Check if we have a specific line to insert before
if [ -n "$LINE_NUM" ]; then
  # Insert before app.listen if line 834 is the last match before app.listen
  sed -i "${LINE_NUM}i\\^app.listen(port, '/home/node/OpenPaint/app.js" /home/node/OpenPaint/app.js
else
  # Find last app.listen line and insert before it
  LAST_LINE=$(grep -n "^app.listen(port," /home/node/OpenPaint/app.js | tail -1 | cut -d: -f1)
  sed -i "${LAST_LINE}i\\${SAVE_ENDPOINT_CODE}" /home/node/OpenPaint/app.js
fi

echo "[Supabase Save] Patch applied at line ${LAST_LINE:-5:-4}"
echo "[Supabase Save] Restarting server development..."

# Note: After patch is applied, server needs to be restarted
# The save endpoint will be active once server restarts
echo "[Supabase Save] Quick test command:"
echo "curl -X POST http://localhost:3000/api/projects/TEST/save -H 'Content-Type: application/json' -d '{\"data\": {\"name\": \"Test Project\", \"images\": {}, \"strokes\": {}, \"measurements\": {}}}'"
