// js/ai-export.js (ES module version for the browser)

import type {
  AIStyleGuide,
  AIStrokeInput,
  AIUnits,
  AssistMeasurementInput,
  AssistMeasurementOutput,
  EnhancePlacementInput,
  EnhancePlacementOutput,
  GenerateSVGInput,
  GenerateSVGOutput,
} from './ai-schemas';
import { MockAIWorker } from './ai-worker-mock';
import { createWorkerPayload } from './coordinate-validator';

// mock vs prod
const USE_MOCK =
  !window.location.hostname.includes('vercel.app') &&
  !window.location.hostname.includes('workers.dev');

const mockWorker = new MockAIWorker();

type WorkerPayloadError = {
  error?: string;
  type?: string;
};

interface ExportAIOptions {
  imageLabel?: string;
  prompt?: string;
  styleGuide?: Partial<AIStyleGuide> | null;
  units?: AIUnits;
}

interface AssistMeasurementOptions {
  imageLabel?: string;
  styleGuide?: Partial<AIStyleGuide> | null;
  units?: AIUnits;
}

interface EnhanceAnnotationsOptions {
  imageLabel?: string;
  styleGuide?: Partial<AIStyleGuide> | null;
}

export async function exportAIEnhancedSVG(
  options: ExportAIOptions = {}
): Promise<GenerateSVGOutput> {
  const imageLabel = options.imageLabel || window.currentImageLabel;
  const prompt = options.prompt || '';
  const styleGuide = options.styleGuide || null;

  const { payload, errors } = createWorkerPayload(imageLabel, {
    units: options.units,
    prompt,
    styleGuide,
  }) as {
    payload: GenerateSVGInput | null;
    errors: WorkerPayloadError[];
  };

  if (!payload) {
    const message = (errors || []).map(error => error.error || error.type).join(', ');
    throw new Error(`Failed to create valid payload: ${message}`);
  }
  if (!Array.isArray(payload.strokes) || payload.strokes.length === 0) {
    throw new Error('No strokes to export');
  }

  try {
    return USE_MOCK
      ? await mockWorker.generateSVG(payload)
      : await callWorkerAPI<GenerateSVGOutput>('/ai/generate-svg', payload);
  } catch (error) {
    console.error('[AI Export] Failed:', error);
    throw error;
  }
}

export async function assistMeasurement(
  strokeLabel: string,
  options: AssistMeasurementOptions = {}
): Promise<AssistMeasurementOutput> {
  const imageLabel = options.imageLabel || window.currentImageLabel;
  const stroke = window.vectorStrokesByImage?.[imageLabel]?.[strokeLabel] as
    | AIStrokeInput
    | undefined;
  if (!stroke) throw new Error(`Stroke ${strokeLabel} not found`);

  const payload: AssistMeasurementInput = {
    units: options.units || {
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
    : await callWorkerAPI<AssistMeasurementOutput>('/ai/assist-measurement', payload);
}

export async function enhanceAnnotations(
  options: EnhanceAnnotationsOptions = {}
): Promise<EnhancePlacementOutput> {
  const imageLabel = options.imageLabel || window.currentImageLabel;

  const { payload } = createWorkerPayload(imageLabel, {
    styleGuide: options.styleGuide,
  }) as {
    payload: GenerateSVGInput | null;
  };
  if (!payload) throw new Error('Failed to create valid payload');

  const placementPayload: EnhancePlacementInput = {
    image: payload.image,
    strokes: payload.strokes,
    styleGuide: payload.styleGuide,
  };

  return USE_MOCK
    ? await mockWorker.enhanceAnnotations(placementPayload)
    : await callWorkerAPI<EnhancePlacementOutput>('/ai/enhance-placement', placementPayload);
}

async function callWorkerAPI<T>(endpoint: string, payload: unknown): Promise<T> {
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

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      throw new Error(`Invalid JSON from ${endpoint}: ${text.slice(0, 120)}`);
    }

    if (!res.ok) {
      const errorMessage =
        typeof data === 'object' && data ? (data as { error?: string }).error : undefined;
      throw new Error(errorMessage || `HTTP ${res.status}`);
    }
    if (typeof data === 'object' && data && 'fallback' in data) {
      throw new Error('Worker unavailable, use manual export');
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Request timeout');
    }
    throw error;
  }
}

// Optional compatibility bridge (until all callers import ESM)
window.exportAIEnhancedSVG = exportAIEnhancedSVG;
window.assistMeasurement = assistMeasurement;
window.enhanceAnnotations = enhanceAnnotations;
