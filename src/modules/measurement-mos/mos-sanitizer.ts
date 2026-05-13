// @ts-nocheck
/**
 * MOS SVG sanitiser — allowlist-based parser.
 *
 * Runs client-side only (uses browser DOMParser).
 * Strips unsafe elements/attributes, retains data-* attrs,
 * and applies ID prefix rewriting for collision avoidance.
 */

import { MOS_ALLOWED_ELEMENTS, MOS_ALLOWED_ATTRIBUTES } from './types';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitise an SVG string and prefix all IDs with `mos${overlayIndex}_`.
 *
 * Steps:
 *  1. DOMParser parse; reject on parsererror
 *  2. TreeWalker: remove elements not in allowlist
 *  3. Strip attributes not in allowlist (data-* are always kept)
 *  4. Belt-and-suspenders regex: strip on\w+= and javascript:
 *  5. Strip url() from <style> content
 *  6. XMLSerializer → clean string
 *  7. Apply ID prefix rewrite
 */
export function sanitizeAndPrefixSvg(svgText: string, overlayIndex: number): string {
  // Step 1 — Parse
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`[MOS Sanitizer] SVG parse error: ${parseError.textContent?.slice(0, 200)}`);
  }

  const svgRoot = doc.querySelector('svg');
  if (!svgRoot) {
    throw new Error('[MOS Sanitizer] No <svg> root element found');
  }

  // Step 2 — Remove disallowed elements
  const allElements = Array.from(svgRoot.querySelectorAll('*'));
  for (const el of allElements) {
    const tagName = el.tagName.toLowerCase();
    if (!MOS_ALLOWED_ELEMENTS.has(tagName)) {
      el.parentNode?.removeChild(el);
    }
  }

  // Step 3 — Strip disallowed attributes
  const remaining = Array.from(svgRoot.querySelectorAll('*'));
  remaining.push(svgRoot); // include root <svg>
  for (const el of remaining) {
    const attrs = Array.from(el.attributes);
    for (const attr of attrs) {
      const name = attr.name.toLowerCase();
      // Allow data-* attributes
      if (name.startsWith('data-')) continue;
      // Allow explicitly allowlisted attributes
      if (MOS_ALLOWED_ATTRIBUTES.has(name)) continue;
      // Remove everything else
      el.removeAttribute(attr.name);
    }
  }

  // Step 4 & 5 — Serialize and belt-and-suspenders regex
  const serializer = new XMLSerializer();
  let cleaned = serializer.serializeToString(svgRoot);

  // Strip event handlers
  cleaned = cleaned.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  // Strip javascript: URIs
  cleaned = cleaned.replace(/javascript\s*:/gi, '');

  // Strip url() from <style> blocks (potential CSS injection)
  cleaned = cleaned.replace(
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/gi,
    (_match, open, content, close) => {
      const safeContent = content.replace(/url\s*\([^)]*\)/gi, '');
      return open + safeContent + close;
    }
  );

  // Step 7 — ID prefix rewrite
  cleaned = prefixIds(cleaned, overlayIndex);

  return cleaned;
}

// ---------------------------------------------------------------------------
// ID prefix rewriting
// ---------------------------------------------------------------------------

const PREFIX_PATTERN = /\bid="([^"]+)"/g;

function prefixIds(svg: string, overlayIndex: number): string {
  const prefix = `mos${overlayIndex}_`;

  // Collect all original IDs first
  const ids = new Set<string>();
  let match: RegExpExecArray | null;
  const idRegex = /\bid="([^"]+)"/g;
  while ((match = idRegex.exec(svg)) !== null) {
    ids.add(match[1]);
  }

  if (ids.size === 0) return svg;

  // Prefix all id="" attributes
  let result = svg.replace(PREFIX_PATTERN, (_m, id) => `id="${prefix}${id}"`);

  // Update all internal references
  for (const origId of ids) {
    const escaped = escapeRegex(origId);
    // href="#id"
    result = result.replace(new RegExp(`href="#${escaped}"`, 'g'), `href="#${prefix}${origId}"`);
    // xlink:href="#id"
    result = result.replace(
      new RegExp(`xlink:href="#${escaped}"`, 'g'),
      `xlink:href="#${prefix}${origId}"`
    );
    // url(#id)
    result = result.replace(new RegExp(`url\\(#${escaped}\\)`, 'g'), `url(#${prefix}${origId})`);
  }

  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
