# Manual Split Mode Vector Test

## Setup
1. Start dev server: `npm run dev`
2. Open http://localhost:5173 in your browser
3. Open browser console (F12)

## Test Steps

### Step 1: Draw test vectors
```javascript
// Paste this in console to draw 3 test lines:
const pm = window.app?.projectManager || window.projectManager;
const canvas = pm?.canvasManager?.fabricCanvas;
const fabric = window.fabric;

for (let i = 0; i < 3; i++) {
  const line = new fabric.Line([50 + i * 100, 50, 150 + i * 100, 150], {
    stroke: '#ff0000',
    strokeWidth: 3,
    strokeType: 'line'
  });
  canvas.add(line);
}
canvas.renderAll();

console.log('✓ Drew 3 test lines');
```

### Step 2: Check before split
```javascript
const pm = window.app?.projectManager || window.projectManager;
const beforeCount = pm.canvasManager.fabricCanvas.getObjects().length;
console.log(`BEFORE SPLIT: ${beforeCount} objects`);
```

### Step 3: Enter split mode
- Press the `\` (backslash) key
- Watch console for logs starting with `[saveCurrentViewState]` and `[switchView]`

### Step 4: Check in split mode
```javascript
const pm = window.app?.projectManager || window.projectManager;
const inSplitCount = pm.canvasManager.fabricCanvas.getObjects().length;
const savedCount = pm.views?.[pm.currentViewId]?.canvasData?.objects?.length || 0;
console.log(`IN SPLIT: ${inSplitCount} objects visible`);
console.log(`SAVED: ${savedCount} objects in canvasData`);
```

### Step 5: Exit split mode
- Press `\` (backslash) again
- **Watch console carefully** for these logs:
  - `[saveCurrentViewState]` (should NOT happen - suspend flag is true)
  - `[switchView] Restoring canvas objects...`
  - `[switchView] Calling loadFromJSON with X objects`
  - `[switchView] loadFromJSON callback - objects on canvas: X`

### Step 6: Check after exit
```javascript
const pm = window.app?.projectManager || window.projectManager;
const afterCount = pm.canvasManager.fabricCanvas.getObjects().length;
const savedCount = pm.views?.[pm.currentViewId]?.canvasData?.objects?.length || 0;
console.log(`AFTER EXIT: ${afterCount} objects visible`);
console.log(`SAVED: ${savedCount} objects in canvasData`);

if (afterCount === 0 && savedCount > 0) {
  console.log('❌ BUG: Canvas is empty but saved data exists!');
} else if (afterCount > 0) {
  console.log('✓ FIXED: Objects restored successfully!');
}
```

## What to Look For

### If Bug Still Exists:
- Console shows: `[switchView] Calling loadFromJSON with X objects` (X > 0)
- Console shows: `[switchView] loadFromJSON callback - objects on canvas: 0`
- This means loadFromJSON is called but objects disappear afterward

### If Bug is Fixed:
- Console shows: `[switchView] Calling loadFromJSON with X objects`
- Console shows: `[switchView] loadFromJSON callback - objects on canvas: X` (same number)
- Vectors are visible on canvas after exit

## Share Results
Copy ALL console output between Step 5 and Step 6 and share it!
