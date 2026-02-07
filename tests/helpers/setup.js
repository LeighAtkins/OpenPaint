import { vi } from 'vitest';

// Mock canvas getContext to return a stub 2d context
const mockContext = {
  clearRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  fill: vi.fn(),
  arc: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  translate: vi.fn(),
  rotate: vi.fn(),
  scale: vi.fn(),
  drawImage: vi.fn(),
  getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  putImageData: vi.fn(),
  createImageData: vi.fn(() => ({ data: new Uint8ClampedArray(4) })),
  setLineDash: vi.fn(),
  measureText: vi.fn(() => ({ width: 100 })),
  bezierCurveTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  closePath: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  canvas: { width: 800, height: 600 },
};

// Patch createElement so <canvas> elements return our mock context
const origCreateElement = document.createElement.bind(document);
document.createElement = vi.fn((tag, options) => {
  const el = origCreateElement(tag, options);
  if (tag === 'canvas') {
    el.getContext = vi.fn(() => mockContext);
    el.toDataURL = vi.fn(() => 'data:image/png;base64,mock');
  }
  return el;
});

// Mock performance.memory (not available in all environments)
if (!performance.memory) {
  Object.defineProperty(performance, 'memory', {
    value: { usedJSHeapSize: 50 * 1024 * 1024 },
    configurable: true,
  });
}

// Suppress console noise in tests
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'warn').mockImplementation(() => {});
