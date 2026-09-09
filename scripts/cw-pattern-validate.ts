import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import {
  bindCwPatternMeasurements,
  CW_PATTERN_GUIDES,
  type PatternMeasurement,
} from '../src/modules/measurement-mos/cw-pattern-binding.ts';
import { tylosandAnchors } from '../tests/fixtures/cw-tylosand-anchors.ts';

/** Fails on missing assets, missing rows, wrong identity/value, or displaced endpoints.
 * Counts alone are insufficient. The references are independent of the algorithm.
 */
export async function validateTylosandPatterns(directory: string) {
  const source = JSON.parse(await fs.readFile(path.join(directory, 'source-private.json'), 'utf8'));
  const product = source.items[0].data.qcMeasurements.data;
  const report: Array<{
    component: string;
    measurement: string;
    variant: string;
    maxEndpointErrorPx: number;
    passed: boolean;
  }> = [];
  for (const guide of Object.values(CW_PATTERN_GUIDES)) {
    const svg = await fs.readFile(guide.path, 'utf8');
    for (const id of Object.values(guide.slots))
      if (!svg.includes(`id="${id}"`)) throw new Error(`Missing gallery span ${id}`);
  }
  for (const component of product.product_components) {
    const image = await fs.readFile(
      path.join(directory, path.basename(component.slipcover_details_images[0].name))
    );
    const expected = tylosandAnchors[component.name];
    if (!expected) throw new Error(`Missing reference annotations: ${component.name}`);
    for (const variant of ['original', 'mirrored', 'resampled', 'padded']) {
      let processor = sharp(image).resize(1000);
      if (variant === 'resampled')
        processor = sharp(await sharp(image).resize(700).png().toBuffer()).resize(1000);
      if (variant === 'mirrored') processor = processor.flop();
      const padding = variant === 'padded' ? 40 : 0;
      if (padding)
        processor = processor.extend({
          top: padding,
          bottom: padding,
          left: padding,
          right: padding,
          background: '#365789',
        });
      const { data, info } = await processor
        .removeAlpha()
        .toColourspace('srgb')
        .raw()
        .toBuffer({ resolveWithObject: true });
      const result = bindCwPatternMeasurements(
        data,
        info.width,
        info.height,
        component.name,
        component.measurements
      );
      if (result.unresolved.length)
        throw new Error(`${component.name}/${variant}: missing ${result.unresolved.join(', ')}`);
      if (result.bindings.length !== Object.keys(expected).length)
        throw new Error(`Wrong binding count: ${component.name}/${variant}`);
      for (const binding of result.bindings) {
        const reference = expected[binding.measurement.name];
        if (!reference) throw new Error(`Unexpected binding ${binding.measurement.name}`);
        const original = component.measurements.find(
          (measurement: PatternMeasurement) => measurement.id === binding.measurement.id
        );
        if (
          !original ||
          original.name !== binding.measurement.name ||
          original.value !== binding.measurement.value ||
          original.unit !== binding.measurement.unit
        )
          throw new Error('Measurement identity/value changed');
        const transform = (x: number, y: number) => ({
          x: (variant === 'mirrored' ? 999 - (x / 2007) * 1000 : (x / 2007) * 1000) + padding,
          y: (y / 708) * 353 + padding,
        });
        const a = transform(reference[0], reference[1]);
        const b = transform(reference[2], reference[3]);
        const first = binding.points[0];
        const last = binding.points[binding.points.length - 1];
        const distance = (point: typeof first, target: typeof a) =>
          Math.hypot(point.x * info.width - target.x, point.y * info.height - target.y);
        const error = Math.min(
          Math.max(distance(first, a), distance(last, b)),
          Math.max(distance(first, b), distance(last, a))
        );
        const passed = error <= 12;
        report.push({
          component: component.name,
          measurement: binding.measurement.name,
          variant,
          maxEndpointErrorPx: Math.round(error * 100) / 100,
          passed,
        });
      }
      // New source values must attach without changing geometry or retaining old values.
      const changed = component.measurements.map((m: PatternMeasurement) => ({
        ...m,
        id: m.id + 100000,
        value: m.value + 7,
      }));
      const rebound = bindCwPatternMeasurements(
        data,
        info.width,
        info.height,
        component.name,
        changed
      );
      if (
        JSON.stringify(result.bindings.map(b => b.points)) !==
          JSON.stringify(rebound.bindings.map(b => b.points)) ||
        rebound.bindings.some(
          b =>
            b.measurement.value !==
            changed.find((m: PatternMeasurement) => m.id === b.measurement.id)?.value
        )
      )
        throw new Error('Stale measurement binding');
    }
  }
  const summary = {
    passed: report.filter(row => row.passed).length,
    total: report.length,
    endpointTolerancePxAt1000: 12,
    checks: report,
  };
  await fs.writeFile(path.join(directory, 'validation.json'), JSON.stringify(summary, null, 2));
  if (summary.total !== 64 || summary.passed !== summary.total)
    throw new Error(`Geometry checks: ${summary.passed}/${summary.total}. See validation.json.`);
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await validateTylosandPatterns(
    path.resolve(process.argv[2] || 'tmp/tylosand-proof')
  );
  console.log(
    `${result.passed}/${result.total} measurement geometry checks pass (original, mirrored, resampled, padded).`
  );
}
