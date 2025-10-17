# Background Toggle Update

## Changes Made

### 1. Moved Background Toggle to Stroke Visibility Controls
**Location**: `js/paint.js` lines ~5292-5302

Added a second checkbox in the stroke visibility controls for each text element:
- First checkbox: visibility toggle (show/hide text)
- Second checkbox: background toggle (transparent/white)

```javascript
// Background toggle checkbox
const bgCheckbox = document.createElement('input');
bgCheckbox.type = 'checkbox';
bgCheckbox.checked = el.hasWhiteBackground === true;
bgCheckbox.title = 'Toggle white background';
bgCheckbox.style.marginLeft = '4px';
bgCheckbox.addEventListener('change', () => {
    el.hasWhiteBackground = bgCheckbox.checked;
    try { saveState(true, false, false); } catch(_) {}
    redrawCanvasWithVisibility();
});
```

### 2. Removed Toolbar from Text Creation
**Location**: `js/paint.js` lines ~18237-18258

- Removed the toolbar that appeared above text boxes during editing
- Removed the "⬜ Background" toggle button
- Simplified text box creation to only include the contenteditable div

### 3. Changed Default Background to Transparent
**Location**: `js/paint.js` line ~18411

```javascript
hasWhiteBackground: false, // Default: transparent background
```

New text elements now start with transparent backgrounds by default.

## User Experience

**Before:**
- Background toggle was in a toolbar above the text box during editing
- Had to decide on background before saving
- Default was off

**After:**
- Background toggle is in the stroke visibility controls sidebar
- Can toggle background on/off at any time after saving
- More consistent with other element controls
- Cleaner text creation interface (no toolbar)
- Default remains off (transparent)

## UI Layout

```
Elements Sidebar:
┌─────────────────────────────────┐
│ Text Elements:                  │
│ ☑ ☐ "Hello World"          × │
│ ☑ ☑ "Another text"         × │
│                                 │
│ ─────────────────────────────  │
│                                 │
│ Strokes:                        │
│ ☑ Stroke 1                      │
└─────────────────────────────────┘

Legend:
☑ - Visibility checkbox (first)
☐ - Background checkbox (second, checked = white bg)
"Text" - Editable text content
× - Delete button
```

## Testing

1. Create new text (should have transparent background)
2. Check the second checkbox to add white background
3. Uncheck to remove background
4. Verify save/load preserves background state
5. Verify undo/redo works correctly

