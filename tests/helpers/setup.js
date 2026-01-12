import { vi } from 'vitest';

// Mock DOM elements
const mockCanvasContext = {
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
};

globalThis.document.getElementById = vi.fn(id => {
  const elements = {
    canvas: {
      getContext: vi.fn(() => mockCanvasContext),
      width: 800,
      height: 600,
      getBoundingClientRect: vi.fn(() => ({
        left: 0,
        top: 0,
        width: 800,
        height: 600,
      })),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    },
    colorPicker: { value: '#000000' },
    brushSize: { value: '5' },
    unitSelector: { value: 'inch' },
    drawingModeToggle: {
      textContent: 'Freehand',
      click: vi.fn(),
      addEventListener: vi.fn(),
    },
  };

  return elements[id] || null;
});

// Mock window functions
const urlCtor = globalThis.URL;
if (urlCtor && typeof urlCtor === 'function') {
  if (!('createObjectURL' in urlCtor)) {
    Object.assign(urlCtor, {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    });
  }
} else {
  globalThis.URL = Object.assign(function URL() {}, {
    createObjectURL: vi.fn(() => 'blob:mock-url'),
    revokeObjectURL: vi.fn(),
  });
}

Object.assign(globalThis, {
  performance: {
    now: vi.fn(() => Date.now()),
    memory: {
      usedJSHeapSize: 50 * 1024 * 1024,
    },
  },
});

// Initialize global window object with required properties
const win = globalThis.window ?? {};
Object.assign(win, {
  getSelection: vi.fn(() => ({
    removeAllRanges: vi.fn(),
    addRange: vi.fn(),
  })),
  requestAnimationFrame: vi.fn(cb => setTimeout(cb, 16)),
});

globalThis.window = win;

// Mock console methods to reduce noise in tests
Object.assign(globalThis.console, {
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});
