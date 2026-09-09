import { describe, expect, test } from 'vitest';
import { stripSvgLabels } from '../../src/modules/ui/measurement-guide-flash.js';

describe('measurement guide raster cleanup', () => {
  test('preserves structural sofa geometry while removing measurement groups', () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
        <rect id="sofa-body" x="40" y="80" width="320" height="160" fill="#f97316" />
        <g id="couch"><path id="couch-outline" d="M40 80 H360 V240 H40 Z" /></g>
        <line id="seam" x1="80" y1="120" x2="92" y2="120" stroke="#111827" />
        <text x="20" y="30">FRONT</text>
        <g id="mA1"><line x1="60" y1="260" x2="340" y2="260" /></g>
        <g id="cA1"><rect x="180" y="230" width="40" height="20" /><text>A1</text></g>
      </svg>
    `;

    const cleaned = stripSvgLabels(source);

    expect(cleaned).toContain('id="sofa-body"');
    expect(cleaned).toContain('id="seam"');
    expect(cleaned).toContain('id="couch-outline"');
    expect(cleaned).not.toContain('id="mA1"');
    expect(cleaned).not.toContain('id="cA1"');
    expect(cleaned).not.toContain('FRONT');
  });

  test('removes Illustrator-suffixed guide artifacts without stripping furniture geometry', () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 361.2 313">
        <style>
          .st0{fill:none;stroke:#A6A6A6;stroke-width:2.2;stroke-dasharray:5,5;}
          .st1{fill:none;stroke:#4F4F4F;stroke-width:2;}
          .st2{fill:none;stroke:#DE6969;stroke-width:2;}
          .st3{fill:#FFFFFF;stroke:#DE6969;stroke-width:2;}
          .st15{fill:none;stroke:#DE6969;stroke-width:2.2;}
          .st16{fill:#DE6969;}
          .stOrange{fill:#f97316;}
        </style>
        <rect id="sofa-orange-body" x="40" y="80" width="260" height="150" class="stOrange" />
        <path id="construction-line" class="st0" d="M307.6,112c-10.6,3-14.5,12.7-14.5,12.7" />
        <polyline id="sofa-outline" class="st1" points="249.9,145.1 184.4,107.2 31.2,195.6" />
        <g id="bA1cm">
          <rect id="value-box" x="250.3" y="32.7" class="st3" width="53.9" height="17"/>
          <text>0000.00</text>
        </g>
        <g id="mA1cm_00000062882182865007628080000007963397885327792830_">
          <line id="mA1cm" class="st15" x1="302.8" y1="108.7" x2="193.3" y2="45.5"/>
          <polygon id="arrowhead" class="st16" points="303.7,104.8 307.6,111.5 299.9,111.5" />
        </g>
        <g id="cA1cm">
          <circle id="tag-ring" class="st2" cx="248.7" cy="79.2" r="11"/>
          <text>A1</text>
        </g>
      </svg>
    `;

    const cleaned = stripSvgLabels(source);

    expect(cleaned).toContain('id="sofa-orange-body"');
    expect(cleaned).toContain('id="sofa-outline"');
    expect(cleaned).toContain('id="construction-line"');
    expect(cleaned).not.toContain('id="value-box"');
    expect(cleaned).not.toContain('id="mA1cm"');
    expect(cleaned).not.toContain('id="arrowhead"');
    expect(cleaned).not.toContain('id="tag-ring"');
    expect(cleaned).not.toContain('0000.00');
    expect(cleaned).not.toContain('>A1<');
  });

  test('keeps large saturated furniture polygons while removing small orphan arrowheads', () => {
    const source = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
        <style>.orange{fill:#f97316}.arrow{fill:#ef4444}</style>
        <polygon id="orange-sofa" class="orange" points="30,70 370,70 340,250 60,250" />
        <polygon id="orphan-arrow" class="arrow" points="190,265 205,272 190,279" />
      </svg>
    `;

    const cleaned = stripSvgLabels(source);

    expect(cleaned).toContain('id="orange-sofa"');
    expect(cleaned).not.toContain('id="orphan-arrow"');
  });
});
