import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { readCorrectionReference } from '../../src/modules/measurement-assistant/correction-reference';

function fixture(caseId: string) {
  return JSON.parse(readFileSync(`tests/fixtures/measurement-corrections/${caseId}.json`, 'utf8'));
}
function simple(points = '20,30 80,30') {
  return {
    caseId: 'test',
    provenance: 'Recorded user correction',
    geometry: [
      {
        viewIndex: 0,
        viewBox: '0 0 100 100',
        measurements: [{ id: 'mA1cm', points }],
      },
    ],
  };
}
it.each(['S0673', 'S2280', 'S2427', 'S2325'])(
  'reads the actual corrected %s fixture without pretending to verify its source photo',
  caseId => {
    const result = readCorrectionReference(
      fixture(caseId),
      ['front', 'side'],
      ['front-photo', 'side-photo']
    );
    expect(result.reference.length).toBeGreaterThan(0);
    expect(result.reference.every(r => r.imageId && r.pathKind)).toBe(true);
    expect(result.historicalPhotoFramingVerified).toBe(false);
  }
);
it('uses authoritative S2280 manual additions instead of its stale overlay', () => {
  const result = readCorrectionReference(fixture('S2280'), ['front', 'side'], ['f', 's']);
  for (const label of ['B2', 'E1', 'E2'])
    expect(result.reference.some(r => r.imageId === 'f' && r.label === label)).toBe(true);
});
it('keeps two-point polyline semantics and exact photo identity', () => {
  const result = readCorrectionReference(simple(), ['front'], ['specific-front']);
  expect(result.reference[0]).toMatchObject({
    imageId: 'specific-front',
    pathKind: 'surface-path',
    points: [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.3 },
    ],
  });
});
it('rejects invalid points, missing image identity and conflicting duplicate geometry', () => {
  for (const points of ['NaN,30 80,30', '-1,30 80,30', '20,30 20,30', ',30 80,30'])
    expect(() => readCorrectionReference(simple(points), ['front'], ['f'])).toThrow();
  expect(() => readCorrectionReference(simple(), ['front'], [])).toThrow();
  const f = simple();
  f.geometry[0].measurements.push({ id: 'mA1in', points: '30,30 80,30' });
  expect(() => readCorrectionReference(f, ['front'], ['f'])).toThrow(/Conflicting/);
});
it('deduplicates equivalent cm/in geometry without erasing a disagreement', () => {
  const f = simple();
  f.geometry[0].measurements.push({ id: 'mA1in', points: '20,30 80,30' });
  expect(readCorrectionReference(f, ['front'], ['f']).reference).toHaveLength(1);
});

it('refuses repeated photo identities and mismatched mapping lengths', () => {
  expect(() => readCorrectionReference(simple(), ['front', 'side'], ['f', 'f'])).toThrow();
  expect(() => readCorrectionReference(simple(), ['front', 'side'], ['f'])).toThrow();
});
it('refuses approximate conversion of rotated or skewed Fabric corrections', () => {
  for (const key of ['angle', 'skewX', 'skewY']) {
    const f = fixture('S2280');
    f.vectors[0].strokes[0].fabric[key] = 12;
    expect(() => readCorrectionReference(f, ['front', 'side'], ['f', 's'])).toThrow();
  }
});
