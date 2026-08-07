import { describe, expect, it } from 'vitest';
import {
  calculateSectionalBounds,
  computeScaleForDimension,
  computeScaledDimension,
  createSectionalPreset,
  deriveGuideCode,
  evaluateSectionalConnections,
  getAssemblyPricing,
  getLiveAssemblyMetrics,
  getLiveMeasurementSegment,
  getLivePieceConnectorAnchors,
  getConnectorWorldSides,
  getPieceDimensions,
  getPiecePricing,
  getSectionalPieceCapabilities,
  getSectionalMeasurementSeeds,
  getSectionalPlanViewBox,
  findLiveSectionalSnap,
  normalizeLiveSectionalTransform,
  normalizeModulePiece,
  pieceFootprint,
  planPointToWorld,
  restoreLiveSectionalTransform,
  sectionalProductMarkup,
  serializeSectionalProductSvg,
  serializeSectionalSvg,
} from '../../src/modules/ui/sectional-builder';
// @ts-expect-error JS module has no type declarations
import { mergeSofaMetadata, normalizeSofaMetadata } from '../../src/modules/sofa-metadata.js';

describe('Sectional Builder vertical slice', () => {
  it('creates a four-piece three-seat sofa with exact component dimensions', () => {
    const pieces = createSectionalPreset('sofa');

    expect(pieces.map(piece => piece.kind)).toEqual(['left-arm', 'seat', 'seat', 'right-arm']);
    // 105 + 90 + 90 + 105 across, 95 deep — from metadata, not grid guesses.
    expect(calculateSectionalBounds(pieces)).toEqual({
      cols: 4,
      rows: 1,
      width: 390,
      depth: 95,
    });
  });

  it('creates a chaise preset whose depth spans two grid rows', () => {
    const pieces = createSectionalPreset('chaise');

    expect(pieces.map(piece => piece.kind)).toEqual(['left-arm', 'seat', 'right-arm-chaise']);
    expect(calculateSectionalBounds(pieces)).toEqual({
      cols: 3,
      rows: 2,
      width: 300,
      depth: 160,
    });
  });

  it('creates an L-shaped preset with a rotated return', () => {
    const pieces = createSectionalPreset('corner');

    expect(pieces).toHaveLength(5);
    expect(pieces.some(piece => piece.kind === 'corner')).toBe(true);
    expect(pieces.filter(piece => piece.rotation === 90)).toHaveLength(2);
    expect(calculateSectionalBounds(pieces)).toMatchObject({
      cols: 3,
      rows: 3,
      width: 295,
      depth: 295,
    });
  });

  it('creates a two-seat preset with three modules', () => {
    const pieces = createSectionalPreset('two-seat');
    expect(pieces.map(p => p.kind)).toEqual(['left-arm', 'seat', 'right-arm']);
    expect(calculateSectionalBounds(pieces)).toMatchObject({ width: 300, depth: 95 });
  });

  it('keeps no-arm and right-arm seat sections as explicit module choices', () => {
    const pieces = createSectionalPreset('sofa');
    expect(pieces.filter(piece => piece.kind === 'seat')).toHaveLength(2);
    expect(pieces.filter(piece => piece.kind === 'right-arm')).toHaveLength(1);
  });

  it('creates an L+chaise preset with a chaise extending from the corner', () => {
    const pieces = createSectionalPreset('l-chaise');
    expect(pieces).toHaveLength(4);
    expect(pieces.some(p => p.kind === 'corner')).toBe(true);
    expect(pieces.some(p => p.kind === 'chaise' && p.rotation === 90)).toBe(true);
  });

  it('creates a sofa+ottoman preset with five modules', () => {
    const pieces = createSectionalPreset('ottoman-set');
    expect(pieces).toHaveLength(5);
    expect(pieces.some(p => p.kind === 'ottoman')).toBe(true);
  });

  it('swaps width and depth for pieces rotated 90 degrees', () => {
    const seat = createSectionalPreset('sofa')[1];
    expect(getPieceDimensions(seat)).toEqual({ width: 90, depth: 95 });
    expect(getPieceDimensions({ ...seat, rotation: 90 })).toEqual({ width: 95, depth: 90 });
  });

  it('gives the chaise a two-row span so it renders visibly longer', () => {
    const chaise = createSectionalPreset('chaise')[2];
    const fp = pieceFootprint(chaise);
    expect(fp.colSpan).toBe(1);
    expect(fp.rowSpan).toBe(2);
    expect(fp.bodyH).toBeGreaterThan(fp.bodyW);
  });

  it('keeps both outside arm fronts visible on a sofa with chaise', () => {
    const pieces = createSectionalPreset('chaise');
    const leftView = sectionalProductMarkup(pieces, 'front-left');
    const rightView = sectionalProductMarkup(pieces, 'front-right');

    expect(leftView.match(/class="sb-arm-front/g) || []).toHaveLength(2);
    expect(rightView.match(/class="sb-arm-front/g) || []).toHaveLength(2);
    expect(leftView).toContain('data-kind="left-arm"');
    expect(leftView).toContain('data-kind="right-arm-chaise"');
  });

  it('keeps standard seats at a single-cell span', () => {
    const seat = createSectionalPreset('sofa')[1];
    expect(pieceFootprint(seat)).toMatchObject({ colSpan: 1, rowSpan: 1 });
  });

  it('uses explicit module anatomy instead of inferring backs and arms while rendering', () => {
    expect(getSectionalPieceCapabilities('ottoman')).toMatchObject({
      hasBackFrame: false,
      hasBackCushion: false,
      armSides: [],
    });
    expect(getSectionalPieceCapabilities('left-arm')).toMatchObject({
      hasBackFrame: true,
      hasBackCushion: true,
      armSides: ['left'],
    });
    expect(getSectionalPieceCapabilities('right-arm-chaise')).toMatchObject({
      hasBackFrame: true,
      hasBackCushion: true,
      armSides: ['right'],
    });
  });

  it('tints the exported SVG with the selected upholstery theme', () => {
    const pieces = createSectionalPreset('sofa');
    const flax = serializeSectionalSvg(pieces, 'Test', 'flax');
    const navy = serializeSectionalSvg(pieces, 'Test', 'navy');
    // Default flax body fill appears in the flax export.
    expect(flax).toContain('#d8ddd7');
    // Navy body fill replaces it in the themed export.
    expect(navy).toContain('#53647f');
    expect(navy).not.toContain('#d8ddd7');
  });

  it('separates the structural back, loose back cushion, seat cushion, and arms', () => {
    const svg = serializeSectionalProductSvg(
      createSectionalPreset('sofa'),
      'Layered sofa',
      'front-left'
    );
    expect(svg).toContain('class="sb-structural-back"');
    expect(svg).toContain('class="sb-structural-back-cap"');
    expect(svg).toContain('class="sb-structural-back-edge');
    expect(svg).toContain('class="sb-back-cushion"');
    expect(svg).toContain('class="sb-back-cushion-edge');
    expect(svg).toContain('class="sb-seat-cushion"');
    expect(svg).toContain('class="sb-seat-cushion-side');
    expect(svg).toContain('class="sb-arm-panel');
    expect(svg).toContain('class="sb-arm-inner');
    expect(svg).toContain('class="sb-arm-front');
  });

  it('rotates product geometry with return modules instead of facing every cushion forward', () => {
    const svg = serializeSectionalProductSvg(
      createSectionalPreset('corner'),
      'Corner sofa',
      'front-left'
    );
    expect(svg).toContain('data-rotation="0"');
    expect(svg).toContain('data-rotation="90"');
    // Every back-capable module shows a loose cushion from the canonical
    // camera: three main-row pieces, the corner's return cushion, and both
    // return-leg cushions.
    const backCushions = svg.match(/<path class="sb-back-cushion(?:\s|")/g) || [];
    expect(backCushions).toHaveLength(6);
    expect(svg).toContain('sb-corner-return-back');
    expect(svg).toContain('sb-corner-return-cushion');
  });

  it('rotates connector sides clockwise with the piece', () => {
    const seat = createSectionalPreset('sofa')[1];
    expect(getConnectorWorldSides(seat)).toEqual(['left', 'right']);
    expect(getConnectorWorldSides({ ...seat, rotation: 90 })).toEqual(['top', 'bottom']);
    expect(getConnectorWorldSides({ ...seat, rotation: 180 })).toEqual(['right', 'left']);
  });

  it('mirroring swaps semantic left and right connectors', () => {
    const leftArm = createSectionalPreset('sofa')[0];
    expect(getConnectorWorldSides(leftArm)).toEqual(['right']);
    expect(getConnectorWorldSides({ ...leftArm, mirrored: true })).toEqual(['left']);
    const corner = createSectionalPreset('corner')[2];
    expect(getConnectorWorldSides({ ...corner, mirrored: true })).toEqual(['right', 'bottom']);
  });

  it('derives CW guide codes from piece kind and mirror state', () => {
    const [la, , , ra] = createSectionalPreset('sofa');
    expect(deriveGuideCode(la)).toBe('CS1B-RA-HB-L');
    expect(deriveGuideCode({ ...la, mirrored: true })).toBe('CS1B-RA-HB-R');
    expect(deriveGuideCode(ra)).toBe('CS1B-RA-HB-R');
    expect(deriveGuideCode({ ...ra, mirrored: true })).toBe('CS1B-RA-HB-L');

    const seat = createSectionalPreset('sofa')[1];
    expect(deriveGuideCode(seat)).toBe('CS1B');

    const cornerPiece = createSectionalPreset('corner')[2];
    expect(deriveGuideCode(cornerPiece)).toBe('CS1-CNR');

    const chaisePiece = createSectionalPreset('chaise')[2];
    expect(deriveGuideCode(chaisePiece)).toBe('CS5L-RA-HB-R');

    const ottoman: any = { id: 'x', kind: 'ottoman', col: 0, row: 0, rotation: 0, mirrored: false };
    expect(deriveGuideCode(ottoman)).toBe('CS0-SNUG');
  });

  it('respects a manual guideCode override on a piece', () => {
    const seat = createSectionalPreset('sofa')[1];
    expect(deriveGuideCode({ ...seat, guideCode: 'CUSTOM-CODE' })).toBe('CUSTOM-CODE');
  });

  it('gives the ottoman no connectors and a single-cell footprint', () => {
    const ottoman: any = { id: 'x', kind: 'ottoman', col: 0, row: 0, rotation: 0, mirrored: false };
    expect(pieceFootprint(ottoman)).toMatchObject({ colSpan: 1, rowSpan: 1 });
    expect(getConnectorWorldSides(ottoman)).toEqual([]);
    const report = evaluateSectionalConnections([ottoman]);
    expect(report.connected.size).toBe(0);
    expect(report.conflicts.size).toBe(0);
  });

  it('computes scaled dimensions parametrically from base cm and user scale', () => {
    expect(computeScaledDimension(95, 1)).toBe(95);
    expect(computeScaledDimension(95, 1.1)).toBe(105);
    expect(computeScaledDimension(160, 1.5)).toBe(240);
    expect(computeScaledDimension(90, 0.5)).toBe(45);
    expect(computeScaledDimension(100, 0.001)).toBe(1); // never goes below 1
  });

  it('converts typed dimensions back into exact live-object scales', () => {
    expect(computeScaleForDimension(95, 0.5, 120)).toBeCloseTo(0.6315789);
    expect(computeScaleForDimension(90, 0.75, 105)).toBeCloseTo(0.875);
    expect(computeScaledDimension(95, computeScaleForDimension(95, 1, 120))).toBe(120);
    expect(computeScaleForDimension(0, 0.5, 120)).toBe(0.5);
  });

  it('marks every socket in the standard presets as connected with no conflicts', () => {
    const sofa = evaluateSectionalConnections(createSectionalPreset('sofa'));
    expect(sofa.conflicts.size).toBe(0);
    expect(sofa.connected.size).toBe(6); // three joints, two keys each

    const corner = evaluateSectionalConnections(createSectionalPreset('corner'));
    expect(corner.conflicts.size).toBe(0);
    expect(corner.connected.size).toBe(8); // four joints

    const chaise = evaluateSectionalConnections(createSectionalPreset('chaise'));
    expect(chaise.conflicts.size).toBe(0);
    expect(chaise.connected.size).toBe(4); // two joints
  });

  it('flags a socket facing a piece without a matching socket as a conflict', () => {
    const [first, second] = createSectionalPreset('sofa');
    const pieces = [
      { ...first, id: 'a' }, // left-arm with a right socket
      { ...second, kind: 'left-arm' as const, id: 'b', col: 1 }, // arm has no left socket
    ];
    const report = evaluateSectionalConnections(pieces);
    expect(report.conflicts.has('a:right')).toBe(true);
    expect(report.connected.size).toBe(0);
  });

  it('exports a tightly cropped SVG plan that preserves readable labels', () => {
    const svg = serializeSectionalSvg(createSectionalPreset('sofa'), 'Test sectional');

    expect(svg).toContain('Test sectional');
    expect(svg).toContain('390 × 95 cm');
    expect(svg).not.toContain('Approx.');
    expect(svg).not.toContain(`viewBox="0 0 920 620"`);
  });

  it('annotates per-column widths and overall dimensions on the plan', () => {
    const svg = serializeSectionalSvg(createSectionalPreset('sofa'), 'Dims');

    expect(svg).toContain('class="sb-dimensions"');
    // Per-column segments carry each component width.
    expect(svg).toContain('>105</text>');
    expect(svg).toContain('>90</text>');
    // Overall lines carry the totals with units.
    expect(svg).toContain('>390 cm</text>');
    expect(svg).toContain('>95 cm</text>');
  });

  it('seeds overall and per-column measurements matching the plan dimension lines', () => {
    const pieces = createSectionalPreset('sofa');
    const seeds = getSectionalMeasurementSeeds(pieces);

    expect(seeds).toHaveLength(6); // overall width + overall depth + 4 columns
    expect(seeds[0]).toMatchObject({ role: 'overall-width', suggestedTag: 'A1', valueCm: 390 });
    expect(seeds[1]).toMatchObject({ role: 'overall-depth', suggestedTag: 'A2', valueCm: 95 });
    expect(seeds.slice(2).map(seed => seed.suggestedTag)).toEqual(['A3', 'A4', 'A5', 'A6']);
    expect(seeds.slice(2).every(seed => Boolean(seed.pieceId))).toBe(true);
    expect(seeds.slice(2).map(seed => seed.valueCm)).toEqual([105, 90, 90, 105]);
    // Overall width spans the full assembly; column segments stay inside it.
    expect(seeds[2].x1).toBeGreaterThan(seeds[0].x1);
    expect(seeds[5].x2).toBeLessThan(seeds[0].x2);
    // All width seeds are horizontal lines.
    seeds
      .filter(seed => seed.role !== 'overall-depth')
      .forEach(seed => expect(seed.y1).toBe(seed.y2));
  });

  it('returns no seeds for an empty assembly', () => {
    expect(getSectionalMeasurementSeeds([])).toEqual([]);
  });

  it('maps plan points into world coordinates proportionally to the image rect', () => {
    const pieces = createSectionalPreset('sofa');
    const viewBox = getSectionalPlanViewBox(pieces);
    const rect = { left: 500, top: 300, width: 1200, height: 800 };

    const topLeft = planPointToWorld(viewBox.x, viewBox.y, viewBox, rect);
    expect(topLeft).toEqual({ x: 500, y: 300 });
    const bottomRight = planPointToWorld(
      viewBox.x + viewBox.width,
      viewBox.y + viewBox.height,
      viewBox,
      rect
    );
    expect(bottomRight).toEqual({ x: 1700, y: 1100 });
    const center = planPointToWorld(
      viewBox.x + viewBox.width / 2,
      viewBox.y + viewBox.height / 2,
      viewBox,
      rect
    );
    expect(center).toEqual({ x: 1100, y: 700 });
  });

  it('keeps seed coordinates inside the exported viewBox', () => {
    const pieces = createSectionalPreset('corner');
    const viewBox = getSectionalPlanViewBox(pieces);
    getSectionalMeasurementSeeds(pieces).forEach(seed => {
      expect(Math.min(seed.x1, seed.x2)).toBeGreaterThanOrEqual(viewBox.x);
      expect(Math.max(seed.x1, seed.x2)).toBeLessThanOrEqual(viewBox.x + viewBox.width);
      expect(Math.min(seed.y1, seed.y2)).toBeGreaterThanOrEqual(viewBox.y);
      expect(Math.max(seed.y1, seed.y2)).toBeLessThanOrEqual(viewBox.y + viewBox.height);
    });
  });

  it('normalizes a module to its canonical orientation while preserving mirror', () => {
    const rotated = createSectionalPreset('corner')[3]; // seat rotated 90
    const normalized = normalizeModulePiece(rotated);
    expect(normalized.rotation).toBe(0);
    expect(normalized.col).toBe(0);
    expect(normalized.row).toBe(0);

    const mirroredArm = { ...createSectionalPreset('sofa')[0], mirrored: true };
    expect(normalizeModulePiece(mirroredArm).mirrored).toBe(true);
  });

  it('seeds only overall dimensions for a single-module plan', () => {
    const modulePiece = normalizeModulePiece(createSectionalPreset('sofa')[0]);
    const seeds = getSectionalMeasurementSeeds([modulePiece]);

    expect(seeds.map(seed => seed.role)).toEqual(['overall-width', 'overall-depth']);
    expect(seeds[0].valueCm).toBe(105);
    expect(seeds[1].valueCm).toBe(95);
  });

  it('persists assembly records through project metadata normalization', () => {
    const pieces = createSectionalPreset('sofa');
    const record = {
      id: 'assembly-1',
      name: '3-seat sofa',
      pieces,
      imageViewId: 'front',
      updatedAt: '2026-07-22T00:00:00.000Z',
      pricingCountry: 'AU',
      pricingFabric: 'care-linen',
    };
    const merged = mergeSofaMetadata({}, { sectionalAssemblies: { 'assembly-1': record } });
    expect(merged.sectionalAssemblies['assembly-1']).toMatchObject({
      id: 'assembly-1',
      name: '3-seat sofa',
      imageViewId: 'front',
      pricingCountry: 'AU',
      pricingFabric: 'care-linen',
    });
    expect(merged.sectionalAssemblies['assembly-1'].pieces).toHaveLength(4);

    const roundTripped = normalizeSofaMetadata(merged);
    expect(roundTripped.sectionalAssemblies['assembly-1'].pieces).toEqual(pieces);
  });

  it('preserves ottoman kind and guideCode through metadata normalization', () => {
    const ottomanPiece = {
      id: 'ott-1',
      kind: 'ottoman',
      col: 0,
      row: 0,
      rotation: 0,
      mirrored: false,
      guideCode: 'CS0-CNRP',
    };
    const armPiece = {
      id: 'la-1',
      kind: 'left-arm',
      col: 1,
      row: 0,
      rotation: 0,
      mirrored: false,
      guideCode: 'CS1B-RA-HB-L',
    };
    const merged = mergeSofaMetadata(
      {},
      {
        sectionalAssemblies: {
          'assm-ott': {
            id: 'assm-ott',
            name: 'Ottoman test',
            pieces: [ottomanPiece, armPiece],
            imageViewId: '',
            updatedAt: '',
          },
        },
      }
    );
    const pieces = merged.sectionalAssemblies['assm-ott'].pieces;
    expect(pieces).toHaveLength(2);
    expect(pieces[0].kind).toBe('ottoman');
    expect(pieces[0].guideCode).toBe('CS0-CNRP');
    expect(pieces[1].guideCode).toBe('CS1B-RA-HB-L');
  });

  it('drops malformed assembly pieces instead of failing normalization', () => {
    const merged = mergeSofaMetadata(
      {},
      {
        sectionalAssemblies: {
          bad: {
            id: 'bad',
            pieces: [
              { kind: 'seat', col: 0, row: 0, rotation: 0, mirrored: false },
              { kind: 'unknown', col: 1, row: 0 },
              { kind: 'seat', col: 'x', row: 0 },
            ],
          },
        },
      }
    );
    expect(merged.sectionalAssemblies.bad.pieces).toHaveLength(1);
    expect(merged.sectionalAssemblies.bad.pieces[0].kind).toBe('seat');
  });

  it('maps each piece kind to a CW product with price and URL', () => {
    const seat = createSectionalPreset('sofa')[1];
    const product = getPiecePricing(seat);
    expect(product).not.toBeNull();
    expect(product!.price).toBe(469);
    expect(product!.url).toContain('comfort-works.com/products/');
  });

  it('maps mirrored left-arm to the right-facing CW product', () => {
    const la = createSectionalPreset('sofa')[0];
    expect(getPiecePricing(la)!.ref).toBe('CS1B-SSA-L');
    expect(getPiecePricing({ ...la, mirrored: true })!.ref).toBe('CS1B-SSA-R');
  });

  it('computes the total assembly pricing across all pieces', () => {
    const pieces = createSectionalPreset('sofa');
    const pricing = getAssemblyPricing(pieces);
    expect(pricing.items).toHaveLength(4);
    // US Everyday Weave: LA($559) + Seat($469) + Seat($469) + RA($559)
    expect(pricing.total).toBe(2056);
    expect(pricing.currency).toBe('USD');
  });

  it('uses the selected country currency and selected-fabric catalog', () => {
    const pieces = createSectionalPreset('two-seat');
    const catalog: any = {
      'boxed-seat-left-square-arm-chair-section-cover': {
        'care-linen': { price: 1159 },
      },
      'boxed-seat-right-square-arm-chair-section-cover': {
        'care-linen': { price: 1159 },
      },
      'boxed-seat-armless-chair-slipcover': {
        'care-linen': { price: 969 },
      },
    };
    const pricing = getAssemblyPricing(pieces, 'AU', 'care-linen', catalog);
    expect(pricing.total).toBe(3287);
    expect(pricing.currency).toBe('AUD');
  });

  it('links each price to the selected country storefront', () => {
    const pieces = createSectionalPreset('two-seat');
    const japan = getAssemblyPricing(pieces, 'JP');
    const uk = getAssemblyPricing(pieces, 'GB');
    const canada = getAssemblyPricing(pieces, 'CA');

    expect(japan.items[1].product.url).toBe(
      'https://comfort-works.com/ja-jp/products/boxed-seat-armless-chair-slipcover'
    );
    expect(japan.currency).toBe('JPY');
    expect(uk.items[1].product.url).toBe(
      'https://comfort-works.co.uk/products/boxed-seat-armless-chair-slipcover'
    );
    expect(canada.items[1].product.url).toBe(
      'https://comfort-works.com/products/boxed-seat-armless-chair-slipcover?country=CA'
    );
  });

  it('includes ottoman pricing from the ottoman collection', () => {
    const ottoman: any = { id: 'x', kind: 'ottoman', col: 0, row: 0, rotation: 0, mirrored: false };
    const product = getPiecePricing(ottoman);
    expect(product!.price).toBe(249);
    expect(product!.url).toContain('ottoman');
  });

  it('keeps width and depth measurement segments attached to a rotated live piece', () => {
    const geometry: any = {
      pieceId: 'seat-1',
      kind: 'seat',
      mirrored: false,
      corners: [
        { x: 200, y: 100 },
        { x: 300, y: 200 },
        { x: 220, y: 280 },
        { x: 120, y: 180 },
      ],
    };

    const width = getLiveMeasurementSegment(geometry, 'width', 20);
    const depth = getLiveMeasurementSegment(geometry, 'depth', 20);

    expect(width.start.x).toBeCloseTo(214.14, 1);
    expect(width.start.y).toBeCloseTo(85.86, 1);
    expect(width.end.x).toBeCloseTo(314.14, 1);
    expect(width.end.y).toBeCloseTo(185.86, 1);
    expect(depth.start.x).toBeCloseTo(185.86, 1);
    expect(depth.start.y).toBeCloseTo(85.86, 1);
    expect(depth.end.x).toBeCloseTo(105.86, 1);
    expect(depth.end.y).toBeCloseTo(165.86, 1);
  });

  it('snaps compatible live connectors without relying on grid coordinates', () => {
    const left: any = {
      pieceId: 'left-arm',
      kind: 'left-arm',
      mirrored: false,
      corners: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 90 },
        { x: 0, y: 90 },
      ],
    };
    const seat: any = {
      pieceId: 'seat',
      kind: 'seat',
      mirrored: false,
      corners: [
        { x: 109, y: 2 },
        { x: 199, y: 2 },
        { x: 199, y: 92 },
        { x: 109, y: 92 },
      ],
    };

    expect(getLivePieceConnectorAnchors(left)).toMatchObject([
      { pieceId: 'left-arm', localSide: 'right', point: { x: 100, y: 45 } },
    ]);
    expect(findLiveSectionalSnap(seat, [left], 16)).toMatchObject({
      movingPieceId: 'seat',
      targetPieceId: 'left-arm',
      delta: { x: -9, y: -2 },
    });
  });

  it('does not snap incompatible connectors that happen to be close together', () => {
    const leftArm: any = {
      pieceId: 'left-1',
      kind: 'left-arm',
      mirrored: false,
      corners: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 90 },
        { x: 0, y: 90 },
      ],
    };
    const otherLeftArm: any = {
      pieceId: 'left-2',
      kind: 'left-arm',
      mirrored: false,
      corners: [
        { x: 108, y: 0 },
        { x: 208, y: 0 },
        { x: 208, y: 90 },
        { x: 108, y: 90 },
      ],
    };
    expect(findLiveSectionalSnap(otherLeftArm, [leftArm], 16)).toBeNull();
  });

  it('recomputes overall live dimensions from the transformed assembly bounds', () => {
    const initial = { left: 100, top: 200, width: 400, height: 100 };
    const current = { left: 80, top: 180, width: 500, height: 150 };
    expect(getLiveAssemblyMetrics(current, initial, 390, 95)).toEqual({
      bounds: current,
      widthCm: 488,
      depthCm: 143,
    });
  });

  it('round-trips live transforms through normalized project coordinates', () => {
    const worldRect = { left: 300, top: 120, width: 1200, height: 800 };
    const normalized = normalizeLiveSectionalTransform(
      { left: 720, top: 360, scaleX: 1.8, scaleY: 1.2, angle: 27 },
      worldRect,
      1.5,
      1
    );
    expect(normalized).toEqual({
      x: 0.35,
      y: 0.3,
      scaleX: 1.2,
      scaleY: 1.2,
      angle: 27,
    });
    const restored = restoreLiveSectionalTransform(normalized, worldRect, 1.5, 1);
    expect(restored.left).toBeCloseTo(720);
    expect(restored.top).toBeCloseTo(360);
    expect(restored.scaleX).toBeCloseTo(1.8);
    expect(restored.scaleY).toBeCloseTo(1.2);
    expect(restored.angle).toBe(27);
  });

  it('preserves normalized live transforms through project metadata', () => {
    const pieces = createSectionalPreset('sofa');
    const liveTransforms = {
      [pieces[0].id]: { x: 0.1, y: 0.2, scaleX: 1.15, scaleY: 0.9, angle: 12 },
    };
    const merged = mergeSofaMetadata(
      {},
      {
        sectionalAssemblies: {
          live: {
            id: 'live',
            name: 'Live assembly',
            pieces,
            imageViewId: 'front',
            updatedAt: '2026-07-27T00:00:00.000Z',
            liveTransforms,
          },
        },
      }
    );
    expect(merged.sectionalAssemblies.live.liveTransforms).toEqual(liveTransforms);
  });

  it('renders selectable left and right 45-degree product views', () => {
    const pieces = createSectionalPreset('sofa');
    const left = serializeSectionalProductSvg(pieces, 'Product', 'front-left');
    const right = serializeSectionalProductSvg(pieces, 'Product', 'front-right');

    expect(left).toContain('data-section-view="front-left"');
    expect(right).toContain('data-section-view="front-right"');
    expect(left).toContain('Left 45° product view');
    expect(right).toContain('Right 45° product view');
    expect(left).not.toEqual(right);
  });

  it('applies gallery-inspired arm, back, cushion, and base choices', () => {
    const pieces = createSectionalPreset('sofa').map(piece => ({
      ...piece,
      armStyle: 'round' as const,
      backStyle: 'curved' as const,
      cushionStyle: 'knife' as const,
      baseStyle: 'skirt' as const,
    }));
    const markup = sectionalProductMarkup(pieces, 'front-left');

    expect(markup).toContain('data-arm="round"');
    expect(markup).toContain('data-back="curved"');
    expect(markup).toContain('data-cushion="knife"');
    expect(markup).toContain('data-base="skirt"');
    expect(markup).toContain('<path');
  });

  it('draws genuinely different arm silhouettes rather than recoloring one box', () => {
    const pieces = createSectionalPreset('two-seat');
    const square = sectionalProductMarkup(pieces, 'front-left', 'flax', {
      arm: 'square',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });
    const round = sectionalProductMarkup(pieces, 'front-left', 'flax', {
      arm: 'round',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });
    const slope = sectionalProductMarkup(pieces, 'front-left', 'flax', {
      arm: 'wedge',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });

    expect(square).not.toContain(' sb-arm-roll"');
    expect(round).toContain(' sb-arm-roll"');
    expect(round).toContain('class="sb-arm-front sb-arm-front-round sb-arm-roll"');
    expect(round).not.toContain('<ellipse class="sb-arm-roll"');
    expect(slope).toContain('class="sb-arm-slope-line"');
    expect(round).not.toEqual(square);
    expect(slope).not.toEqual(square);
  });

  it('keeps arms outside the usable seat while preserving the module footprint', () => {
    const markup = sectionalProductMarkup(createSectionalPreset('sofa'), 'front-left', 'flax', {
      arm: 'square',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });

    expect(markup).toContain('data-kind="left-arm"');
    expect(markup).toContain('data-kind="right-arm"');
    expect(markup).toContain('data-arm-extension="29"');
    expect(markup).toContain('data-seat-start="29"');
    // Arm piece is 105cm × 1.32 px/cm = 138.6 px body width; the arm is a real
    // 22 cm volume, so the seat ends at bodyW − 29.
    expect(markup).toContain('data-seat-end="109.6"');
    // Left 45 mirrors the canonical Right 45 render, so it retains the
    // canonical face semantics while SVG applies the horizontal transform.
    expect(markup).toContain('class="sb-body-side sb-body-side-left"');
    expect(markup).not.toContain('class="sb-body-side sb-body-side-right"');
    expect(markup).toContain('class="sb-arm-inner sb-arm-inner-square"');
  });

  it('keeps physical surface passes available for depth sorting', () => {
    const markup = sectionalProductMarkup(createSectionalPreset('sofa'), 'front-left', 'flax', {
      arm: 'square',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });
    expect(markup).toContain('sb-product-layer-rear');
    expect(markup).toContain('sb-product-layer-body');
    expect(markup).toContain('sb-product-layer-arm');
    const returnMarkup = sectionalProductMarkup(
      createSectionalPreset('corner'),
      'front-left',
      'flax',
      {
        arm: 'square',
        back: 'high',
        cushion: 'boxed',
        base: 'snug',
      }
    );
    // Surface wrappers remain independently inspectable in the canonical
    // product render; the mirrored view reuses this exact sequence.
    expect(markup.match(/sb-product-layer-body/g)?.length).toBeGreaterThan(4);
  });

  it('keeps each far-to-near module contiguous in the painter sequence', () => {
    const pieces = createSectionalPreset('corner');
    const markup = sectionalProductMarkup(pieces, 'front-left');
    const paintedPieceIds = [...markup.matchAll(/data-piece-id="([^"]+)"/g)].map(match => match[1]);
    const contiguousRuns = paintedPieceIds.filter(
      (pieceId, index) => index === 0 || pieceId !== paintedPieceIds[index - 1]
    );

    expect(new Set(paintedPieceIds)).toEqual(new Set(pieces.map(piece => piece.id)));
    expect(contiguousRuns).toHaveLength(pieces.length);
    expect(new Set(contiguousRuns).size).toBe(contiguousRuns.length);
    expect(markup).toContain('sb-product-layer-rear');
    expect(markup).toContain('sb-product-layer-body');
    expect(markup).toContain('data-canonical-view="front-right"');
  });

  it('paints each module in physical back-to-front anatomy order', () => {
    const leftArm = createSectionalPreset('sofa')[0];
    const markup = sectionalProductMarkup([leftArm], 'front-right');
    const structuralBack = markup.indexOf('sb-structural-back');
    const looseBack = markup.indexOf('sb-back-cushion');
    const base = markup.indexOf('sb-body-side');
    const seat = markup.indexOf('sb-seat-cushion');
    const arm = markup.indexOf('sb-arm-');

    expect(structuralBack).toBeGreaterThan(-1);
    expect(looseBack).toBeGreaterThan(structuralBack);
    expect(base).toBeGreaterThan(looseBack);
    expect(seat).toBeGreaterThan(base);
    expect(arm).toBeGreaterThan(seat);
  });

  it('mirrors the canonical right render without changing its surface order', () => {
    const pieces = createSectionalPreset('corner');
    const left = sectionalProductMarkup(pieces, 'front-left');
    const right = sectionalProductMarkup(pieces, 'front-right');

    pieces.forEach(piece => {
      expect(left).toContain(`data-piece-id="${piece.id}"`);
      expect(right).toContain(`data-piece-id="${piece.id}"`);
    });
    expect(left).toContain('data-canonical-view="front-right"');
    expect(left).toContain('transform="translate(920 0) scale(-1 1)"');
    expect(right).toContain('data-canonical-view="front-right"');
    expect(right).not.toContain('transform="translate(920 0) scale(-1 1)"');

    const normalizeViewWrapper = (markup: string) =>
      markup.replace(
        /data-section-view="front-(?:left|right)" data-canonical-view="front-right"(?: transform="translate\(920 0\) scale\(-1 1\)")?/,
        'data-section-view="canonical" data-canonical-view="front-right"'
      );
    expect(normalizeViewWrapper(left)).toBe(normalizeViewWrapper(right));
  });

  it('uses one authoritative set of visible module faces for both mirrored angles', () => {
    const pieces = createSectionalPreset('sofa');
    const left = sectionalProductMarkup(pieces, 'front-left');
    const right = sectionalProductMarkup(pieces, 'front-right');

    expect(right).toContain('sb-body-side-left');
    expect(right).not.toContain('sb-body-side-right');
    expect(left).toContain('sb-body-side-left');
    expect(left).not.toContain('sb-body-side-right');
  });

  it('keeps canonical arm visibility unchanged in the mirrored view', () => {
    const pieces = createSectionalPreset('sofa');
    const leftView = sectionalProductMarkup(pieces, 'front-left');
    const rightView = sectionalProductMarkup(pieces, 'front-right');

    const pieceSurfaces = (markup: string, kind: string, layer: string) =>
      [
        ...markup.matchAll(
          new RegExp(
            `<g class="sb-product-piece sb-product-layer-${layer}"[^>]*data-kind="${kind}"[\\s\\S]*?<\\/g>`,
            'g'
          )
        ),
      ]
        .map(match => match[0])
        .join('');
    const rightArmInLeftView = pieceSurfaces(leftView, 'right-arm', 'arm');
    const rightArmInRightView = pieceSurfaces(rightView, 'right-arm', 'arm');

    expect(rightArmInLeftView).toBe(rightArmInRightView);
    expect(rightArmInRightView).toContain('sb-arm-inner');
    expect(rightArmInRightView).not.toContain('sb-arm-panel');
  });

  it('keeps the structural corner return behind its own loose cushion', () => {
    const pieces = createSectionalPreset('corner');
    const leftMarkup = sectionalProductMarkup(pieces, 'front-left');
    const rightMarkup = sectionalProductMarkup(pieces, 'front-right');

    expect(leftMarkup).toContain('sb-corner-return-back');
    expect(rightMarkup).toContain('sb-corner-return-back');
    // A furnished corner unit carries a cushion on the return frame too, and
    // the frame must paint before (behind) that cushion.
    expect(rightMarkup).toContain('sb-corner-return-cushion');
    expect(rightMarkup.indexOf('sb-corner-return-back')).toBeLessThan(
      rightMarkup.indexOf('sb-corner-return-cushion')
    );
  });

  it('does not add a structural or loose back to an ottoman', () => {
    const markup = sectionalProductMarkup(createSectionalPreset('ottoman-set'), 'front-right');
    const ottomanMarkup = [
      ...markup.matchAll(
        /<g class="sb-product-piece sb-product-layer-body"[^>]*data-kind="ottoman"[\s\S]*?<\/g>/g
      ),
    ]
      .map(match => match[0])
      .join('');
    const ottomanRearLayer =
      markup.match(
        /<g class="sb-product-piece sb-product-layer-rear"[^>]*data-kind="ottoman"[\s\S]*?<\/g>/
      )?.[0] || '';

    expect(ottomanMarkup).toContain('sb-seat-cushion');
    expect(ottomanRearLayer).toBe('');
  });

  it('shows loose back cushions on camera-facing perpendicular returns', () => {
    const pieces = createSectionalPreset('corner');
    const markup = sectionalProductMarkup(pieces, 'front-right');
    const rotatedPieces = pieces.filter(piece => piece.rotation === 90);
    expect(rotatedPieces.length).toBeGreaterThan(0);
    // The canonical camera sees the upholstered face of a return leg's back,
    // so its loose cushion is legitimately visible — hiding it left the
    // return reading as a bare bench. The structural frame still paints
    // first (behind the cushion) within each module.
    rotatedPieces.forEach(piece => {
      const pieceMarkup = [
        ...markup.matchAll(
          new RegExp(
            `<g class="sb-product-piece[^"]*"[^>]*data-piece-id="${piece.id}"[\\s\\S]*?<\\/g>`,
            'g'
          )
        ),
      ]
        .map(match => match[0])
        .join('');
      expect(pieceMarkup).toContain('sb-structural-back');
      expect(pieceMarkup).toContain('sb-back-cushion');
      expect(pieceMarkup.indexOf('sb-structural-back')).toBeLessThan(
        pieceMarkup.indexOf('sb-back-cushion')
      );
    });
  });

  it('hides loose back cushions when the back shell faces the camera', () => {
    const flipped: any = {
      id: 'flipped-seat',
      kind: 'seat',
      col: 0,
      row: 0,
      rotation: 270,
      mirrored: false,
    };
    const markup = sectionalProductMarkup([flipped], 'front-right');
    expect(markup).toContain('sb-structural-back');
    expect(markup).not.toContain('sb-back-cushion');
  });

  it('uses the selected arm and back measurement family where one exists', () => {
    const leftArm = createSectionalPreset('sofa')[0];
    expect(deriveGuideCode({ ...leftArm, armStyle: 'round', backStyle: 'short' })).toBe(
      'CS1B-RA-SB-L'
    );
    expect(deriveGuideCode({ ...leftArm, armStyle: 'wedge', backStyle: 'curved' })).toBe(
      'CS1B-WA-RB-L'
    );
    expect(deriveGuideCode({ ...leftArm, armStyle: 'square', backStyle: 'high' })).toBe(
      'CS1B-SA-HB-L'
    );
  });

  // ── Geometry-level assertions ────────────────────────────────────────
  // The count-based tests above cannot catch wrong-order or exploded-layout
  // regressions. These inspect the projected 2D geometry directly.

  /** Extract the projected points of one surface of one piece. */
  function surfacePoints(
    markup: string,
    pieceId: string,
    className: string
  ): Array<[number, number]> {
    const groups =
      markup.match(
        new RegExp(
          `<g class="sb-product-piece[^"]*"[^>]*data-piece-id="${pieceId}"[^>]*>[\\s\\S]*?</g>`,
          'g'
        )
      ) || [];
    for (const group of groups) {
      const element = group.match(
        new RegExp(`<(?:path|polygon)\\b[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>`)
      );
      if (!element) continue;
      const dMatch = element[0].match(/\bd="([^"]+)"/);
      const pMatch = element[0].match(/\bpoints="([^"]+)"/);
      const raw = dMatch?.[1] || pMatch?.[1];
      if (!raw) continue;
      const nums = raw.match(/-?\d+\.?\d*/g) || [];
      const points: Array<[number, number]> = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        points.push([Number(nums[i]), Number(nums[i + 1])]);
      }
      return points;
    }
    return [];
  }

  function segmentDistance(a: [number, number], b: [number, number], p: [number, number]): number {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq
      ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
      : 0;
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  }

  /** Minimum distance between the edges of two projected polygons. */
  function polygonDistance(a: Array<[number, number]>, b: Array<[number, number]>): number {
    let best = Infinity;
    const edgesOf = (poly: Array<[number, number]>) =>
      poly.map((point, index) => [point, poly[(index + 1) % poly.length]] as const);
    edgesOf(a).forEach(([a0, a1]) => {
      edgesOf(b).forEach(([b0, b1]) => {
        [a0, a1].forEach(point => {
          best = Math.min(best, segmentDistance(b0, b1, point));
        });
        [b0, b1].forEach(point => {
          best = Math.min(best, segmentDistance(a0, a1, point));
        });
      });
    });
    return best;
  }

  it('abuts the L-shape return leg against the corner with no exploded gap', () => {
    const pieces = createSectionalPreset('corner');
    const markup = sectionalProductMarkup(pieces, 'front-right');
    const cornerPiece = pieces.find(piece => piece.kind === 'corner')!;
    const returnSeat = pieces.find(piece => piece.kind === 'seat' && piece.rotation === 90)!;

    const cornerCushion = surfacePoints(markup, cornerPiece.id, 'sb-seat-cushion');
    const returnCushion = surfacePoints(markup, returnSeat.id, 'sb-seat-cushion');
    expect(cornerCushion.length).toBeGreaterThan(2);
    expect(returnCushion.length).toBeGreaterThan(2);
    // Connected modules must share a cushion seam: any larger gap means the
    // return leg has detached from the corner again.
    expect(polygonDistance(cornerCushion, returnCushion)).toBeLessThan(14);

    // The structural backs along the spine must form one continuous wall.
    const cornerBack = surfacePoints(markup, cornerPiece.id, 'sb-corner-return-back');
    const returnBack = surfacePoints(markup, returnSeat.id, 'sb-structural-back');
    expect(cornerBack.length).toBeGreaterThan(2);
    expect(returnBack.length).toBeGreaterThan(2);
    expect(polygonDistance(cornerBack, returnBack)).toBeLessThan(8);
  });

  it('suppresses interior faces at connected joints', () => {
    const pieces = createSectionalPreset('corner');
    const markup = sectionalProductMarkup(pieces, 'front-right');
    const cornerPiece = pieces.find(piece => piece.kind === 'corner')!;
    const cornerMarkup = markup
      .match(
        new RegExp(
          `<g class="sb-product-piece[^"]*"[^>]*data-piece-id="${cornerPiece.id}"[^>]*>[\\s\\S]*?</g>`,
          'g'
        )
      )!
      .join('');

    // The corner's front edge joins the return leg: no base front face and no
    // cushion front face may hang between the two modules.
    expect(cornerMarkup).not.toContain('sb-body-front');
    expect(cornerMarkup).not.toContain('sb-seat-cushion-front');

    // A freestanding corner still shows its front.
    const solo = sectionalProductMarkup([{ ...cornerPiece, col: 0, row: 0 }], 'front-right');
    expect(solo).toContain('sb-body-front');
  });

  it('models the round arm as a rolled volume, not a flat panel', () => {
    const pieces = createSectionalPreset('two-seat');
    const round = sectionalProductMarkup(pieces, 'front-right', 'flax', {
      arm: 'round',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });
    const square = sectionalProductMarkup(pieces, 'front-right', 'flax', {
      arm: 'square',
      back: 'high',
      cushion: 'boxed',
      base: 'snug',
    });

    // The round arm's end cap must bow out in a curve (Ektorp-style roll);
    // the square arm's stays rectilinear.
    const roundFront = round.match(/<path class="sb-arm-front[^"]*"[^>]*d="([^"]+)"/)!;
    const squareFront = square.match(/<path class="sb-arm-front[^"]*"[^>]*d="([^"]+)"/)!;
    expect(roundFront[1]).toContain('Q');
    expect(squareFront[1]).not.toContain('Q');
    // The roll is a swept body with three shading bands per arm, and the
    // outermost band bulges past the arm body for the letter-P profile.
    expect(round.match(/sb-arm-roll-body/g) || []).toHaveLength(2);
    expect(round.match(/sb-arm-roll-band-(?:inner|crown|outer)"/g) || []).toHaveLength(6);
    expect(square).not.toContain('sb-arm-roll-band');
  });

  it('wraps the skirt around camera-facing open edges only', () => {
    const pieces = createSectionalPreset('two-seat');
    const markup = sectionalProductMarkup(pieces, 'front-right', 'flax', {
      arm: 'square',
      back: 'high',
      cushion: 'boxed',
      base: 'long-skirt',
    });
    const middleSeat = pieces[1];
    const seatMarkup = markup
      .match(
        new RegExp(
          `<g class="sb-product-piece[^"]*"[^>]*data-piece-id="${middleSeat.id}"[^>]*>[\\s\\S]*?</g>`,
          'g'
        )
      )!
      .join('');
    // The middle seat is flanked by neighbours: skirt on the front only.
    expect(seatMarkup).toContain('sb-body-skirt');
    expect(seatMarkup).not.toContain('sb-body-skirt-side');

    // The end module's open, camera-facing side carries a skirt panel too.
    const leftArm = pieces[0];
    const armMarkup = markup
      .match(
        new RegExp(
          `<g class="sb-product-piece[^"]*"[^>]*data-piece-id="${leftArm.id}"[^>]*>[\\s\\S]*?</g>`,
          'g'
        )
      )!
      .join('');
    expect(armMarkup).toContain('sb-body-skirt');
    expect(armMarkup).toContain('sb-body-skirt-side');
  });
});
