import { describe, expect, test } from 'vitest';
import {
  createHighlighterCursor,
  normalizeHighlighterStyle,
  resolveHighlighterWidth,
  toHighlighterColor,
} from '../../src/modules/tools/HighlighterTool.js';

describe('highlighter drawing tool', () => {
  test('turns the selected solid colour into a translucent highlight', () => {
    expect(toHighlighterColor('#ff0000')).toBe('rgba(255, 0, 0, 0.32)');
    expect(toHighlighterColor('#0f8')).toBe('rgba(0, 255, 136, 0.32)');
  });

  test('keeps a broad visible stroke while still following line-width changes', () => {
    expect(resolveHighlighterWidth(0.25)).toBe(10);
    expect(resolveHighlighterWidth(2)).toBe(12);
    expect(resolveHighlighterWidth(8)).toBe(48);
    expect(resolveHighlighterWidth(100)).toBe(120);
  });

  test('uses a marker-shaped cursor with its hotspot on the nib', () => {
    const cursor = createHighlighterCursor('#22c55e');
    expect(cursor).toMatch(/^url\("data:image\/svg\+xml;utf8,/);
    expect(cursor).toContain('8 30, crosshair');
    expect(decodeURIComponent(cursor)).toContain('#22c55e');
    expect(decodeURIComponent(cursor)).toContain('cx="8" cy="30"');
  });

  test('normalizes the supported marker and zipper styles', () => {
    expect(normalizeHighlighterStyle('marker')).toBe('marker');
    expect(normalizeHighlighterStyle('ZIPPER')).toBe('zipper');
    expect(normalizeHighlighterStyle('unknown')).toBe('marker');
  });

  test('uses a distinct zipper cursor with the hotspot on the drawing point', () => {
    const cursor = createHighlighterCursor('#facc15', 'zipper');
    expect(cursor).toContain('15 30, crosshair');
    expect(decodeURIComponent(cursor)).toContain('M8 4v25M22 4v25');
    expect(decodeURIComponent(cursor)).toContain('cx="15" cy="30"');
  });
});
