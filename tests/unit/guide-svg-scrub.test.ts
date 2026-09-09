import { describe, expect, test } from 'vitest';
import {
  stripNonMeasurementElements,
  stripSvgLabels,
  getGuideProductType,
} from '../../src/modules/ui/measurement-guide-flash.js';

// Fixture mirrors the flat Illustrator structure served for guides like
// CS1X-RA-RB: one Layer group, saturated measurement lines, white label-plate
// rects + thin colored box rects, grey furniture-outline paths, and closed
// arrowhead polylines at line ends.
const FLAT_GUIDE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260">
  <style>
    .st0{fill:none;stroke:#A7A8AB;stroke-width:2.741;stroke-linecap:round;}
    .st1{fill:none;stroke:#010101;stroke-width:2.741;}
    .st2{fill:none;stroke:#E82429;stroke-width:1.37;}
    .st4{fill:#FFFFFF;}
    .st5{fill:none;stroke:#E82429;stroke-width:0.685;}
    .st8{fill:#010101;}
  </style>
  <g id="Layer_1">
    <polyline class="st0" points="86.6,217.4 88.5,235.2 105.7,235.2 107.6,217.4 "/>
    <path class="st0" d="M257,178.1v-41.7C257,100,280.4,97,286.6,97"/>
    <line class="st1" x1="135.2" y1="162.2" x2="236.4" y2="162.2"/>
    <line class="st2" x1="258.5" y1="81.6" x2="112.9" y2="81.6"/>
    <rect class="st4" x="142.7" y="99" width="29.1" height="18.9"/>
    <rect class="st5" x="142.7" y="99" width="29.1" height="18.9"/>
    <line class="st5" x1="157.2" y1="81.7" x2="157.2" y2="99"/>
    <text transform="matrix(1 0 0 1 149.7881 113.1491)" class="st8">A1</text>
  </g>
</svg>`;

// Group-structured guide (m/b/c prefixes) as produced by the cloud exporter:
// measurement/label groups are direct children of <svg>.
const GROUPED_GUIDE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260">
  <g id="mA1cm">
    <line x1="10" y1="10" x2="60" y2="10"/>
  </g>
  <g id="cA1cm_label">
    <rect x="70" y="4" width="20" height="12"/>
    <text x="72" y="14">A1</text>
  </g>
  <line x1="200" y1="10" x2="260" y2="10"/>
</svg>`;

describe('guide SVG scrub for MOS overlay import', () => {
  test('flat Illustrator guide keeps measurement lines and labels, drops boxes and arrowheads', () => {
    const cleaned = stripNonMeasurementElements(FLAT_GUIDE_SVG);
    const doc = new DOMParser().parseFromString(cleaned, 'image/svg+xml');

    // Squares (label-box rects) are scrubbed entirely.
    expect(doc.querySelectorAll('rect')).toHaveLength(0);
    // The closed arrowhead polyline is scrubbed.
    expect(doc.querySelectorAll('polyline')).toHaveLength(0);
    // The real measurement lines and the furniture path survive.
    expect(doc.querySelectorAll('line').length).toBeGreaterThanOrEqual(2);
    expect(doc.querySelector('path')).not.toBeNull();
    // The text label survives so it can become a tag.
    expect(doc.querySelector('text')?.textContent).toBe('A1');
    // The whole layer must not be removed (the old bug wiped it wholesale).
    expect(doc.querySelector('line')?.getAttribute('x1')).toBe('135.2');
  });

  test('group-structured guides keep labels in their original coordinate system', () => {
    const cleaned = stripNonMeasurementElements(GROUPED_GUIDE_SVG);
    const doc = new DOMParser().parseFromString(cleaned, 'image/svg+xml');

    expect(doc.querySelectorAll('rect')).toHaveLength(0);
    // Companion text remains under its original group and transform.
    const measurementGroup = doc.querySelector('g[id="mA1cm"]');
    expect(measurementGroup).not.toBeNull();
    expect(doc.querySelector('g[id="cA1cm_label"] text')?.textContent).toBe('A1');
    expect(doc.querySelector('g[id="cA1cm_label"]')).not.toBeNull();
  });
});

describe('guide raster strip (stripSvgLabels) for BOL-style mixed guides', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    (window as any).currentImageLabel = 'front';
    (window as any).projectMetadata = {};
    (window as any).app = {
      projectManager: {
        currentViewId: 'front',
        getProjectMetadata: () => (window as any).projectMetadata,
        setProjectMetadata: vi.fn(),
      },
    };
  });

  test('m-only groups, c-groups, label plates, and arrowheads are stripped from the raster', () => {
    // Mirrors the real BOL export: paired m+c groups, an m-ONLY group (no
    // b/c companion), polygon arrowheads, and nested label-plate rect
    // wrapper groups — all baked into the added image when not stripped.
    const bolLikeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 260">
      <style>.st0{fill:none;stroke:#A7A8AB;stroke-width:2.7;}.rd{fill:none;stroke:#E82429;stroke-width:1.37;}</style>
      <g id="mD1cm"><path class="rd" d="M10,20 L60,20"/></g>
      <g id="cD1cm"><path class="rd" d="M60,20 L80,30"/></g>
      <g id="mL1cm">
        <line class="rd" x1="10" y1="40" x2="60" y2="40"/>
        <g><polygon class="rd" points="60,40 70,36 70,44"/></g>
      </g>
      <g id="mBcm_00000123402086481225943600000011255513527930927530_">
        <line class="rd" x1="10" y1="60" x2="50" y2="60"/>
        <g><polygon class="rd" points="50,60 60,56 60,64"/></g>
      </g>
      <g><g><rect x="100" y="90" width="29.1" height="18.9"/></g></g>
      <text x="104" y="104">B1</text>
      <path class="st0" d="M10,200 C40,180 80,220 120,200"/>
    </svg>`;

    const cleaned = stripSvgLabels(bolLikeSvg);
    const doc = new DOMParser().parseFromString(cleaned, 'image/svg+xml');

    // Every m/b/c measurement group is gone — including m-ONLY tokens.
    expect(doc.querySelector('g[id="mD1cm"]')).toBeNull();
    expect(doc.querySelector('g[id="cD1cm"]')).toBeNull();
    expect(doc.querySelector('g[id="mL1cm"]')).toBeNull();
    expect(doc.querySelector('g[id^="mBcm_"]')).toBeNull();
    // Label-plate rects are gone.
    expect(doc.querySelectorAll('rect')).toHaveLength(0);
    // Arrowhead polygons inside the removed groups are gone with them.
    expect(doc.querySelectorAll('polygon')).toHaveLength(0);
    // The furniture outline path survives.
    expect(doc.querySelector('path.st0, path[class="st0"]')).not.toBeNull();
  });
});
