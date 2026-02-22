// @ts-nocheck
/**
 * MOS SVG Exporter — converts Fabric overlay objects back to MOS SVG.
 *
 * Reads current Fabric object positions, converts to MOS coordinates (0–1000),
 * and serialises to a valid SVG string with the MOS v1 viewBox.
 */

import type { MeasurementOverlay, MeasurementOverlayElement, ImageRect, MosPoint } from './types';
import { mosScaleFactor } from './mos-transform';

const MOS_RANGE = 1000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Export an overlay to an MOS SVG string.
 * Reads live Fabric object positions from the canvas.
 */
export function exportMosSvg(overlay: MeasurementOverlay, imageRect: ImageRect): string {
  const scale = mosScaleFactor(imageRect);
  const lines: string[] = [];

  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MOS_RANGE} ${MOS_RANGE}">`);

  // Style block for default MOS stroke
  lines.push('  <style>');
  lines.push('    .mos-line { stroke: #DF6868; fill: none; }');
  lines.push('    .mos-label { fill: #DF6868; font-family: Arial, sans-serif; }');
  lines.push('  </style>');

  for (const element of overlay.elements.values()) {
    const svgFragment = exportElement(element, imageRect, scale);
    if (svgFragment) {
      lines.push(svgFragment);
    }
  }

  lines.push('</svg>');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Element export
// ---------------------------------------------------------------------------

function exportElement(
  element: MeasurementOverlayElement,
  _imageRect: ImageRect,
  _scale: number
): string | null {
  const id = element.opId;
  const strokeWidth = element.style?.strokeWidth || 1.5;
  const strokeColor = element.style?.strokeColor || '#DF6868';

  switch (element.kind) {
    case 'measureLine': {
      if (element.endpoints.length < 2) return null;
      const p1 = element.endpoints[0].point;
      const p2 = element.endpoints[1].point;

      // Validate coordinates are in range
      if (!isValidMosPoint(p1) || !isValidMosPoint(p2)) return null;

      // Skip zero-length lines
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      if (Math.abs(dx) < 0.1 && Math.abs(dy) < 0.1) return null;

      let fragment = `  <line id="${escapeAttr(id)}" class="mos-line"`;
      fragment += ` x1="${round(p1.x)}" y1="${round(p1.y)}"`;
      fragment += ` x2="${round(p2.x)}" y2="${round(p2.y)}"`;
      fragment += ` stroke="${escapeAttr(strokeColor)}" stroke-width="${round(strokeWidth)}"`;
      fragment += ' />';

      // Add label if present
      if (element.label) {
        fragment += '\n' + exportLabel(element.label, id, strokeColor);
      }

      return fragment;
    }

    case 'label': {
      if (!element.label) return null;
      return exportLabel(element.label, id, strokeColor);
    }

    case 'leader': {
      if (element.endpoints.length < 1) return null;
      const p = element.endpoints[0].point;
      if (!isValidMosPoint(p)) return null;

      let fragment = `  <circle id="${escapeAttr(id)}" class="mos-line"`;
      fragment += ` cx="${round(p.x)}" cy="${round(p.y)}" r="3"`;
      fragment += ` fill="${escapeAttr(strokeColor)}"`;
      fragment += ' />';
      return fragment;
    }

    case 'shapeHint': {
      if (element.endpoints.length < 1) return null;
      const p = element.endpoints[0].point;
      if (!isValidMosPoint(p)) return null;

      let fragment = `  <circle id="${escapeAttr(id)}"`;
      fragment += ` cx="${round(p.x)}" cy="${round(p.y)}" r="4"`;
      fragment += ` fill="${escapeAttr(strokeColor)}" opacity="0.5"`;
      fragment += ' />';
      return fragment;
    }

    default:
      return null;
  }
}

function exportLabel(
  label: { text: string; cx: number; cy: number; rotation: number },
  parentId: string,
  fill: string
): string {
  let fragment = `  <text id="${escapeAttr(parentId)}_label" class="mos-label"`;
  fragment += ` x="${round(label.cx)}" y="${round(label.cy)}"`;
  fragment += ` text-anchor="middle" dominant-baseline="central"`;
  fragment += ` font-size="14" fill="${escapeAttr(fill)}"`;
  if (label.rotation) {
    fragment += ` transform="rotate(${round(label.rotation)} ${round(label.cx)} ${round(label.cy)})"`;
  }
  fragment += `>${escapeXml(label.text)}</text>`;
  return fragment;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidMosPoint(p: MosPoint): boolean {
  return (
    typeof p.x === 'number' &&
    typeof p.y === 'number' &&
    !isNaN(p.x) &&
    !isNaN(p.y) &&
    p.x >= 0 &&
    p.x <= MOS_RANGE &&
    p.y >= 0 &&
    p.y <= MOS_RANGE
  );
}

function round(n: number): string {
  return (Math.round(n * 100) / 100).toString();
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
