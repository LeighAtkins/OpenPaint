# Text Debug Mode

To enable detailed debugging of text rendering, open the browser console and run:

```javascript
window.__TEXT_DEBUG = true
```

This will enable:

1. **Red guide lines** - Shows exactly where the text should start (accounting for border + padding)
2. **Detailed console logs** - Shows:
   - Canvas text state (textAlign, textBaseline, direction, transform matrix)
   - Exact coordinate calculations
   - Border and padding values
   - Font rendering details

## What to look for:

- The red dashed line should align with the left edge of your text
- Console logs will show if `textAlign` is anything other than 'left'
- Transform matrix should be identity: `{a: 1, b: 0, c: 0, d: 1, e: 0, f: 0}`
- Saved border/padding values should match what you see visually

## To disable:

```javascript
window.__TEXT_DEBUG = false
```

Then refresh the canvas or switch images.

