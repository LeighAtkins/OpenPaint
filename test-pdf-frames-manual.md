# Manual Test: PDF Export with Multiple Frames

Test URL: https://sofapaint-ny879rgf2-leigh-atkins-projects.vercel.app

## Setup

1. Open the site in your browser
2. Open browser console (F12)
3. Upload an image (any test image)

## Test Steps

### 1. Create Frame 1 with Tags

```javascript
// Select line tool
const toolManager = window.app?.toolManager;
toolManager?.setActiveTool('line');

// You can now draw a line by clicking twice on the canvas
// After drawing, run:
console.log('Frame 1 drawn');
```

After drawing, add a measurement tag (use the UI or console).

### 2. Add Frame 2

Click the **"+ Add Frame"** button (or use console):
```javascript
const viewId = window.app?.projectManager?.currentViewId || 'front';
if (typeof window.addCaptureTab === 'function') {
  window.addCaptureTab(viewId);
  console.log('Frame 2 added');
}
```

### 3. Draw on Frame 2 and Add Tags

- Draw another line
- Add a measurement tag (different label, like B1)

### 4. Check Frame/Tab State

```javascript
const pm = window.app?.projectManager;
const viewId = pm?.currentViewId;
const tabState = window.captureTabsByLabel?.[viewId];

console.log('Tab State:', {
  viewId,
  tabCount: tabState?.tabs?.length,
  activeTabId: tabState?.activeTabId,
  tabs: tabState?.tabs?.map(t => ({ id: t.id, name: t.name, type: t.type }))
});

// Check what's on canvas right now
const canvas = pm?.canvasManager?.fabricCanvas;
const objects = canvas?.getObjects() || [];
const tags = objects.filter(obj => obj.isTagText || obj.isTagBackground || obj.isTagGroup);

console.log('Canvas State:', {
  totalObjects: objects.length,
  tagCount: tags.length,
  tagLabels: tags.map(t => t.text || t.label),
  objectTypes: [...new Set(objects.map(o => o.type))]
});
```

### 5. Export PDF

1. Click "Export PDF" button (or File menu → Export PDF)
2. **Watch console carefully** for these logs:
   - `[PDF Export] View front: { ... }`
   - `[PDF Export] Total targets created: X`
   - `[PDF settleCaptureContext] Syncing visibility...`
   - `[PDF] After syncVisibility: X tag objects on canvas`

3. Generate the PDF
4. Open the PDF and check:
   - **Page 1**: Should show Frame 1 with tags visible
   - **Page 2**: Should show Frame 2 with tags visible ← **This is what's broken**

## Expected vs Actual

### Expected
- PDF has 2 pages
- Page 1 shows Frame 1 vectors + tags
- Page 2 shows Frame 2 vectors + tags

### Actual (Bug)
- PDF has 2 pages ✓
- Page 1 shows Frame 1 vectors + tags ✓
- Page 2 shows Frame 2 vectors **BUT NO TAGS** ✗

## Debug Info to Collect

From the console logs during PDF export, look for:

```
[PDF settleCaptureContext] Syncing visibility for viewId=front, tabId=XXX, scopedLabel=front::tab:XXX
[PDF] After syncVisibility: 0 tag objects on canvas  ← If 0, tags aren't being shown!
```

**Key Question:** When exporting Frame 2, are the tags marked as `visible: true` for that scopedLabel?

Share:
1. The full console output during PDF export
2. The result: Are tags visible on page 2?
3. Tab state from step 4

## Cloud Save Issue Test

After creating the project above, try:

1. Save to `.opaint` file (Download)
2. Load that `.opaint` file
3. Run:
   ```javascript
   const pm = window.app?.projectManager;
   Object.entries(pm.views).forEach(([viewId, view]) => {
     console.log(`${viewId}:`, {
       hasImage: !!view.image,
       imageLength: view.image?.length || 0,
       hasCanvasData: !!view.canvasData
     });
   });
   ```
4. Are images loaded? (`hasImage: true` and `imageLength > 0`)

If images are missing after reload, that's the cloud save bug.
