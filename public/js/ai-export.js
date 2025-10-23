// js/ai-export.js (ES module version for the browser)

import { MockAIWorker } from './ai-worker-mock.js';
import { createWorkerPayload } from './coordinate-validator.js';
import { DEFAULT_STYLE_GUIDE } from './ai-style-guide.js';

// mock vs prod
const USE_MOCK =
  !window.location.hostname.includes('vercel.app') &&
  !window.location.hostname.includes('workers.dev');

const mockWorker = new MockAIWorker();

export async function exportAIEnhancedSVG(options = {}) {
  const imageLabel = options.imageLabel || window.currentImageLabel;
  const prompt = options.prompt || '';
  const styleGuide = options.styleGuide || null;

  const { payload, errors } = createWorkerPayload(imageLabel, {
    units: options.units,
    prompt,
    styleGuide,
  });

  if (!payload) {
    throw new Error(
      'Failed to create valid payload: ' +
        (errors || []).map((e) => e.error || e.type).join(', ')
    );
  }
  if (!Array.isArray(payload.strokes) || payload.strokes.length === 0) {
    throw new Error('No strokes to export');
  }

  try {
    return USE_MOCK
      ? await mockWorker.generateSVG(payload)
      : await callWorkerAPI('/ai/generate-svg', payload);
  } catch (err) {
    console.error('[AI Export] Failed:', err);
    throw err;
  }
}

export async function assistMeasurement(strokeLabel, options = {}) {
  const imageLabel = options.imageLabel || window.currentImageLabel;
  const stroke = window.vectorStrokesByImage?.[imageLabel]?.[strokeLabel];
  if (!stroke) throw new Error(`Stroke ${strokeLabel} not found`);

  const payload = {
    units:
      options.units || {
        name: 'cm',
        pxPerUnit: 37.8,
      },
    stroke: {
      id: strokeLabel,
      type: stroke.type,
      points: stroke.points,
      color: stroke.color,
      width: stroke.width,
    },
    styleGuide: options.styleGuide || null,
  };

  return USE_MOCK
    ? await mockWorker.assistMeasurement(payload)
    : await callWorkerAPI('/ai/assist-measurement', payload);
}

export async function enhanceAnnotations(options = {}) {
  const imageLabel = options.imageLabel || window.currentImageLabel;

  const { payload } = createWorkerPayload(imageLabel, {
    styleGuide: options.styleGuide,
  });
  if (!payload) throw new Error('Failed to create valid payload');

  const placementPayload = {
    image: payload.image,
    strokes: payload.strokes,
    styleGuide: payload.styleGuide,
  };

  return USE_MOCK
    ? await mockWorker.enhanceAnnotations(placementPayload)
    : await callWorkerAPI('/ai/enhance-placement', placementPayload);
}

async function callWorkerAPI(endpoint, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${endpoint}: ${text.slice(0, 120)}`);
    }

    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    if (data?.fallback) throw new Error('Worker unavailable, use manual export');

    return data;
  } catch (err) {
    clearTimeout(timeout);
    if (err?.name === 'AbortError') throw new Error('Request timeout');
    throw err;
  }
}

// Optional compatibility bridge (until all callers import ESM)
window.exportAIEnhancedSVG = exportAIEnhancedSVG;
window.assistMeasurement = assistMeasurement;
window.enhanceAnnotations = enhanceAnnotations;